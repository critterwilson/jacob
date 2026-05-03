"""Cloud Run Job — send weekly email digests (T35).

Triggered by Cloud Scheduler at 16:00 UTC every Sunday.

Iterates users where `users/{uid}/notificationPrefs/main.digest == true`
via a collection-group query, builds a DigestPayload per user, mints an
unsubscribe JWT, and sends via SendGrid.

Batch behaviour: after every DIGEST_BATCH_SIZE users, sleep 1 second to
avoid overwhelming SendGrid. Final failures are written to `audit_log`
and forwarded to Sentry; the job still continues to the next user.

Environment variables:
  GCP_PROJECT_ID          — GCP project (required for Firestore Admin)
  JACOB_DIGEST_ENABLED    — must be "true" to run (kill-switch)
  SENDGRID_API_KEY        — required to actually send; unset → skipped
  SENDGRID_SANDBOX        — "true" uses the SendGrid sandbox (no sends)
  JWT_UNSUBSCRIBE_SECRET  — HS256 secret for unsubscribe token
  DIGEST_BATCH_SIZE       — users per batch (default: 200)
  BQ_ANALYTICS_DATASET    — BigQuery dataset for sticker/member views
"""

from __future__ import annotations

import logging
import os
import sys
import time
from typing import Any

logger = logging.getLogger("weekly_digest")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def _iter_digest_uids(db: Any) -> list[str]:
    """Return UIDs of users whose notificationPrefs/main.digest is true."""
    uids: list[str] = []
    try:
        prefs_snaps = (
            db.collection_group("notificationPrefs")
            .where("digest", "==", True)
            .stream()
        )
        for snap in prefs_snaps:
            parts = snap.reference.path.split("/")
            if len(parts) >= 2 and parts[0] == "users":
                uids.append(parts[1])
    except Exception:
        logger.exception("digest_iter_uids_failed")
    return uids


def _write_audit(db: Any, uid: str, reason: str) -> None:
    try:
        from firebase_admin import firestore as admin_firestore

        db.collection("audit_log").add({
            "actorUid": "system",
            "action": f"digest_{reason}",
            "targetRef": f"users/{uid}",
            "createdAt": admin_firestore.SERVER_TIMESTAMP,
            "payload": {"reason": reason},
        })
    except Exception:
        logger.exception("audit_write_failed uid=%s", uid)


def run(
    *,
    db: Any | None = None,
    bq_client: Any | None = None,
    dataset: str | None = None,
    batch_size: int | None = None,
) -> dict[str, int]:
    """Execute the digest job. Returns {sent, failed, skipped} counts.

    Arguments are optional overrides for testing; production uses env vars.
    """
    from app.services.digest import DigestDisabledError, assemble_user_payload
    from app.services.email import send_weekly_digest
    from app.services.unsubscribe import mint_unsubscribe_token

    if db is None:
        try:
            import firebase_admin
            from firebase_admin import firestore as admin_firestore

            if not firebase_admin._apps:  # noqa: SLF001
                firebase_admin.initialize_app()
            db = admin_firestore.client()
        except ImportError:
            logger.error("firebase_admin not available")
            return {"sent": 0, "failed": 0, "skipped": 0}

    if bq_client is None:
        try:
            import google.cloud.bigquery as bq

            bq_client = bq.Client()
        except Exception:
            logger.warning("BigQuery client unavailable; BQ stats will be empty")

    resolved_dataset = dataset or os.environ.get("BQ_ANALYTICS_DATASET", "jacob_analytics")
    resolved_batch = batch_size if batch_size is not None else int(
        os.environ.get("DIGEST_BATCH_SIZE", "200")
    )

    uids = _iter_digest_uids(db)
    logger.info("weekly_digest_start users=%d", len(uids))

    sent = failed = skipped = 0
    batch_count = 0

    for uid in uids:
        try:
            payload = assemble_user_payload(
                uid, db=db, bq_client=bq_client, dataset=resolved_dataset
            )
        except DigestDisabledError:
            logger.info("digest_disabled uid=%s — exiting", uid)
            break
        except Exception:
            logger.exception("digest_assemble_failed uid=%s", uid)
            failed += 1
            _write_audit(db, uid, "assemble_failed")
            try:
                import sentry_sdk
                sentry_sdk.capture_exception()
            except Exception:  # noqa: BLE001
                pass
            continue

        if not payload.email:
            skipped += 1
            continue

        try:
            unsub_token = mint_unsubscribe_token(payload.uid, "digest")
            send_weekly_digest(payload.email, payload, unsub_token)
            sent += 1
        except Exception:
            logger.exception("digest_send_failed uid=%s email_len=%d", uid, len(payload.email))
            failed += 1
            _write_audit(db, uid, "send_failed")
            try:
                import sentry_sdk
                sentry_sdk.capture_exception()
            except Exception:  # noqa: BLE001
                pass

        batch_count += 1
        if batch_count >= resolved_batch:
            logger.info("digest_batch_sleep sent_so_far=%d", sent)
            time.sleep(1)
            batch_count = 0

    logger.info(
        "weekly_digest_done sent=%d failed=%d skipped=%d", sent, failed, skipped
    )
    return {"sent": sent, "failed": failed, "skipped": skipped}


def main() -> int:
    result = run()
    return 1 if result["failed"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
