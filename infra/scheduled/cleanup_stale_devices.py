"""Cloud Run Job — prune stale FCM device docs (T34).

A device doc is considered stale when `lastSeenAt` is older than
STALE_DAYS days. Stale devices accumulate when users switch browsers,
uninstall the PWA, or clear site data without explicitly signing out.

Triggered by Cloud Scheduler daily. Idempotent: re-running on the same
day deletes the same documents (those with lastSeenAt still past the window).

Environment variables:
  GCP_PROJECT_ID  — GCP project that owns the Firestore database
  STALE_DEVICE_DAYS — integer, default 60
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("cleanup_stale_devices")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

STALE_DAYS = int(os.environ.get("STALE_DEVICE_DAYS", "60"))


def main() -> int:
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as admin_firestore
    except ImportError:
        logger.error("firebase_admin not available")
        return 1

    if not firebase_admin._apps:  # noqa: SLF001
        firebase_admin.initialize_app()

    db = admin_firestore.client()
    cutoff = datetime.now(UTC) - timedelta(days=STALE_DAYS)
    logger.info("pruning devices with lastSeenAt < %s", cutoff.isoformat())

    deleted = 0
    errors = 0

    users_ref = db.collection("users")
    # Collection-group query requires a composite index; see firestore.indexes.json.
    stale_query = db.collection_group("devices").where(
        "lastSeenAt", "<", cutoff
    )

    for device_snap in stale_query.stream():
        try:
            device_snap.reference.delete()
            deleted += 1
        except Exception:  # noqa: BLE001
            logger.exception(
                "delete_failed path=%s", device_snap.reference.path
            )
            errors += 1

    logger.info(
        "cleanup_stale_devices_done deleted=%d errors=%d cutoff=%s",
        deleted,
        errors,
        cutoff.isoformat(),
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
