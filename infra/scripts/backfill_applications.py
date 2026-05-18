"""ADR 0012 — backfill `applications/{uid}` for grandfathered users.

After the admin-approval signup flow lands, every new account flows
through `applications/{uid}` → admin approve → `users/{uid}`. Pre-
existing users already have a `users/{uid}` doc but no application
record, so they're invisible in the admin queue (no audit row).

This script creates an `applications/{uid}` doc with
`status: "approved"`, `decidedBy: "system_grandfather"`, and a
`grandfathered: true` marker for every existing user that doesn't
already have one. It is **audit-only**: presence of `users/{uid}` is
still the load-bearing signal for member access, so failing or
skipping this script does not lock anyone out.

Pre-existing `isMinor: true` users get `parentalConsentObtained: null`
so the admin queue can surface them with a warning. The team can then
decide whether to retroactively collect consent.

Idempotent: re-running skips users that already have an application
doc. Concurrent admin approvals during the backfill are not a concern
because the admin endpoint also short-circuits if the application
already exists.

Usage:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-staging-494515 \\
    python infra/scripts/backfill_applications.py --dry-run

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-staging-494515 \\
    python infra/scripts/backfill_applications.py --apply
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

logger = logging.getLogger("backfill_applications")


def backfill(db: Any, *, apply: bool) -> tuple[int, int, int, int]:
    """Walk every `users/{uid}` and create a missing `applications/{uid}`.

    Returns (users_seen, applications_created, skipped_existing, minor_users).
    """
    seen = created = skipped = minor_count = 0

    for user_snap in db.collection("users").stream():
        seen += 1
        uid = user_snap.id
        user_data = user_snap.to_dict() or {}

        # Lazy import to keep `firestore.SERVER_TIMESTAMP` out of the
        # module's top level — the file is importable without
        # firebase-admin installed.
        from firebase_admin import firestore as fb_firestore

        app_ref = db.collection("applications").document(uid)
        existing = app_ref.get()
        if getattr(existing, "exists", False):
            skipped += 1
            continue

        is_minor = bool(user_data.get("isMinor", False))
        if is_minor:
            minor_count += 1

        payload: dict[str, Any] = {
            "email": user_data.get("email"),
            "displayName": user_data.get("displayName") or "",
            "photoURL": user_data.get("photoURL"),
            "dob": None,  # no DOB on pre-existing users (ageGroup only)
            "isMinor": is_minor,
            "phone": user_data.get("phone"),
            "location": user_data.get("location"),
            "faithBackground": user_data.get("faithBackground"),
            "status": "approved",
            "createdAt": user_data.get("createdAt") or fb_firestore.SERVER_TIMESTAMP,
            "submittedAt": user_data.get("createdAt") or fb_firestore.SERVER_TIMESTAMP,
            "decidedAt": fb_firestore.SERVER_TIMESTAMP,
            "decidedBy": "system_grandfather",
            # Pre-existing minors had no admin consent attestation: leave
            # null so the admin queue can surface them with a warning.
            "parentalConsentObtained": None,
            "parentalConsentNotes": "",
            "rejectionReason": "",
            "grandfathered": True,
        }

        if apply:
            app_ref.set(payload)
            logger.info("created applications/%s isMinor=%s", uid, is_minor)
        else:
            logger.info("would create applications/%s isMinor=%s", uid, is_minor)
        created += 1

    return seen, created, skipped, minor_count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change but do not write.",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Write the backfilled application docs.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Lazy import so the file is importable without firebase-admin
    # installed (the repo's CI doesn't bundle it for infra/scripts/).
    from firebase_admin import firestore as fb_firestore
    from firebase_admin import initialize_app

    initialize_app()
    db = fb_firestore.client()

    seen, created, skipped, minor_count = backfill(db, apply=args.apply)
    logger.info(
        "backfill_applications done: seen=%d created=%d skipped=%d "
        "minor_count=%d mode=%s",
        seen,
        created,
        skipped,
        minor_count,
        "apply" if args.apply else "dry-run",
    )
    if minor_count and args.apply:
        logger.warning(
            "%d grandfathered minor users have parentalConsentObtained=null; "
            "review them in the admin queue once the consent gate ships.",
            minor_count,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
