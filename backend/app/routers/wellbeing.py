"""Wellbeing flag pipeline.

Two router objects:
  - `router`       — user-facing: POST /api/wellbeing/flags (authenticated, rate-limited)
  - `admin_router` — moderator/admin: GET/POST endpoints under /api/admin/wellbeing,
                     plus moderator grant/revoke under /api/admin/users/{uid}/moderator

Storage: moderation_queue collection (same backbone as existing flags).
  reason = "wellbeing_concern"
  status: "open" | "in_progress" | "resolved"  (distinct from pending/approved/rejected)
  status_history subcollection: {status, note, actorUid, createdAt}

The flagged person is NEVER notified — the regular _notify_reported_author in
admin.py is already gated on reason != "wellbeing_concern".
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin, require_moderator_or_admin
from app.errors import APIError
from app.limits import (
    MODERATOR_GRANT_REVOKE,
    WELLBEING_QUEUE_READ,
    WELLBEING_STATUS_WRITE,
    WELLBEING_SUBMIT,
)
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.models.wellbeing import (
    GrantModeratorRequest,
    GrantModeratorResponse,
    ModeratorListResponse,
    ModeratorUser,
    StatusHistoryEntry,
    SubmitWellbeingFlagRequest,
    SubmitWellbeingFlagResponse,
    TransitionStatusRequest,
    WellbeingAuditResponse,
    WellbeingQueueItem,
    WellbeingQueueResponse,
    valid_next_statuses,
)
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wellbeing", tags=["wellbeing"])
admin_router = APIRouter(prefix="/api/admin", tags=["wellbeing-admin"])

_PAGE_SIZE = 25
_DEDUP_WINDOW = timedelta(hours=24)


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_str(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        return ts.isoformat()
    except AttributeError:
        return str(ts)


# ── user-facing: submit a wellbeing flag ──────────────────────────────────────


@router.post(
    "/flags",
    status_code=status.HTTP_201_CREATED,
    response_model=SubmitWellbeingFlagResponse,
)
@limiter.limit(WELLBEING_SUBMIT)
def submit_wellbeing_flag(
    request: Request,
    response: Response,
    body: SubmitWellbeingFlagRequest,
    user: CurrentUser = Depends(get_current_user),
) -> SubmitWellbeingFlagResponse:
    """File a wellbeing concern about another member.

    The concern goes into moderation_queue with reason="wellbeing_concern"
    and status="open". The subject is never notified.

    Dedup: same (reporterUid, subjectUid) within 24 h returns the existing
    flag id with dedup=True.
    """
    db = _db()

    if body.messageId:
        resource_ref = f"groups/{body.groupId}/messages/{body.messageId}"
    else:
        resource_ref = f"users/{body.subjectUid}"

    cutoff = datetime.now(UTC) - _DEDUP_WINDOW
    existing = list(
        db.collection("moderation_queue")
        .where("reportedBy", "==", user.uid)
        .where("reason", "==", "wellbeing_concern")
        .where("subjectUid", "==", body.subjectUid)
        .where("createdAt", ">=", cutoff)
        .limit(1)
        .stream()
    )
    if existing:
        existing_id = existing[0].id
        logger.info(
            "wellbeing_flag_dedup reporter=%s subject=%s existing=%s",
            user.uid,
            body.subjectUid,
            existing_id,
        )
        return SubmitWellbeingFlagResponse(flagId=existing_id, dedup=True)

    flag_id = str(uuid.uuid4())
    db.collection("moderation_queue").document(flag_id).set(
        {
            "reason": "wellbeing_concern",
            "resourceRef": resource_ref,
            "resourceType": "profile" if not body.messageId else "message",
            "groupId": body.groupId,
            "reportedBy": user.uid,
            "subjectUid": body.subjectUid,
            "context": body.note,
            "status": "open",
            "severity": 2,
            "auto": False,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    # Seed the initial status_history entry
    db.collection("moderation_queue").document(flag_id).collection(
        "status_history"
    ).document(str(uuid.uuid4())).set(
        {
            "status": "open",
            "note": "(flag filed)",
            "actorUid": user.uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    logger.info(
        "wellbeing_flag_submitted id=%s reporter=%s subject=%s",
        flag_id,
        user.uid,
        body.subjectUid,
    )
    return SubmitWellbeingFlagResponse(flagId=flag_id, dedup=False)


# ── moderator: list wellbeing queue ──────────────────────────────────────────


_WELLBEING_STATUSES = {"open", "in_progress", "resolved"}


@admin_router.get("/wellbeing", response_model=WellbeingQueueResponse)
@limiter.limit(WELLBEING_QUEUE_READ)
def list_wellbeing_queue(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    status_filter: str = Query(default="open", alias="status"),
    moderator: CurrentUser = Depends(require_moderator_or_admin),
) -> WellbeingQueueResponse:
    if status_filter not in _WELLBEING_STATUSES:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_WELLBEING_STATUSES)}",
        )

    db = _db()
    query = (
        db.collection("moderation_queue")
        .where("reason", "==", "wellbeing_concern")
        .where("status", "==", status_filter)
        .order_by("createdAt")
        .limit(limit + 1)
    )
    if cursor:
        cursor_snap = db.collection("moderation_queue").document(cursor).get()
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)

    docs = list(query.stream())
    has_more = len(docs) > limit
    page = docs[:limit]

    items = []
    for doc in page:
        data = doc.to_dict() or {}
        resource_ref: str = data.get("resourceRef", "")
        parts = resource_ref.strip("/").split("/")
        msg_id = parts[3] if len(parts) == 4 and parts[2] == "messages" else None
        items.append(
            WellbeingQueueItem(
                itemId=doc.id,
                reporterUid=data.get("reportedBy"),
                subjectUid=data.get("subjectUid"),
                resourceRef=resource_ref,
                note=data.get("context"),
                status=data.get("status", "open"),
                createdAt=_ts_to_str(data.get("createdAt")),
                messageId=msg_id,
                groupId=data.get("groupId"),
            )
        )

    next_cursor = page[-1].id if has_more and page else None
    return WellbeingQueueResponse(items=items, nextCursor=next_cursor)


# ── moderator: status transition ──────────────────────────────────────────────


@admin_router.post("/wellbeing/{item_id}/status", response_model=WellbeingQueueItem)
@limiter.limit(WELLBEING_STATUS_WRITE)
def transition_wellbeing_status(
    item_id: str,
    request: Request,
    response: Response,
    body: TransitionStatusRequest,
    moderator: CurrentUser = Depends(require_moderator_or_admin),
) -> WellbeingQueueItem:
    """Transition a wellbeing flag: open → in_progress → resolved.

    Every transition requires a note. The note is audit-logged to both
    audit_log and the item's status_history subcollection.
    """
    db = _db()
    item_ref = db.collection("moderation_queue").document(item_id)
    item_snap = item_ref.get()

    if not item_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="item_not_found",
            message="Wellbeing flag not found",
        )

    item_data = item_snap.to_dict() or {}
    if item_data.get("reason") != "wellbeing_concern":
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="wrong_reason",
            message="This endpoint only handles wellbeing_concern flags",
        )

    current_status = item_data.get("status", "open")
    allowed = valid_next_statuses(current_status)
    if body.status not in allowed:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=f"Cannot transition from '{current_status}' to '{body.status}'. "
            f"Allowed: {sorted(allowed) or 'none'}",
        )

    item_ref.update({"status": body.status, "lastModeratorUid": moderator.uid})
    item_ref.collection("status_history").document(str(uuid.uuid4())).set(
        {
            "status": body.status,
            "note": body.note,
            "actorUid": moderator.uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    write_audit_log(
        actor_uid=moderator.uid,
        action=f"wellbeing_{body.status}",
        target_ref=f"moderation_queue/{item_id}",
        payload={"note": body.note, "previousStatus": current_status},
    )

    logger.info(
        "wellbeing_status_transition id=%s from=%s to=%s moderator=%s",
        item_id,
        current_status,
        body.status,
        moderator.uid,
    )

    updated_data = item_snap.to_dict() or {}
    updated_data["status"] = body.status
    resource_ref: str = updated_data.get("resourceRef", "")
    parts = resource_ref.strip("/").split("/")
    msg_id = parts[3] if len(parts) == 4 and parts[2] == "messages" else None

    return WellbeingQueueItem(
        itemId=item_id,
        reporterUid=updated_data.get("reportedBy"),
        subjectUid=updated_data.get("subjectUid"),
        resourceRef=resource_ref,
        note=updated_data.get("context"),
        status=body.status,
        createdAt=_ts_to_str(updated_data.get("createdAt")),
        messageId=msg_id,
        groupId=updated_data.get("groupId"),
    )


# ── moderator: audit trail ────────────────────────────────────────────────────


@admin_router.get("/wellbeing/{item_id}/audit", response_model=WellbeingAuditResponse)
@limiter.limit(WELLBEING_QUEUE_READ)
def get_wellbeing_audit(
    item_id: str,
    request: Request,
    response: Response,
    moderator: CurrentUser = Depends(require_moderator_or_admin),
) -> WellbeingAuditResponse:
    db = _db()
    item_snap = db.collection("moderation_queue").document(item_id).get()
    if not item_snap.exists or (item_snap.to_dict() or {}).get("reason") != "wellbeing_concern":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="item_not_found",
            message="Wellbeing flag not found",
        )

    history_docs = list(
        db.collection("moderation_queue")
        .document(item_id)
        .collection("status_history")
        .order_by("createdAt")
        .stream()
    )
    history = [
        StatusHistoryEntry(
            status=(doc.to_dict() or {}).get("status", ""),
            note=(doc.to_dict() or {}).get("note", ""),
            actorUid=(doc.to_dict() or {}).get("actorUid", ""),
            createdAt=_ts_to_str((doc.to_dict() or {}).get("createdAt")),
        )
        for doc in history_docs
    ]
    return WellbeingAuditResponse(history=history)


# ── admin: moderator role management ─────────────────────────────────────────


@admin_router.get("/moderators", response_model=ModeratorListResponse)
@limiter.limit(WELLBEING_QUEUE_READ)
def list_moderators(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> ModeratorListResponse:
    """List all users who hold the `moderator` custom claim."""
    init_firebase_admin()
    page = firebase_auth.list_users()
    moderators: list[ModeratorUser] = []
    for user in page.users:
        claims = user.custom_claims or {}
        if claims.get("moderator") is True:
            moderators.append(
                ModeratorUser(
                    uid=user.uid,
                    email=user.email,
                    displayName=user.display_name,
                )
            )
    return ModeratorListResponse(moderators=moderators)


@admin_router.post("/users/{uid}/moderator", response_model=GrantModeratorResponse)
@limiter.limit(MODERATOR_GRANT_REVOKE)
def set_moderator_claim(
    uid: str,
    request: Request,
    response: Response,
    body: GrantModeratorRequest,
    admin: CurrentUser = Depends(require_admin),
) -> GrantModeratorResponse:
    """Grant or revoke the `moderator` custom claim for a user.

    Send `{"grant": true}` to grant, `{"grant": false}` to revoke.
    The existing claims are preserved; only `moderator` is touched.
    """
    init_firebase_admin()
    try:
        fb_user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="User not found",
        )

    existing = dict(fb_user.custom_claims or {})
    if body.grant:
        existing["moderator"] = True
    else:
        existing.pop("moderator", None)

    firebase_auth.set_custom_user_claims(uid, existing)

    write_audit_log(
        actor_uid=admin.uid,
        action="moderator_grant" if body.grant else "moderator_revoke",
        target_ref=f"users/{uid}",
        payload={"grant": body.grant},
    )

    logger.info(
        "admin=%s set_moderator uid=%s grant=%s", admin.uid, uid, body.grant
    )
    return GrantModeratorResponse(uid=uid, moderator=body.grant)
