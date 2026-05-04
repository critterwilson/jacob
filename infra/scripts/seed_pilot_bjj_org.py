"""Seed the first pilot BJJ org (T56).

Same shape as `seed_pilot_org.py` but pins audience=bjj. Run after the
BJJ sticker seed (`pnpm -F jacob-firestore seed:stickers`) so the
sticker set exists.

Usage:
    cd backend
    python ../infra/scripts/seed_pilot_bjj_org.py \\
        --slug pilot-bjj --name "Pilot BJJ" --admin-uid <uid>
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services import orgs as orgs_service
from app.services.firebase import init_firebase_admin


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--admin-uid", required=True)
    parser.add_argument("--description", default="")
    args = parser.parse_args(argv[1:])

    db = _db()
    try:
        org_id = orgs_service.create_org(
            db,
            actor_uid=f"cli:{args.admin_uid}",
            name=args.name,
            slug=args.slug,
            description=args.description,
            audience="bjj",
            initial_admin_uid=args.admin_uid,
        )
    except ValueError as exc:
        if str(exc) == "slug_taken":
            print(f"slug {args.slug!r} is already in use", file=sys.stderr)
            return 1
        raise

    print(f"created bjj org orgId={org_id} slug={args.slug} admin={args.admin_uid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
