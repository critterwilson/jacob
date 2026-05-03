"""Cloud Run Job — fetch today's Bible verse and cache it in Firestore.

Triggered by Cloud Scheduler at 07:00 UTC daily. Writes to
`daily_verse/{YYYY-MM-DD}`. Overwrites any existing doc for idempotency.

Environment variables:
  GCP_PROJECT_ID          — GCP project (required for Firestore)
  BIBLE_API_BASE          — override the base URL (default: https://bible-api.com)
  JACOB_VERSE_TRANSLATION — WEB or KJV (default: web, used inside verse.py)
  JACOB_VERSE_DISABLED    — set to "true" to skip without error exit
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime

logger = logging.getLogger("daily_verse")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def main() -> int:
    from app.services import verse as verse_svc

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as admin_firestore
    except ImportError:
        logger.error("firebase_admin not available")
        return 1

    if not firebase_admin._apps:  # noqa: SLF001
        firebase_admin.initialize_app()

    db = admin_firestore.client()

    if verse_svc._verse_disabled():  # noqa: SLF001
        logger.info("daily_verse_disabled: JACOB_VERSE_DISABLED is set — exiting cleanly")
        return 0

    now = datetime.now(UTC)
    date_str = now.strftime("%Y-%m-%d")

    try:
        doc = verse_svc.fetch_verse_for_today(today=now)
    except Exception:
        logger.exception("daily_verse_fetch_failed date=%s", date_str)
        try:
            import sentry_sdk
            sentry_sdk.capture_exception()
        except Exception:  # noqa: BLE001
            pass
        return 1

    db.collection("daily_verse").document(date_str).set(
        {
            "reference": doc.reference,
            "translation": doc.translation,
            "text": doc.text,
            "source": doc.source,
            "fetchedAt": admin_firestore.SERVER_TIMESTAMP,
        },
        merge=False,
    )
    logger.info(
        "daily_verse_written date=%s reference=%s source=%s",
        date_str,
        doc.reference,
        doc.source,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
