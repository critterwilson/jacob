"""One-shot de-BJJ data migration (Olive Branch rebrand).

The Phase-3 "BJJ vertical" was scaffolded but never shipped as a real
audience. The rebrand to a 100%-ministry app collapses the `audience`
enum to `christian | general` and drops the six BJJ stickers. This
script reconciles any production data that still carries the retired
`bjj` value:

  1. Deletes the six BJJ sticker docs from `stickers/`.
  2. Backfills `groups/{gid}.audience == "bjj"`     -> "general".
  3. Backfills `groups/{gid}.stickerSet == "bjj"`   -> "general".
  4. Backfills `orgs/{orgId}.audience == "bjj"`      -> "general".

`bjj` is mapped to `general` (not `christian`) so we never silently
re-label a non-Christian group as Christian — `general` is the neutral
fall-back. Idempotent: re-running after a clean pass is a no-op.

Usage (against a pre-authenticated Firebase project — uses ADC):

    cd backend
    python ../infra/scripts/migrate_debjj.py            # apply
    python ../infra/scripts/migrate_debjj.py --dry-run  # report only
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

BJJ_STICKER_SLUGS = [
    "roll-partner-needed",
    "tournament-prep",
    "technique-question",
    "recovery",
    "conditioning",
    "bjj-milestone",
]


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing",
    )
    args = parser.parse_args(argv[1:])
    db = _db()
    dry = args.dry_run

    # 1. Delete BJJ sticker docs.
    for slug in BJJ_STICKER_SLUGS:
        ref = db.collection("stickers").document(slug)
        if ref.get().exists:
            print(f"{'[dry] ' if dry else ''}delete stickers/{slug}")
            if not dry:
                ref.delete()

    # 2/3. Backfill groups with audience/stickerSet == "bjj".
    for snap in db.collection("groups").where("audience", "==", "bjj").stream():
        print(f"{'[dry] ' if dry else ''}groups/{snap.id}: audience bjj -> general")
        if not dry:
            snap.reference.update({"audience": "general"})
    for snap in db.collection("groups").where("stickerSet", "==", "bjj").stream():
        print(f"{'[dry] ' if dry else ''}groups/{snap.id}: stickerSet bjj -> general")
        if not dry:
            snap.reference.update({"stickerSet": "general"})

    # 4. Backfill orgs with audience == "bjj".
    for snap in db.collection("orgs").where("audience", "==", "bjj").stream():
        print(f"{'[dry] ' if dry else ''}orgs/{snap.id}: audience bjj -> general")
        if not dry:
            snap.reference.update({"audience": "general"})

    print("done." if not dry else "dry-run complete (no writes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
