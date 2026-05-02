"""Backfill the `uid` field on every `groups/{gid}/members/{uid}` doc.

M11 introduced a `uid` field equal to the doc ID so the frontend can
discover memberships via a collection-group query. New docs created by
the backend (`POST /api/groups`, `POST /api/groups/join`) include the
field; this script writes it onto every pre-existing member doc.

Idempotent: re-running over docs that already have the field is a
no-op (the value is set to `doc.id`, which doesn't change).

Usage:
    cd backend
    python scripts/backfill_member_uid.py [--dry-run]

Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a key for an SA
that can read/write the Firestore database.
"""

from __future__ import annotations

import argparse
import sys

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Don't write anything")
    args = parser.parse_args(argv[1:])

    init_firebase_admin()
    db = fb_firestore.client()

    examined = 0
    written = 0
    for member in db.collection_group("members").stream():
        examined += 1
        doc_id = member.id
        data = member.to_dict() or {}
        existing = data.get("uid")
        if existing == doc_id:
            continue
        if args.dry_run:
            print(f"would write uid={doc_id} on {member.reference.path}")
        else:
            member.reference.update({"uid": doc_id})
        written += 1

    print(f"examined={examined} written={written} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
