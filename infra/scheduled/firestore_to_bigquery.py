"""Cloud Run Job: load daily Firestore export into BigQuery.

Triggered by Cloud Scheduler at 04:30 UTC every day.

Idempotency: uses WRITE_TRUNCATE into a date-partitioned table so
running it twice for the same day produces the same row count.

Environment variables:
  GOOGLE_CLOUD_PROJECT  — GCP project ID (injected by Cloud Run)
  BQ_ANALYTICS_DATASET  — BigQuery dataset (default: jacob_analytics)
  BQ_BACKUPS_BUCKET     — GCS bucket holding Firestore exports
  EXPORT_DATE           — Optional override; defaults to yesterday (YYYY-MM-DD)
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime, timedelta

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def _get_env(key: str, default: str = "") -> str:
    val = os.environ.get(key, default)
    if not val and not default:
        raise EnvironmentError(f"Required env var {key!r} is not set")
    return val


def run(export_date: str | None = None) -> int:
    """Load Firestore export for `export_date` into BigQuery.

    Returns the number of rows loaded (useful for idempotency tests).
    """
    from google.cloud import bigquery  # type: ignore[import-untyped]

    project = _get_env("GOOGLE_CLOUD_PROJECT")
    dataset = os.environ.get("BQ_ANALYTICS_DATASET", "jacob_analytics")
    bucket = _get_env("BQ_BACKUPS_BUCKET")

    if export_date is None:
        export_date = os.environ.get(
            "EXPORT_DATE",
            (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d"),
        )

    logger.info(
        '{"event":"loader_start","project":"%s","dataset":"%s","date":"%s"}',
        project,
        dataset,
        export_date,
    )

    client = bigquery.Client(project=project)
    table_id = f"{project}.{dataset}.messages_raw_{export_date.replace('-', '')}"
    gcs_uri = (
        f"gs://{bucket}/daily/{export_date}/all_namespaces/all_kinds/output-*"
    )

    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.DATASTORE_BACKUP,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        autodetect=True,
    )

    load_job = client.load_table_from_uri(gcs_uri, table_id, job_config=job_config)

    try:
        load_job.result()
    except Exception as exc:
        logger.error(
            '{"event":"loader_failed","date":"%s","error":"%s"}',
            export_date,
            str(exc),
        )
        raise

    dest = client.get_table(table_id)
    row_count: int = dest.num_rows

    logger.info(
        '{"event":"loader_done","date":"%s","table":"%s","rows":%d}',
        export_date,
        table_id,
        row_count,
    )
    return row_count


if __name__ == "__main__":
    try:
        rows = run()
        sys.exit(0)
    except Exception:
        sys.exit(1)
