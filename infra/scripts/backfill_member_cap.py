"""Backfill `groups/{gid}.memberCap` for all existing groups.

The soft member cap (default 20) is a new field. Existing groups that
already have 20+ members must not find themselves "over limit" on first
deploy, so the backfill sets:

    memberCap = max(20, current memberCount)

Groups already at cap or over (possible if they grew before this feature
landed) get a cap equal to their current membership, so the cap is
enforced going forward without silently evicting anyone.

Idempotent: re-running overwrites whatever `memberCap` is stored with the
safe value. Once you've manually tuned a group's cap, don't re-run this
script — it would reset it.

Usage:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-prod \\
    python infra/scripts/backfill_member_cap.py --dry-run

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-prod \\
    python infra/scripts/backfill_member_cap.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_CAP = 20


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill memberCap on all groups")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        print("ERROR: GOOGLE_CLOUD_PROJECT must be set", file=sys.stderr)
        sys.exit(1)

    import firebase_admin
    from firebase_admin import credentials, firestore as fb_firestore

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    cred = credentials.Certificate(cred_path) if cred_path else credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": project})
    db = fb_firestore.client()

    groups_ref = db.collection("groups")
    total = updated = skipped = 0

    # Stream all groups in pages of 500.
    query = groups_ref.order_by("__name__")
    docs = list(query.stream())

    for snap in docs:
        total += 1
        data = snap.to_dict() or {}

        # Skip archived groups — they can't grow, no urgency.
        if data.get("archivedAt") is not None:
            skipped += 1
            continue

        member_count = int(data.get("memberCount") or 0)
        new_cap = max(DEFAULT_CAP, member_count)

        existing_cap = data.get("memberCap")
        if existing_cap is not None and int(existing_cap) == new_cap:
            skipped += 1
            continue

        print(
            f"{'[DRY]' if args.dry_run else '[WRITE]'} "
            f"gid={snap.id} memberCount={member_count} "
            f"existing_cap={existing_cap} → new_cap={new_cap}"
        )

        if args.apply:
            snap.reference.update({"memberCap": new_cap})
            updated += 1

    print(
        f"\nDone. total={total} updated={updated} skipped={skipped} "
        f"({'dry-run — no writes' if args.dry_run else 'applied'})"
    )


if __name__ == "__main__":
    main()
