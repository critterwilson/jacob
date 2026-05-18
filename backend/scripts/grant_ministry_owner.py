"""Grant the `ministry_owner: true` Firebase custom claim to a user.

Usage:
    cd backend
    python scripts/grant_ministry_owner.py <uid>

Existing claims (including `admin`) are preserved. The user must sign
out and sign back in (or refresh their ID token) before the new claim
takes effect on the client.

The same operation is also exposed as `POST /api/admin/users/{uid}/ministry-owner`
for admins who want to grant via the UI rather than the CLI; this script
is kept for bootstrap (when no admin yet exists) and for ops use.
"""

from __future__ import annotations

import sys

from firebase_admin import auth as firebase_auth

from app.services.firebase import init_firebase_admin


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python scripts/grant_ministry_owner.py <uid>", file=sys.stderr)
        return 1
    uid = argv[1]
    init_firebase_admin()
    user = firebase_auth.get_user(uid)
    existing: dict[str, object] = dict(user.custom_claims or {})
    # MUST be boolean True — backend checks `claims.get("ministry_owner") is True`.
    existing["ministry_owner"] = True
    firebase_auth.set_custom_user_claims(uid, existing)
    print(f"Granted ministry_owner=True to uid={uid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
