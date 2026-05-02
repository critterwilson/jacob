"""Notification service: write per-user notification docs via the Admin SDK.

Writes to `users/{uid}/notifications/{nid}`, which is rule-locked to
system-only creates. Used by T24 (announcements), T27 (mentions), T34/T35
(push dispatch and digest).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from typing import Any

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)

_MAX_BATCH = 500


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
    """Write a single notification doc. Returns the new nid."""
    nid = str(uuid.uuid4())
    (
        db.collection("users")
        .document(recipient_uid)
        .collection("notifications")
        .document(nid)
        .set(
            {
                "kind": kind,
                "groupId": group_id,
                "messageRef": message_ref,
                "fromUid": from_uid,
                "body": body,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
                "readAt": None,
                "deliveredAt": None,
                "failedAt": None,
            }
        )
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
    """Write notifications to a list of recipients.

    If skip_blocked_by is True and from_uid is set, skips any recipient who
    has blocked from_uid. Also skips from_uid themselves.
    Returns the count of notifications actually written.
    """
    uids = list(recipient_uids)
    if not uids:
        return 0

    skip_uids: set[str] = set()
    if skip_blocked_by and from_uid:
        for uid in uids:
            if uid == from_uid:
                continue
            block_snap = (
                db.collection("users")
                .document(uid)
                .collection("blocks")
                .document(from_uid)
                .get()
            )
            if block_snap.exists:
                skip_uids.add(uid)

    doc_data = {
        "kind": kind,
        "groupId": group_id,
        "messageRef": message_ref,
        "fromUid": from_uid,
        "body": body,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "readAt": None,
        "deliveredAt": None,
        "failedAt": None,
    }

    count = 0
    batch = db.batch()
    batch_size = 0

    for uid in uids:
        if uid in skip_uids or uid == from_uid:
            continue
        nid = str(uuid.uuid4())
        ref = (
            db.collection("users")
            .document(uid)
            .collection("notifications")
            .document(nid)
        )
        batch.set(ref, doc_data)
        count += 1
        batch_size += 1
        if batch_size >= _MAX_BATCH:
            batch.commit()
            batch = db.batch()
            batch_size = 0

    if batch_size > 0:
        batch.commit()

    logger.info(
        "bulk_write_notifications kind=%s written=%d skipped=%d",
        kind,
        count,
        len(skip_uids),
    )
    return count
