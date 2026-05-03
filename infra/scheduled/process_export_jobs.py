"""Cloud Run Job — process pending self-serve export jobs (T38).

Cloud Scheduler invokes this job every 5 minutes. Each tick:

  1. Pulls up to ``PROCESSOR_BATCH_CAP`` unstarted job docs from the
     ``exports`` collection-group.
  2. For each, atomically claims (sets ``startedAt``), assembles the
     bundle, gzips, uploads to ``gs://jacob-exports-{env}/{uid}/{jobId}.json.gz``,
     and stamps ``completedAt`` + ``downloadUrl`` + ``expiresAt``.
  3. On failure: sets ``failedAt`` + ``failureReason`` and continues.

Why a separate job rather than the request handler:

  * Bundle assembly is unbounded in cost; pushing it to the request
    handler would require a long-running endpoint and tie up an API
    instance.
  * The user's email address may take an SMTP round-trip; doing it on
    the request handler couples the user-visible POST latency to
    SendGrid availability.
  * Scheduler retries are bounded by the OIDC binding in
    ``infra/scheduler.tf`` (max_retries = 1), giving us predictable
    blast-radius if the job ever wedges.

Concurrency cap (5 jobs per tick) plus the backend's "1 in-flight per
user" limit bound the worst case to "5 simultaneous bundle assemblies."
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import sentry_sdk

from app.config import get_settings
from app.services import export
from app.services.sentry import init_sentry

logger = logging.getLogger("process_export_jobs")
logging.basicConfig(level=logging.INFO)


def _job_path(snap: Any) -> str:
    ref = getattr(snap, "reference", None)
    return getattr(ref, "path", str(snap)) if ref is not None else str(snap)


def main() -> int:
    init_sentry()
    if get_settings().jacob_export_disabled:
        logger.info("export kill-switch active — exiting without processing")
        return 0
    pending = export.find_pending_jobs(limit=export.PROCESSOR_BATCH_CAP)
    logger.info("found %d pending export job(s)", len(pending))

    failures = 0
    for snap in pending:
        path = _job_path(snap)
        try:
            result = export.process_one(snap)
            logger.info(
                "processed path=%s status=%s",
                path,
                result.get("status"),
            )
        except Exception as exc:  # noqa: BLE001 — keep processing other jobs
            failures += 1
            logger.exception("process failed path=%s", path)
            try:
                sentry_sdk.capture_exception(exc)
            except Exception:  # noqa: BLE001 — Sentry must never crash the job
                logger.exception("sentry_capture_failed path=%s", path)

    logger.info("done processed=%d failed=%d", len(pending) - failures, failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
