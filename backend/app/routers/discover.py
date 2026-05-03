"""Discovery and join-request router — T30: Group discovery page."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import get_current_user
from app.errors import APIError
from app.limits import ADMIN_MUTATION, DISCOVER_LIST, GROUP_JOIN
from app.middleware.rate_limit import limiter
from app.models.discover import (
    DiscoverGroup,
    DiscoverGroupsResponse,
    JoinRequest,
    JoinResponse,
    PendingRequest,
    PendingRequestsResponse,
    ReviewResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["discover"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _require_leader(db: Any, gid: str, uid: str) -> None:
    member_snap = db.collection("groups").document(gid).collection("members").document(uid).get()
    if not member_snap.exists or (member_snap.to_dict() or {}).get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Only group leaders may perform this action",
        )


def _ts_to_iso(ts: Any) -> str:
    if ts is None:
        return ""
    try:
        if hasattr(ts, "seconds"):
            return datetime.fromtimestamp(ts.seconds, UTC).isoformat()
        return str(ts)
    except Exception:
        return ""


# ── GET /api/discover/groups ─────────────────────────────────────────────────


@router.get("/api/discover/groups", response_model=DiscoverGroupsResponse)
@limiter.limit(DISCOVER_LIST)
def list_discover_groups(
    request: Request,
    response: Response,
    audience: str | None = Query(default=None),
    q: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
) -> DiscoverGroupsResponse:
    db = _db()

    query = (
        db.collection("groups")
        .where("isPrivate", "==", False)
        .where("archivedAt", "==", None)
        .order_by("memberCount", direction=gcf.Query.DESCENDING)
        .order_by("createdAt", direction=gcf.Query.DESCENDING)
    )
    if audience:
        query = query.where("audience", "==", audience)
    if cursor:
        cursor_snap = db.collection("groups").document(cursor).get()
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)
    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    page = snaps[:limit]

    groups: list[DiscoverGroup] = []
    for snap in page:
        d = snap.to_dict() or {}
        # Client-side q filter (full-text search is T28 Typesense; simple prefix match here)
        if q:
            name = (d.get("name") or "").lower()
            desc = (d.get("description") or "").lower()
            if q.lower() not in name and q.lower() not in desc:
                continue

        # Gather leader UIDs from members subcollection.
        member_snaps = (
            db.collection("groups")
            .document(snap.id)
            .collection("members")
            .where("role", "==", "leader")
            .limit(3)
            .stream()
        )
        leader_uids = [m.id for m in member_snaps]

        groups.append(
            DiscoverGroup(
                gid=snap.id,
                name=d.get("name", ""),
                description=d.get("description", ""),
                memberCount=int(d.get("memberCount") or 0),
                audience=d.get("audience") or "christian",
                joinMode=d.get("joinMode") or "open",
                leaderUids=leader_uids,
                stickerMixSnapshot=[],
            )
        )

    next_cursor = page[-1].id if has_more and page else None
    return DiscoverGroupsResponse(groups=groups, nextCursor=next_cursor)


# ── POST /api/groups/{gid}/join-requests ─────────────────────────────────────


@router.post("/api/groups/{gid}/join-requests", response_model=JoinResponse)
@limiter.limit(GROUP_JOIN)
def create_join_request(
    gid: str,
    request: Request,
    response: Response,
    body: JoinRequest,
    user: CurrentUser = Depends(get_current_user),
) -> JoinResponse:
    db = _db()

    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    group = group_snap.to_dict() or {}

    if group.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="group_archived",
            message="This group has been archived and is no longer accepting members",
        )

    # 409 if already a member.
    member_snap = (
        db.collection("groups").document(gid).collection("members").document(user.uid).get()
    )
    if member_snap.exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_member",
            message="You are already a member of this group",
        )

    join_mode = group.get("joinMode") or "open"

    if join_mode == "open":
        # Transparent join — add member directly.
        db.collection("groups").document(gid).collection("members").document(user.uid).set(
            {
                "role": "member",
                "joinedAt": gcf.SERVER_TIMESTAMP,
                "uid": user.uid,
            }
        )
        db.collection("groups").document(gid).update({"memberCount": gcf.Increment(1)})
        write_audit_log(
            actor_uid=user.uid,
            action="join_group",
            target_ref=f"groups/{gid}",
            payload={"joinMode": "open"},
        )
        logger.info("join_group uid=%s gid=%s mode=open", user.uid, gid)
        return JoinResponse(gid=gid, joined=True)

    # request mode — check for existing pending request (idempotent).
    existing_snap = (
        db.collection("groups").document(gid).collection("joinRequests").document(user.uid).get()
    )
    if existing_snap.exists:
        existing = existing_snap.to_dict() or {}
        if existing.get("status") == "pending":
            return JoinResponse(gid=gid, pending=True, requestId=user.uid)

    # Write join request.
    db.collection("groups").document(gid).collection("joinRequests").document(user.uid).set(
        {
            "message": body.message,
            "requestedAt": gcf.SERVER_TIMESTAMP,
            "status": "pending",
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="request_join",
        target_ref=f"groups/{gid}",
        payload={"joinMode": "request"},
    )
    logger.info("request_join uid=%s gid=%s", user.uid, gid)
    return JoinResponse(gid=gid, pending=True, requestId=user.uid)


# ── GET /api/groups/{gid}/join-requests ──────────────────────────────────────


@router.get("/api/groups/{gid}/join-requests", response_model=PendingRequestsResponse)
@limiter.limit(ADMIN_MUTATION)
def list_join_requests(
    gid: str,
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
) -> PendingRequestsResponse:
    db = _db()
    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    _require_leader(db, gid, user.uid)

    query = (
        db.collection("groups")
        .document(gid)
        .collection("joinRequests")
        .where("status", "==", "pending")
        .order_by("requestedAt", direction=gcf.Query.ASCENDING)
    )
    if cursor:
        cursor_snap = (
            db.collection("groups").document(gid).collection("joinRequests").document(cursor).get()
        )
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)
    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    page = snaps[:limit]

    requests_out: list[PendingRequest] = []
    for snap in page:
        d = snap.to_dict() or {}
        requests_out.append(
            PendingRequest(
                uid=snap.id,
                message=d.get("message") or "",
                requestedAt=_ts_to_iso(d.get("requestedAt")),
                status=d.get("status", "pending"),
            )
        )
    next_cursor = page[-1].id if has_more and page else None
    return PendingRequestsResponse(requests=requests_out, nextCursor=next_cursor)


# ── POST /api/groups/{gid}/join-requests/{uid}/approve ───────────────────────


@router.post(
    "/api/groups/{gid}/join-requests/{target_uid}/approve",
    response_model=ReviewResponse,
)
@limiter.limit(ADMIN_MUTATION)
def approve_join_request(
    gid: str,
    target_uid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ReviewResponse:
    db = _db()
    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    _require_leader(db, gid, user.uid)

    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(target_uid)

    @gcf.transactional
    def _txn(transaction: Any) -> None:
        jr_snap = jr_ref.get(transaction=transaction)
        if not jr_snap.exists or (jr_snap.to_dict() or {}).get("status") != "pending":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_found",
                message="Pending join request not found",
            )
        transaction.update(
            jr_ref,
            {
                "status": "approved",
                "reviewedAt": gcf.SERVER_TIMESTAMP,
                "reviewedBy": user.uid,
            },
        )
        member_ref = (
            db.collection("groups").document(gid).collection("members").document(target_uid)
        )
        transaction.set(
            member_ref,
            {
                "role": "member",
                "joinedAt": gcf.SERVER_TIMESTAMP,
                "uid": target_uid,
            },
        )
        group_ref = db.collection("groups").document(gid)
        transaction.update(group_ref, {"memberCount": gcf.Increment(1)})

    _txn(db.transaction())

    write_audit_log(
        actor_uid=user.uid,
        action="approve_join_request",
        target_ref=f"groups/{gid}/joinRequests/{target_uid}",
        payload={"targetUid": target_uid},
    )
    logger.info("approve_join_request leader=%s target=%s gid=%s", user.uid, target_uid, gid)
    return ReviewResponse(gid=gid, uid=target_uid, status="approved")


# ── POST /api/groups/{gid}/join-requests/{uid}/reject ────────────────────────


@router.post(
    "/api/groups/{gid}/join-requests/{target_uid}/reject",
    response_model=ReviewResponse,
)
@limiter.limit(ADMIN_MUTATION)
def reject_join_request(
    gid: str,
    target_uid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ReviewResponse:
    db = _db()
    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    _require_leader(db, gid, user.uid)

    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(target_uid)
    jr_snap = jr_ref.get()
    if not jr_snap.exists or (jr_snap.to_dict() or {}).get("status") != "pending":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Pending join request not found",
        )
    jr_ref.update(
        {
            "status": "rejected",
            "reviewedAt": gcf.SERVER_TIMESTAMP,
            "reviewedBy": user.uid,
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="reject_join_request",
        target_ref=f"groups/{gid}/joinRequests/{target_uid}",
        payload={"targetUid": target_uid},
    )
    logger.info("reject_join_request leader=%s target=%s gid=%s", user.uid, target_uid, gid)
    return ReviewResponse(gid=gid, uid=target_uid, status="rejected")
