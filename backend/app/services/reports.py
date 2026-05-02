"""Report submission service: writes to moderation_queue with dedup.

A report is `(reporterUid, resourceRef, reason)` — submitting the same
triple twice within the dedup window is a no-op (the second call returns
the existing report id with `dedup=True`). This matches T19's spec:
moderators don't want spam; users who click Report twice shouldn't error.

Severity is derived from `reason`:
    sexual / self-harm / violence -> 3
    harassment                    -> 2
    spam / other                  -> 1

Banned reporters are rejected at the router layer; this service trusts
its inputs.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

ReportReason = Literal["harassment", "sexual", "violence", "self-harm", "spam", "other"]
ResourceType = Literal["message", "profile", "group"]

DEDUP_WINDOW = timedelta(hours=24)

_SEVERITY_BY_REASON: dict[str, int] = {
    "sexual": 3,
    "self-harm": 3,
    "violence": 3,
    "harassment": 2,
    "spam": 1,
    "other": 1,
}


@dataclass(frozen=True)
class ReportResult:
    report_id: str
    dedup: bool
    severity: int


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def severity_for(reason: str) -> int:
    return _SEVERITY_BY_REASON.get(reason, 1)


def build_resource_ref(resource_type: ResourceType, resource_id: str, group_id: str | None) -> str:
    if resource_type == "message":
        if not group_id:
            raise ValueError("group_id is required for message reports")
        return f"groups/{group_id}/messages/{resource_id}"
    if resource_type == "group":
        return f"groups/{resource_id}"
    if resource_type == "profile":
        return f"users/{resource_id}"
    raise ValueError(f"Unknown resource_type: {resource_type}")


def submit_report(
    *,
    reporter_uid: str,
    resource_type: ResourceType,
    resource_id: str,
    group_id: str | None,
    reason: ReportReason,
    context: str,
    db: Any | None = None,
) -> ReportResult:
    """Write a moderation_queue doc unless an identical pending report
    from the same reporter exists within DEDUP_WINDOW.

    Returns the (existing or new) report id; `dedup=True` when the call
    short-circuited because of an existing report.
    """
    db = db or _db()
    resource_ref = build_resource_ref(resource_type, resource_id, group_id)
    severity = severity_for(reason)
    cutoff = datetime.now(UTC) - DEDUP_WINDOW

    # Dedup: same reporter + resource + reason in the past 24h.
    dedup_query = (
        db.collection("moderation_queue")
        .where("reportedBy", "==", reporter_uid)
        .where("resourceRef", "==", resource_ref)
        .where("reason", "==", reason)
        .where("createdAt", ">=", cutoff)
        .limit(1)
    )
    existing = list(dedup_query.stream())
    if existing:
        existing_id = existing[0].id
        logger.info(
            "report_dedup uid=%s resource=%s reason=%s existing=%s",
            reporter_uid,
            resource_ref,
            reason,
            existing_id,
        )
        return ReportResult(report_id=existing_id, dedup=True, severity=severity)

    report_id = str(uuid.uuid4())
    db.collection("moderation_queue").document(report_id).set(
        {
            "resourceRef": resource_ref,
            "resourceType": resource_type,
            "groupId": group_id,
            "reason": reason,
            "severity": severity,
            "context": context,
            "reportedBy": reporter_uid,
            "status": "pending",
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "auto": False,
        }
    )
    logger.info(
        "report_submitted id=%s uid=%s resource=%s reason=%s severity=%s",
        report_id,
        reporter_uid,
        resource_ref,
        reason,
        severity,
    )
    return ReportResult(report_id=report_id, dedup=False, severity=severity)
