"""Seed the initial top-level boards for T32.

Idempotent: skips boards whose slug already exists. Run once after
deploying T32. Safe to re-run.

Usage:
    cd backend
    python scripts/seed_boards.py
"""

from __future__ import annotations

from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

_INITIAL_BOARDS: list[dict[str, Any]] = [
    {
        "name": "Prayer & praise",
        "slug": "prayer-praise",
        "description": "Cross-group prayer requests and praise reports.",
        "audience": "christian",
    },
    {
        "name": "Resources",
        "slug": "resources",
        "description": "Shared studies, devotionals, and recommendations.",
        "audience": "christian",
    },
    {
        "name": "Events",
        "slug": "events",
        "description": "Cross-group events: retreats, conferences, meetups.",
        "audience": "general",
    },
]


def main() -> int:
    init_firebase_admin()
    db = fb_firestore.client()
    created = 0
    skipped = 0
    for board in _INITIAL_BOARDS:
        existing = list(
            db.collection("boards").where("slug", "==", board["slug"]).limit(1).stream()
        )
        if existing:
            skipped += 1
            print(f"skip slug={board['slug']} already exists")
            continue
        ref = db.collection("boards").document()
        ref.set(
            {
                **board,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
                "archivedAt": None,
                "postCount": 0,
                "schemaVersion": 1,
            }
        )
        created += 1
        print(f"created slug={board['slug']} board_id={ref.id}")
    print(f"\nseeded boards: {created} created, {skipped} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
