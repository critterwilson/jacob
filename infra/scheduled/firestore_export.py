"""Cloud Run job — export Firestore to GCS for daily/weekly backups.

Triggered by Cloud Scheduler at 03:00 UTC every day. The job always writes
a daily export; on Sundays it also writes a weekly snapshot.

Destination layout:
  gs://{BACKUP_BUCKET}/daily/{YYYY-MM-DD}/
  gs://{BACKUP_BUCKET}/weekly/{YYYY-Www}/    (Sundays only)

Environment variables:
  GCP_PROJECT_ID  — GCP project that owns the Firestore database (default)
  BACKUP_BUCKET   — bucket name without gs:// prefix, e.g. jacob-backups-prod
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime

from google.cloud import firestore_admin_v1

logger = logging.getLogger("firestore_export")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_PROJECT_ID = os.environ["GCP_PROJECT_ID"]
_BACKUP_BUCKET = os.environ["BACKUP_BUCKET"]


def _export(output_uri_prefix: str, label: str) -> None:
    client = firestore_admin_v1.FirestoreAdminClient()
    database = f"projects/{_PROJECT_ID}/databases/(default)"
    logger.info("starting %s export to %s", label, output_uri_prefix)

    operation = client.export_documents(
        request={
            "name": database,
            "output_uri_prefix": output_uri_prefix,
        }
    )
    result = operation.result(timeout=600)
    logger.info("%s export complete output_uri_prefix=%s", label, result.output_uri_prefix)


def main() -> int:
    now = datetime.now(UTC)
    date_str = now.strftime("%Y-%m-%d")
    # Include HH-MM-SS so Cloud Scheduler retries don't collide with the
    # original run's non-empty output prefix.
    datetime_str = now.strftime("%Y-%m-%d-%H%M%S")
    week_str = now.strftime("%Y-W%V")

    failures = 0

    try:
        _export(f"gs://{_BACKUP_BUCKET}/daily/{datetime_str}", "daily")
    except Exception:
        logger.exception("daily export failed date=%s", date_str)
        failures += 1

    # Sunday == isoweekday 7
    if now.isoweekday() == 7:
        try:
            _export(f"gs://{_BACKUP_BUCKET}/weekly/{week_str}", "weekly")
        except Exception:
            logger.exception("weekly export failed week=%s", week_str)
            failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
