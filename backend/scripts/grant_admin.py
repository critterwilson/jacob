"""Grant the `admin: true` Firebase custom claim to a user.

Usage:
    cd backend
    python scripts/grant_admin.py <uid>

Existing claims on the user are preserved. The user must sign out and
sign back in (or refresh their ID token) before the new claim takes
effect on the client.
"""

from __future__ import annotations

import sys

from firebase_admin import auth as firebase_auth

from app.services.firebase import init_firebase_admin


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python scripts/grant_admin.py <uid>", file=sys.stderr)
        return 1
    uid = argv[1]
    init_firebase_admin()
    user = firebase_auth.get_user(uid)
    existing: dict[str, object] = dict(user.custom_claims or {})
    existing["admin"] = True  # MUST be boolean True — rules check `== true`, not "true"/1/yes
    firebase_auth.set_custom_user_claims(uid, existing)
    print(f"Granted admin=True to uid={uid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
