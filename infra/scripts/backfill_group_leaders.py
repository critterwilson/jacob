"""H5 — Backfill `groups/{gid}.leaderUids` from the members subcollection.

`onMemberWrite` (functions/src/onMemberWrite.ts) keeps `leaderUids` in
sync going forward, but existing groups that pre-date this change have
no `leaderUids` field. The discover endpoint falls back to a per-group
subcollection scan for those groups, so it'll keep working — but the
N+1 isn't gone until every group is backfilled. Run this script once
post-deploy to land the array on every group.

Idempotent: existing `leaderUids` fields are recomputed from the live
subcollection contents and written back. Concurrent member writes
during the backfill could race, but the `onMemberWrite` trigger is the
authority — re-running converges to the right state.

Usage:

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-staging-494515 \\
    python infra/scripts/backfill_group_leaders.py --dry-run

    GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \\
    GOOGLE_CLOUD_PROJECT=jacob-staging-494515 \\
    python infra/scripts/backfill_group_leaders.py --apply

The --apply mode writes one update per group (no batching). For ~500
groups this takes <1 minute and stays well under Firestore write QPS.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

logger = logging.getLogger("backfill_group_leaders")


def collect_leader_uids(group_ref: Any) -> list[str]:
    """Read `members` where role == leader; return sorted uid list."""
    members_col = group_ref.collection("members")
    snaps = members_col.where("role", "==", "leader").stream()
    return sorted(snap.id for snap in snaps)


def backfill(db: Any, *, apply: bool) -> tuple[int, int, int]:
    """Walk every `groups/{gid}` and reconcile `leaderUids`.

    Returns (groups_seen, groups_updated, groups_skipped).
    """
    seen = updated = skipped = 0
    for group_snap in db.collection("groups").stream():
        seen += 1
        gid = group_snap.id
        data = group_snap.to_dict() or {}
        existing = sorted(data.get("leaderUids") or [])
        actual = collect_leader_uids(group_snap.reference)
        if existing == actual:
            skipped += 1
            continue
        logger.info(
            "gid=%s existing=%s actual=%s %s",
            gid,
            existing,
            actual,
            "(would update)" if not apply else "(updating)",
        )
        if apply:
            group_snap.reference.update(
                {"leaderUids": actual, "leaderCount": len(actual)}
            )
        updated += 1
    return seen, updated, skipped


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
        help="Write the reconciled leaderUids array.",
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

    seen, updated, skipped = backfill(db, apply=args.apply)
    logger.info(
        "backfill_group_leaders done: seen=%d updated=%d skipped=%d mode=%s",
        seen,
        updated,
        skipped,
        "apply" if args.apply else "dry-run",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
