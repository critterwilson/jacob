"""Notification service: write to users/{uid}/notifications/{nid} via Admin SDK.

Used by T24 (announcements), T27 (mentions), T34 (push), T35 (digest).
The notifications collection is server-only — clients can only read/mark-read.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

_BATCH_SIZE = 500


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def write_notification(
    db: Any,
    *,
    recipient_uid: str,
    kind: str,
    group_id: str | None,
    message_ref: str | None,
    from_uid: str | None,
    body: str | None,
) -> str:
    """Write a single notification doc. Returns the generated nid."""
    nid = str(uuid.uuid4())
    db.collection("users").document(recipient_uid).collection("notifications").document(nid).set(
        {
            "kind": kind,
            "groupId": group_id,
            "messageRef": message_ref,
            "fromUid": from_uid,
            "body": body[:200].replace("\n", " ") if body else None,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "readAt": None,
            "deliveredAt": None,
            "failedAt": None,
        }
    )
    return nid


def bulk_write_notifications(
    db: Any,
    *,
    recipient_uids: Iterable[str],
    kind: str,
    group_id: str | None,
    message_ref: str | None,
    from_uid: str | None,
    body: str | None,
    skip_blocked_by: bool = True,
) -> int:
    """Batch-write notifications, honoring blocks if from_uid is set.

    Returns the count actually written.
    """
    uids = list(recipient_uids)
    written = 0

    for i in range(0, len(uids), _BATCH_SIZE):
        chunk = uids[i : i + _BATCH_SIZE]
        batch = db.batch()
        chunk_written = 0

        for uid in chunk:
            if skip_blocked_by and from_uid:
                block_snap = (
                    db.collection("users")
                    .document(uid)
                    .collection("blocks")
                    .document(from_uid)
                    .get()
                )
                if block_snap.exists:
                    continue

            nid = str(uuid.uuid4())
            ref = db.collection("users").document(uid).collection("notifications").document(nid)
            batch.set(
                ref,
                {
                    "kind": kind,
                    "groupId": group_id,
                    "messageRef": message_ref,
                    "fromUid": from_uid,
                    "body": body[:200].replace("\n", " ") if body else None,
                    "createdAt": fb_firestore.SERVER_TIMESTAMP,
                    "readAt": None,
                    "deliveredAt": None,
                    "failedAt": None,
                },
            )
            chunk_written += 1

        batch.commit()
        written += chunk_written
        logger.info(
            "bulk_write_notifications kind=%s chunk=%d written=%d",
            kind,
            len(chunk),
            chunk_written,
        )

    return written
