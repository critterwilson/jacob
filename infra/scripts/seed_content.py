"""Seed devotionals + reading plans into Firestore (T51).

Usage:
    cd backend
    python ../infra/scripts/seed_content.py [--dry-run]

Reads every JSON file under `infra/seed/devotionals/` and
`infra/seed/reading_plans/`, then upserts them into Firestore via the
Admin SDK. Idempotent — re-running with edited JSON updates the doc
in place. `publishedAt` is set on first write and preserved on
subsequent runs unless `--bump-published` is passed.

Devotional doc IDs use the path-based scheme (schemaVersion 2):
`org__<slug>` for platform-wide entries. The seed JSON's `slug` field
is the title-derived URL slug; the script composes the final doc ID
itself. Pre-rename docs with the bare slug as ID are deleted in the
same pass so re-seeding doesn't leave duplicates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# `backend/` is on sys.path when run from the project root with
# `cd backend && python ../infra/scripts/seed_content.py` (per the
# usage docstring above). The import of app.services has always
# depended on that — this just preserves the same contract.
from app.services.devotional_paths import doc_id_for  # noqa: E402
from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEVOTIONALS_DIR = _REPO_ROOT / "infra" / "seed" / "devotionals"
_PLANS_DIR = _REPO_ROOT / "infra" / "seed" / "reading_plans"


def _load_dir(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not path.exists():
        return out
    for jp in sorted(path.glob("*.json")):
        with jp.open("r", encoding="utf-8") as fh:
            try:
                doc = json.load(fh)
            except json.JSONDecodeError as exc:
                print(f"skip {jp.name}: {exc}", file=sys.stderr)
                continue
        if "slug" not in doc:
            print(f"skip {jp.name}: missing slug", file=sys.stderr)
            continue
        out.append(doc)
    return out


def _seed_reading_plans(
    db: Any,
    *,
    docs: list[dict[str, Any]],
    bump_published: bool,
    dry_run: bool,
) -> int:
    """Reading plans still use slug-as-doc-ID; only devotionals changed."""
    written = 0
    for doc in docs:
        slug = doc["slug"]
        ref = db.collection("reading_plans").document(slug)
        existing = ref.get()
        payload: dict[str, Any] = {**doc, "schemaVersion": 1}
        if existing.exists and not bump_published:
            existing_data = existing.to_dict() or {}
            if existing_data.get("publishedAt") is not None:
                payload["publishedAt"] = existing_data["publishedAt"]
            else:
                payload["publishedAt"] = fb_firestore.SERVER_TIMESTAMP
        else:
            payload["publishedAt"] = fb_firestore.SERVER_TIMESTAMP
        if dry_run:
            print(f"would write reading_plans/{slug}")
        else:
            ref.set(payload, merge=False)
            print(f"wrote reading_plans/{slug}")
        written += 1
    return written


def _seed_devotionals(
    db: Any,
    *,
    docs: list[dict[str, Any]],
    bump_published: bool,
    dry_run: bool,
) -> int:
    """Write each seed entry under the new `org__<slug>` doc ID and
    sweep up any pre-rename doc with the same bare slug — keeps
    re-seeding idempotent across the cutover."""
    written = 0
    for doc in docs:
        slug = doc["slug"]
        # Seed entries are platform-wide (group-scoped devotionals are
        # authored by leaders, not seeded). The doc ID encodes that.
        new_doc_id = doc_id_for("org", slug)
        ref = db.collection("devotionals").document(new_doc_id)
        legacy_ref = db.collection("devotionals").document(slug)

        existing = ref.get()
        payload: dict[str, Any] = {
            **doc,
            "schemaVersion": 2,
            "groupId": None,
        }
        if existing.exists and not bump_published:
            existing_data = existing.to_dict() or {}
            if existing_data.get("publishedAt") is not None:
                payload["publishedAt"] = existing_data["publishedAt"]
            else:
                payload["publishedAt"] = fb_firestore.SERVER_TIMESTAMP
        else:
            payload["publishedAt"] = fb_firestore.SERVER_TIMESTAMP

        if dry_run:
            print(f"would write devotionals/{new_doc_id}")
            if legacy_ref.get().exists:
                print(f"would delete legacy devotionals/{slug}")
        else:
            ref.set(payload, merge=False)
            print(f"wrote devotionals/{new_doc_id}")
            # Clear out the pre-rename doc so the same slug isn't
            # served from two paths after the cutover.
            if legacy_ref.get().exists:
                legacy_ref.delete()
                print(f"deleted legacy devotionals/{slug}")
        written += 1
    return written


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--bump-published",
        action="store_true",
        help="Force publishedAt to now even if the doc already exists.",
    )
    args = parser.parse_args(argv[1:])

    db = _db() if not args.dry_run else None

    devotionals = _load_dir(_DEVOTIONALS_DIR)
    plans = _load_dir(_PLANS_DIR)
    if not devotionals and not plans:
        print(
            f"No content under {_DEVOTIONALS_DIR} or {_PLANS_DIR}",
            file=sys.stderr,
        )
        return 1

    if db is None:
        print("dry-run — no writes")
        for d in devotionals:
            print(f"  devotional {d['slug']} → devotionals/{doc_id_for('org', d['slug'])}")
        for p in plans:
            print(f"  plan       {p['slug']} ({p.get('duration', '?')} days)")
        return 0

    n1 = _seed_devotionals(
        db,
        docs=devotionals,
        bump_published=args.bump_published,
        dry_run=False,
    )
    n2 = _seed_reading_plans(
        db,
        docs=plans,
        bump_published=args.bump_published,
        dry_run=False,
    )
    print(f"seeded {n1} devotionals, {n2} reading plans")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
