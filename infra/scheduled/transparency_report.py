"""Quarterly transparency-report generator (T65).

Designed to run on the 1st of Jan / Apr / Jul / Oct via Cloud
Scheduler invoking a Cloud Run job (see infra/scheduler.tf for
existing patterns). The script is idempotent on the
`(period, scope)` pair: if a draft already exists it does nothing.

Usage (against a pre-authenticated Firebase project — uses ADC):

    cd backend
    python ../infra/scheduled/transparency_report.py \\
        --scope platform
    # also generates a per-org draft for every org with at least one
    # attached group — pass --skip-orgs to limit to platform-only.

Run manually after a quarter ends; or wire it to Cloud Scheduler →
Cloud Run job. The draft is *not* published — a platform admin
reviews per `docs/runbooks/transparency-report.md` and clicks the
Publish button.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services import transparency as transparency_service
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _existing_draft(db: Any, *, period: str, scope: str) -> str | None:
    for snap in (
        db.collection("transparency_reports")
        .where("period", "==", period)
        .where("scope", "==", scope)
        .stream()
    ):
        return str(snap.id)
    return None


def _generate_one(db: Any, *, period: str, start: Any, end: Any, scope: str) -> str | None:
    existing = _existing_draft(db, period=period, scope=scope)
    if existing is not None:
        logger.info("transparency_skip period=%s scope=%s existing=%s", period, scope, existing)
        return existing
    payload = transparency_service.generate_report(
        db, period=period, start=start, end=end, scope=scope
    )
    report_id = transparency_service.write_draft(db, period=period, scope=scope, payload=payload)
    logger.info("transparency_generated period=%s scope=%s report=%s", period, scope, report_id)
    return report_id


def _all_org_ids(db: Any) -> list[str]:
    out: list[str] = []
    for snap in db.collection("orgs").stream():
        out.append(str(snap.id))
    return out


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scope",
        default="platform",
        help="'platform', or a specific orgId. Default: platform.",
    )
    parser.add_argument(
        "--period",
        default=None,
        help="YYYY-Qn (e.g. 2026-Q1). Default: previous quarter.",
    )
    parser.add_argument(
        "--skip-orgs",
        action="store_true",
        help="Don't generate per-org variants when --scope=platform.",
    )
    args = parser.parse_args(argv)

    db = _db()

    if args.period is None:
        period, start, end = transparency_service.previous_quarter()
    else:
        try:
            year_str, q_str = args.period.split("-Q")
            year = int(year_str)
            q = int(q_str)
            if q < 1 or q > 4:
                raise ValueError
        except ValueError:
            print(f"bad --period: {args.period!r} (expected YYYY-Qn)", file=sys.stderr)
            return 1
        from datetime import UTC, datetime

        start_month = (q - 1) * 3 + 1
        start = datetime(year, start_month, 1, tzinfo=UTC)
        end_year, end_month = (
            (year + 1, 1) if start_month + 3 > 12 else (year, start_month + 3)
        )
        end = datetime(end_year, end_month, 1, tzinfo=UTC)
        period = args.period

    _generate_one(db, period=period, start=start, end=end, scope=args.scope)

    if args.scope == "platform" and not args.skip_orgs:
        for org_id in _all_org_ids(db):
            _generate_one(db, period=period, start=start, end=end, scope=org_id)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
