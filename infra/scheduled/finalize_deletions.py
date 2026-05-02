"""Daily Cloud Scheduler job — finalize accounts past their grace window.

Runs as a Cloud Run Job (or `python -m`) once per day. Reuses the same
service code as the request endpoint so we don't have two implementations
of the deletion semantics. The job is idempotent: if a UID is already
finalized, `finalize_account` returns `{"status": "already_gone"}` and
the loop continues.

Recommended cron: `0 4 * * *` (04:00 UTC, after the daily Firestore export
in T16).
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime

from app.services import deletion

logger = logging.getLogger("finalize_deletions")
logging.basicConfig(level=logging.INFO)


def main() -> int:
    now = datetime.now(UTC)
    due = deletion.find_users_due(now=now)
    logger.info("found %d account(s) due for finalization at %s", len(due), now.isoformat())

    failures = 0
    for uid in due:
        try:
            result = deletion.finalize_account(uid)
            logger.info("finalized uid=%s result=%s", uid, result.get("status"))
        except Exception:  # noqa: BLE001 — keep running other UIDs
            logger.exception("finalize failed uid=%s", uid)
            failures += 1

    logger.info("done finalized=%d failed=%d", len(due) - failures, failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
