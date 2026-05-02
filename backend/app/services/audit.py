"""Audit log service: writes to audit_log collection via the Admin SDK.

Every admin action (ban, unban, moderation resolution) calls write_audit_log
so there is an immutable server-side record of who did what and when.
The audit_log collection has `allow read, write: if false` in Firestore
security rules; only server-side code using the Admin SDK can write to it.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def write_audit_log(
    *,
    actor_uid: str,
    action: str,
    target_ref: str,
    payload: dict[str, Any] | None = None,
) -> None:
    db = _db()
    event_id = str(uuid.uuid4())
    db.collection("audit_log").document(event_id).set(
        {
            "actorUid": actor_uid,
            "action": action,
            "targetRef": target_ref,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "payload": payload or {},
        }
    )
    logger.info("audit action=%s actor=%s target=%s", action, actor_uid, target_ref)
