"""Shared helpers for the leader-application flow (ADR 0014).

`leader_applications/{appId}` is the queueing collection. On owner
approval the backend creates the target `groups/{gid}` document with
the applicant as leader (same shape as `POST /api/groups`).
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import status
from firebase_admin import firestore as fb_firestore

from app.errors import APIError
from app.models.group import DEFAULT_MEMBER_CAP
from app.models.leader_applications import LeaderApplicationView

logger = logging.getLogger(__name__)

_BASE32 = string.ascii_uppercase + "234567"


def _ts_to_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    converter = getattr(value, "ToDatetime", None)
    if callable(converter):
        try:
            result = converter(tzinfo=UTC)
        except TypeError:
            result = converter()
        if isinstance(result, datetime):
            return result if result.tzinfo else result.replace(tzinfo=UTC)
    return None


def leader_application_doc_to_view(app_id: str, data: dict[str, Any]) -> LeaderApplicationView:
    return LeaderApplicationView(
        appId=app_id,
        applicantUid=str(data.get("applicantUid") or ""),
        applicantDisplayName=str(data.get("applicantDisplayName") or ""),
        applicantEmail=data.get("applicantEmail"),
        proposedGroupName=str(data.get("proposedGroupName") or ""),
        proposedGroupDescription=str(data.get("proposedGroupDescription") or ""),
        proposedAudience=str(data.get("proposedAudience") or "christian"),  # type: ignore[arg-type]
        motivation=str(data.get("motivation") or ""),
        status=str(data.get("status") or "pending"),  # type: ignore[arg-type]
        createdAt=_ts_to_dt(data.get("createdAt")),
        decidedAt=_ts_to_dt(data.get("decidedAt")),
        decidedBy=data.get("decidedBy"),
        decisionNotes=str(data.get("decisionNotes") or ""),
        createdGroupId=data.get("createdGroupId"),
    )


def _new_invite_code() -> str:
    return "".join(secrets.choice(_BASE32) for _ in range(8))


def _unique_invite_code(db: Any) -> str:
    """Generate a top-level group inviteCode that doesn't collide.

    Mirrors `_unique_invite_code` in `routers/groups.py`. Duplicated here
    to keep the service-layer surface coherent and avoid a cross-router
    import; the algorithm is identical.
    """
    for _ in range(10):
        code = _new_invite_code()
        hits = list(db.collection("groups").where("inviteCode", "==", code).limit(1).stream())
        if not hits:
            return code
    raise APIError(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="code_generation_failed",
        message="Could not generate a unique invite code",
    )


def create_group_for_approved_application(
    db: Any,
    *,
    applicant_uid: str,
    name: str,
    description: str,
    audience: str,
) -> str:
    """Create a group with the applicant as leader and return the gid.

    Mirrors `POST /api/groups` so an approved application produces the
    same shape the rest of the codebase already understands.
    """
    code = _unique_invite_code(db)
    gid = str(uuid.uuid4())
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(applicant_uid)

    batch = db.batch()
    batch.set(
        group_ref,
        {
            "name": name.strip(),
            "description": description.strip(),
            "isPrivate": True,
            "createdBy": applicant_uid,
            "founderUid": applicant_uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "inviteCode": code,
            "memberCount": 1,
            "audience": audience,
            "stickerSet": audience,
            "orgId": None,
            "leaderUids": [applicant_uid],
            "leaderCount": 1,
            "schemaVersion": 1,
            "memberCap": DEFAULT_MEMBER_CAP,
        },
    )
    batch.set(
        member_ref,
        {
            "role": "leader",
            "joinedAt": fb_firestore.SERVER_TIMESTAMP,
            "uid": applicant_uid,
        },
    )
    batch.commit()
    logger.info("leader_application: created gid=%s applicant=%s", gid, applicant_uid)
    return gid


__all__ = [
    "create_group_for_approved_application",
    "leader_application_doc_to_view",
]
