"""Admin router: moderation queue, user ban/unban, group search.

All endpoints require the `admin` custom claim (enforced by `require_admin`).
Every mutating action writes an audit_log entry via `services.audit`.

Collections accessed here (moderation_queue, bans, audit_log, users, groups)
all have `allow read, write: if false` in Firestore security rules; the
Admin SDK bypasses those rules by design.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import require_admin
from app.errors import APIError
from app.limits import ADMIN_MUTATION
from app.middleware.rate_limit import limiter
from app.models.admin import (
    AdminGroup,
    AdminGroupListResponse,
    AdminUser,
    AdminUserListResponse,
    BanRequest,
    BanResponse,
    ModerationItem,
    ModerationListResponse,
    ResolveRequest,
    ResolveResponse,
    UnbanResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.email import send_moderation_notice
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

_PAGE_SIZE = 20


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_str(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        result: str = ts.isoformat()
        return result
    except AttributeError:
        return str(ts)


# ── helpers ────────────────────────────────────────────────────────────────────


def _notify_reported_author(db: Any, item_data: dict[str, Any]) -> None:
    """Best-effort: look up the author of *resourceRef* and send a moderation notice.

    Supports message resources (groups/{gid}/messages/{mid}).
    Silently skips if the resource path is unrecognised, already deleted,
    or if the email send fails — moderation action should never be blocked.
    """
    resource_ref: str = item_data.get("resourceRef", "")
    reason: str = item_data.get("reason", "")
    parts = resource_ref.strip("/").split("/")

    try:
        if len(parts) == 4 and parts[0] == "groups" and parts[2] == "messages":
            gid, mid = parts[1], parts[3]
            msg_snap = (
                db.collection("groups").document(gid).collection("messages").document(mid).get()
            )
            if not msg_snap.exists:
                return
            author_uid: str = (msg_snap.to_dict() or {}).get("authorUid", "")
            if not author_uid:
                return
            user_snap = db.collection("users").document(author_uid).get()
            if not user_snap.exists:
                return
            user_data = user_snap.to_dict() or {}
            send_moderation_notice(
                to_email=user_data.get("email", ""),
                display_name=user_data.get("displayName", ""),
                reason=reason,
                resource_type="message",
            )
    except Exception:
        logger.exception("moderation_notice email failed resource=%s", resource_ref)


# ── moderation queue ──────────────────────────────────────────────────────────


@router.get("/moderation", response_model=ModerationListResponse)
def list_moderation_queue(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    admin: CurrentUser = Depends(require_admin),
) -> ModerationListResponse:
    db = _db()
    query = (
        db.collection("moderation_queue")
        .where("status", "==", "pending")
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
        extra = {
            k: v
            for k, v in data.items()
            if k not in {"resourceRef", "reason", "status", "uploaderUid", "createdAt"}
        }
        items.append(
            ModerationItem(
                itemId=doc.id,
                resourceRef=data.get("resourceRef", ""),
                reason=data.get("reason"),
                status=data.get("status", "pending"),
                uploaderUid=data.get("uploaderUid"),
                createdAt=_ts_to_str(data.get("createdAt")),
                extra=extra,
            )
        )

    next_cursor = page[-1].id if has_more and page else None
    return ModerationListResponse(items=items, nextCursor=next_cursor)


@router.post("/moderation/{item_id}/resolve", response_model=ResolveResponse)
@limiter.limit(ADMIN_MUTATION)
def resolve_moderation_item(
    item_id: str,
    request: Request,
    response: Response,
    body: ResolveRequest,
    admin: CurrentUser = Depends(require_admin),
) -> ResolveResponse:
    db = _db()
    item_ref = db.collection("moderation_queue").document(item_id)
    item_snap = item_ref.get()

    if not item_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="item_not_found",
            message="Moderation queue item not found",
        )

    item_data = item_snap.to_dict() or {}
    if item_data.get("status") != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_resolved",
            message="Moderation queue item has already been resolved",
        )

    new_status = "approved" if body.resolution == "approve" else "rejected"
    item_ref.update({"status": new_status, "reviewedBy": admin.uid})

    write_audit_log(
        actor_uid=admin.uid,
        action=f"moderation_{new_status}",
        target_ref=f"moderation_queue/{item_id}",
        payload={
            "resolution": body.resolution,
            "resourceRef": item_data.get("resourceRef", ""),
        },
    )

    logger.info("admin=%s resolved item=%s as=%s", admin.uid, item_id, new_status)

    if new_status == "rejected":
        _notify_reported_author(db, item_data)

    return ResolveResponse(itemId=item_id, status=new_status)


# ── users ──────────────────────────────────────────────────────────────────────


@router.get("/users", response_model=AdminUserListResponse)
def search_users(
    q: str = Query(default=""),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    admin: CurrentUser = Depends(require_admin),
) -> AdminUserListResponse:
    db = _db()

    if q:
        # Firestore prefix search on displayName
        users_query = (
            db.collection("users")
            .where("displayName", ">=", q)
            .where("displayName", "<=", q + "")
            .limit(limit)
        )
    else:
        users_query = (
            db.collection("users").order_by("createdAt", direction="DESCENDING").limit(limit)
        )

    docs = list(users_query.stream())

    # Collect UIDs to check bans in a single batch
    uids = [doc.id for doc in docs]
    banned_uids: set[str] = set()
    if uids:
        now = datetime.now(UTC)
        for uid in uids:
            ban_snap = db.collection("bans").document(uid).get()
            if ban_snap.exists:
                ban_data = ban_snap.to_dict() or {}
                expires = ban_data.get("expiresAt")
                if expires is None or expires > now:
                    banned_uids.add(uid)

    users = []
    for doc in docs:
        data = doc.to_dict() or {}
        users.append(
            AdminUser(
                uid=doc.id,
                displayName=data.get("displayName"),
                email=data.get("email"),
                createdAt=_ts_to_str(data.get("createdAt")),
                isBanned=doc.id in banned_uids,
            )
        )

    return AdminUserListResponse(users=users)


@router.post("/users/{uid}/ban", response_model=BanResponse)
@limiter.limit(ADMIN_MUTATION)
def ban_user(
    uid: str,
    request: Request,
    response: Response,
    body: BanRequest,
    admin: CurrentUser = Depends(require_admin),
) -> BanResponse:
    db = _db()
    now = datetime.now(UTC)
    if body.duration == "24h":
        expires_at = now + timedelta(hours=24)
    elif body.duration == "7d":
        expires_at = now + timedelta(days=7)
    else:
        expires_at = datetime(2099, 12, 31, tzinfo=UTC)

    ban_ref = db.collection("bans").document(uid)
    existing_snap = ban_ref.get()
    existing_data = existing_snap.to_dict() if existing_snap.exists else {}
    existing_expires = existing_data.get("expiresAt")

    # Refuse to shorten an active ban (admin must explicitly unban first).
    if existing_snap.exists and existing_expires is not None and existing_expires > expires_at:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="ban_already_longer",
            message="An existing ban expires later than the requested one; unban first",
        )

    ban_ref.set({"reason": body.reason, "bannedBy": admin.uid, "expiresAt": expires_at})

    audit_payload: dict[str, object] = {"reason": body.reason, "duration": body.duration}
    if existing_snap.exists:
        audit_payload["previousExpiresAt"] = _ts_to_str(existing_expires)
        audit_payload["previousBannedBy"] = existing_data.get("bannedBy")

    write_audit_log(
        actor_uid=admin.uid,
        action="ban_user",
        target_ref=f"users/{uid}",
        payload=audit_payload,
    )

    logger.info("admin=%s banned uid=%s duration=%s", admin.uid, uid, body.duration)
    return BanResponse(uid=uid, banned=True)


@router.post("/users/{uid}/unban", response_model=UnbanResponse)
@limiter.limit(ADMIN_MUTATION)
def unban_user(
    uid: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> UnbanResponse:
    db = _db()
    ban_ref = db.collection("bans").document(uid)
    ban_snap = ban_ref.get()
    if ban_snap.exists:
        ban_ref.delete()

    write_audit_log(
        actor_uid=admin.uid,
        action="unban_user",
        target_ref=f"users/{uid}",
        payload={"was_banned": ban_snap.exists},
    )

    logger.info("admin=%s unbanned uid=%s was_banned=%s", admin.uid, uid, ban_snap.exists)
    return UnbanResponse(uid=uid, unbanned=True)


# ── groups ─────────────────────────────────────────────────────────────────────


@router.get("/groups", response_model=AdminGroupListResponse)
def search_groups(
    q: str = Query(default=""),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    admin: CurrentUser = Depends(require_admin),
) -> AdminGroupListResponse:
    db = _db()

    if q:
        groups_query = (
            db.collection("groups").where("name", ">=", q).where("name", "<=", q + "").limit(limit)
        )
    else:
        groups_query = (
            db.collection("groups").order_by("createdAt", direction="DESCENDING").limit(limit)
        )

    docs = list(groups_query.stream())
    groups = []
    for doc in docs:
        data = doc.to_dict() or {}
        groups.append(
            AdminGroup(
                gid=doc.id,
                name=data.get("name", ""),
                memberCount=data.get("memberCount", 0),
                createdAt=_ts_to_str(data.get("createdAt")),
            )
        )

    return AdminGroupListResponse(groups=groups)
