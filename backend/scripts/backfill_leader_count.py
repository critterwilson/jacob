"""Backfill `groups/{gid}.leaderCount` for every group (T22).

Pre-T22 groups don't have a `leaderCount` field. The leaderless-guard
rule reads it on every member-delete write, so groups that pre-date
T22 would get permission-denied on a leader self-leave even when other
leaders exist (the rule's `data.leaderCount > 1` is `null > 1` →
false). This script counts each group's existing leaders and writes
the field exactly once.

Idempotent: re-running re-counts and writes the same value.

Usage:
    cd backend
    python scripts/backfill_leader_count.py [--dry-run]
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

    groups = list(db.collection("groups").stream())
    print(f"scanning {len(groups)} groups")

    updated = 0
    matched = 0
    for grp in groups:
        members = list(grp.reference.collection("members").stream())
        actual = sum(1 for m in members if (m.to_dict() or {}).get("role") == "leader")
        existing = grp.to_dict().get("leaderCount") if grp.to_dict() else None
        if existing == actual:
            matched += 1
            continue
        if args.dry_run:
            print(f"would set {grp.id}.leaderCount={actual} (was={existing})")
        else:
            grp.reference.update({"leaderCount": actual})
        updated += 1

    print(f"matched={matched} updated={updated} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
