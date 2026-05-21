"""Grant or revoke the `admin: true` Firebase custom claim for a user.

There is intentionally no in-app endpoint for this operation (privilege-
escalation risk). This script is the supported operator path.

Usage — grant:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    python infra/scripts/grant_admin_claim.py --project jacob-prod user@example.com

Usage — revoke:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    python infra/scripts/grant_admin_claim.py --project jacob-prod --revoke user@example.com

Usage — dry run:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    python infra/scripts/grant_admin_claim.py --project jacob-prod --dry-run user@example.com

The `--project` flag can be omitted when GOOGLE_CLOUD_PROJECT is set in the
environment. GOOGLE_APPLICATION_CREDENTIALS is optional; the script falls back
to Application Default Credentials (e.g. `gcloud auth application-default login`).

IMPORTANT: The user must sign out and sign back in (or wait for their ID token
to expire) before the new claim takes effect in the app. The Firebase ID token
is a short-lived JWT — the claim change is reflected in the next token issued
by Firebase, not in any currently-held token.

Existing custom claims are always MERGED, never replaced. A user who already
has `moderator: true` or `ministry_owner: true` will keep those claims when
`admin` is granted or revoked.
"""

from __future__ import annotations

import argparse
import os
import sys


def _load_firebase(project: str) -> None:
    """Initialise firebase_admin with the project and available credentials."""
    import firebase_admin
    from firebase_admin import credentials

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    cred = (
        credentials.Certificate(cred_path)
        if cred_path
        else credentials.ApplicationDefault()
    )
    firebase_admin.initialize_app(cred, {"projectId": project})


def _resolve_user(identifier: str) -> tuple[str, str, dict[str, object]]:
    """Return (uid, email, existing_custom_claims) for the given uid or email."""
    from firebase_admin import auth as firebase_auth

    if "@" in identifier:
        user = firebase_auth.get_user_by_email(identifier)
    else:
        user = firebase_auth.get_user(identifier)

    return user.uid, user.email or "", dict(user.custom_claims or {})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Grant or revoke the admin Firebase custom claim."
    )
    parser.add_argument(
        "identifier",
        help="User email address or Firebase UID.",
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", ""),
        help=("Firebase/GCP project ID. Falls back to GOOGLE_CLOUD_PROJECT env var."),
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--grant",
        dest="action",
        action="store_const",
        const="grant",
        default="grant",
        help="Grant the admin claim (default).",
    )
    action.add_argument(
        "--revoke",
        dest="action",
        action="store_const",
        const="revoke",
        help="Revoke the admin claim.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change but do not write to Firebase.",
    )
    args = parser.parse_args(argv)

    if not args.project:
        print(
            "ERROR: --project or GOOGLE_CLOUD_PROJECT must be set.",
            file=sys.stderr,
        )
        return 2

    _load_firebase(args.project)

    try:
        uid, email, before = _resolve_user(args.identifier)
    except Exception as exc:  # noqa: BLE001
        print(
            f"ERROR: could not resolve user '{args.identifier}': {exc}", file=sys.stderr
        )
        return 1

    print(f"User      : {email} (uid={uid})")
    print(f"Project   : {args.project}")
    print(f"Before    : {before}")

    after = dict(before)
    if args.action == "grant":
        after["admin"] = True
    else:
        after.pop("admin", None)

    if before == after:
        state = "admin=True" if args.action == "grant" else "no admin claim"
        print(f"No change : user already has {state}.")
        return 0

    print(f"After     : {after}")

    if args.dry_run:
        print("[DRY RUN] No changes written.")
        return 0

    from firebase_admin import auth as firebase_auth

    firebase_auth.set_custom_user_claims(uid, after)

    # Read back to confirm.
    readback = firebase_auth.get_user(uid)
    actual = dict(readback.custom_claims or {})
    print(f"Confirmed : {actual}")

    if actual != after:
        print(
            "WARNING: readback claims do not match expected — verify manually.",
            file=sys.stderr,
        )
        return 1

    verb = "Granted" if args.action == "grant" else "Revoked"
    print(f"{verb} admin claim for {email}.")
    print("NOTE: the user must sign out and back in for the change to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
