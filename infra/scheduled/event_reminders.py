"""Cloud Run scheduled job: fan out event reminders (T49).

Runs every 15 minutes. For each event whose `startsAt` lands in the
[now+60min, now+75min) window and whose `reminderSentAt` is unset,
write one `users/{uid}/notifications/{nid}` row per RSVP'd-going
member, then mark `reminderSentAt`.

Operator setup:
    gcloud scheduler jobs create http event-reminders \\
        --schedule="*/15 * * * *" \\
        --uri="https://<job-url>" \\
        --http-method=GET --oidc-service-account-email <sa>

Env:
    EVENT_REMINDERS_DISABLED=true   # kill switch
    JACOB_EVENT_REMINDER_LEAD_MIN   # default 60
    JACOB_EVENT_REMINDER_WINDOW_MIN # default 15

Usage (local one-shot):
    cd backend
    python ../infra/scheduled/event_reminders.py [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services import events as events_service
from app.services.firebase import init_firebase_admin

logger = logging.getLogger("event_reminders")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def run(*, db: Any | None = None, now: datetime | None = None, dry_run: bool = False) -> int:
    """Fan out reminders. Returns the number of events processed."""
    if os.environ.get("EVENT_REMINDERS_DISABLED", "").lower() in {"1", "true", "yes"}:
        logger.info("event_reminders disabled by env var")
        return 0

    db = db or _db()
    now = now or datetime.now(UTC)
    lead = int(os.environ.get("JACOB_EVENT_REMINDER_LEAD_MIN", "60"))
    window = int(os.environ.get("JACOB_EVENT_REMINDER_WINDOW_MIN", "15"))

    due = events_service.find_due_reminders(
        db,
        now=now,
        lead_minutes=lead,
        window_minutes=window,
    )
    if not due:
        logger.info("event_reminders no_due_events lead=%d window=%d", lead, window)
        return 0

    for event in due:
        gid = event["gid"]
        event_id = event["eventId"]
        title = str(event.get("title", ""))
        starts_at = event.get("startsAt") or now
        if dry_run:
            logger.info(
                "event_reminders dry_run gid=%s event=%s title=%r",
                gid,
                event_id,
                title,
            )
            continue
        try:
            count = events_service.fan_out_event_reminder(
                db,
                gid=gid,
                event_id=event_id,
                title=title,
                starts_at=starts_at,
            )
        except Exception:
            logger.exception(
                "event_reminders fanout_failed gid=%s event=%s",
                gid,
                event_id,
            )
            continue
        events_service.mark_reminder_sent(event["_ref"])
        logger.info(
            "event_reminders sent gid=%s event=%s notified=%d",
            gid,
            event_id,
            count,
        )
    return len(due)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv[1:])
    n = run(dry_run=args.dry_run)
    print(f"event_reminders processed={n} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
