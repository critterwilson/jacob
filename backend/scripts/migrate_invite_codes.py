"""One-shot migration: move groups/{gid}.inviteCode into groups/{gid}/invites/{id}.

Run ONCE before deploying the new invite system. Idempotent: if an invite with
the same code already exists in the group, skips creation but still nulls the
legacy field.

Usage:
    python -m scripts.migrate_invite_codes [--dry-run] [--project PROJECT_ID]
"""

from __future__ import annotations

import argparse
import uuid

import firebase_admin
from firebase_admin import credentials, firestore

_PAGE_SIZE = 500


def migrate(dry_run: bool = False) -> None:
    db = firestore.client()
    migrated = 0
    skipped = 0
    cursor = None

    while True:
        query = db.collection("groups").limit(_PAGE_SIZE)
        if cursor:
            query = query.start_after(cursor)
        snaps = list(query.stream())
        if not snaps:
            break

        for snap in snaps:
            data = snap.to_dict() or {}
            code: str | None = data.get("inviteCode")
            if not code:
                skipped += 1
                continue

            gid = snap.id
            invites_col = db.collection("groups").document(gid).collection("invites")

            # Idempotency: skip if a doc with this code already exists.
            existing = list(invites_col.where("code", "==", code).limit(1).stream())
            if not existing:
                invite_id = str(uuid.uuid4())
                invite_data = {
                    "code": code,
                    "createdBy": data.get("founderUid") or data.get("createdBy", ""),
                    "createdAt": data.get("createdAt"),
                    "expiresAt": None,
                    "maxUses": None,
                    "useCount": 0,
                    "lastUsedAt": None,
                    "lastUsedByUid": None,
                    "revokedAt": None,
                    "revokedBy": None,
                }
                if not dry_run:
                    invites_col.document(invite_id).set(invite_data)
                print(f"[migrate] gid={gid} code={code} invite_id={invite_id}")
            else:
                print(f"[migrate] gid={gid} code={code} already has invite, skipping create")

            if not dry_run:
                db.collection("groups").document(gid).update({"inviteCode": None})
            migrated += 1

        cursor = snaps[-1]
        if len(snaps) < _PAGE_SIZE:
            break

    suffix = " [DRY RUN]" if dry_run else ""
    print(f"\nDone{suffix}. migrated={migrated} skipped={skipped}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate legacy inviteCode field to invites collection"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    parser.add_argument("--project", default=None, help="GCP project ID")
    args = parser.parse_args()

    cred = credentials.ApplicationDefault()
    options = {"projectId": args.project} if args.project else {}
    firebase_admin.initialize_app(cred, options)

    migrate(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
