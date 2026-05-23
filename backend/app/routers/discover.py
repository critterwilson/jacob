"""Discovery and join-request router — T30: Group discovery page."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import MembershipContext, get_current_user, require_leader, require_not_banned
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
from app.models.group import DEFAULT_MEMBER_CAP
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["discover"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


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

        # H5: read denormalised `leaderUids` off the group doc itself
        # (maintained by `functions/src/onMemberWrite.ts`). Fall back to
        # the per-group subcollection scan only for groups that haven't
        # been backfilled yet — see `infra/scripts/backfill_group_leaders.py`.
        leader_uids = list(d.get("leaderUids") or [])
        if not leader_uids and "leaderUids" not in d:
            member_snaps = (
                db.collection("groups")
                .document(snap.id)
                .collection("members")
                .where("role", "==", "leader")
                .limit(3)
                .stream()
            )
            leader_uids = [m.id for m in member_snaps]
        else:
            leader_uids = leader_uids[:3]

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
    user: CurrentUser = Depends(require_not_banned),
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
        # Transparent join inside a transaction so the cap check and
        # memberCount increment are atomic.
        group_ref = db.collection("groups").document(gid)
        member_ref = group_ref.collection("members").document(user.uid)

        @gcf.transactional
        def _open_join_txn(transaction: Any) -> None:
            g_snap = group_ref.get(transaction=transaction)
            g_data = g_snap.to_dict() or {}
            cap = int(g_data.get("memberCap") or DEFAULT_MEMBER_CAP)
            count = int(g_data.get("memberCount") or 0)
            if count >= cap:
                raise APIError(
                    status_code=status.HTTP_409_CONFLICT,
                    code="group_at_cap",
                    message="This group is at its member limit.",
                    details={"cap": cap, "currentCount": count},
                )
            txn_member = member_ref.get(transaction=transaction)
            if txn_member.exists:
                raise APIError(
                    status_code=status.HTTP_409_CONFLICT,
                    code="already_member",
                    message="You are already a member of this group",
                )
            transaction.set(
                member_ref,
                {"role": "member", "joinedAt": gcf.SERVER_TIMESTAMP, "uid": user.uid},
            )
            transaction.update(group_ref, {"memberCount": gcf.Increment(1)})

        _open_join_txn(db.transaction())
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
            return JoinResponse(
                gid=gid,
                pending=True,
                requestId=user.uid,
                requiresOwnerReview=bool(existing.get("requiresOwnerReview")),
            )

    # ADR 0015: minors escalate to the owner queue. Read isMinor from
    # the user doc (set at onboarding time) and denormalise it onto the
    # join-request so the owner CG query doesn't need to re-fetch every
    # user. The leader-facing list endpoint hides `requiresOwnerReview`
    # rows; the leader approve endpoint refuses them.
    user_snap = db.collection("users").document(user.uid).get()
    raw_user_data = user_snap.to_dict() if getattr(user_snap, "exists", False) else None
    user_data = raw_user_data if isinstance(raw_user_data, dict) else {}
    is_minor = bool(user_data.get("isMinor", False))

    # Write join request.
    db.collection("groups").document(gid).collection("joinRequests").document(user.uid).set(
        {
            "message": body.message,
            "requestedAt": gcf.SERVER_TIMESTAMP,
            "status": "pending",
            "isMinor": is_minor,
            "requiresOwnerReview": is_minor,
            "inviteCode": None,
            "parentalConsentObtained": None,
            "parentalConsentNotes": "",
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="request_join",
        target_ref=f"groups/{gid}",
        payload={"joinMode": "request", "isMinor": is_minor},
    )
    logger.info(
        "request_join uid=%s gid=%s isMinor=%s requiresOwnerReview=%s",
        user.uid,
        gid,
        is_minor,
        is_minor,
    )
    return JoinResponse(
        gid=gid,
        pending=True,
        requestId=user.uid,
        requiresOwnerReview=is_minor,
    )


# ── GET /api/groups/{gid}/join-requests ──────────────────────────────────────


@router.get("/api/groups/{gid}/join-requests", response_model=PendingRequestsResponse)
@limiter.limit(ADMIN_MUTATION)
def list_join_requests(
    gid: str,
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    membership: MembershipContext = Depends(require_leader),
) -> PendingRequestsResponse:
    db = _db()
    _ = membership  # gid + leader role already enforced by the dep

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

    # Bulk-read user profiles in one round-trip (same pattern as groups.list_members).
    user_refs = [db.collection("users").document(s.id) for s in page]
    user_docs = list(db.get_all(user_refs)) if user_refs else []
    profiles: dict[str, dict[str, Any]] = {}
    for doc in user_docs:
        if getattr(doc, "exists", False):
            profiles[doc.id] = doc.to_dict() or {}

    requests_out: list[PendingRequest] = []
    for snap in page:
        d = snap.to_dict() or {}
        # ADR 0015: a leader must NEVER see a minor's pending request as
        # actionable. Hiding it from the list entirely is the right
        # default — surfacing it read-only would tempt nudging the
        # owner or treating the queue as a signal of interest from the
        # minor. The owner queue at `/admin/minor-join-requests` is the
        # only surface for these.
        if bool(d.get("requiresOwnerReview")):
            continue
        profile = profiles.get(snap.id, {})
        requests_out.append(
            PendingRequest(
                uid=snap.id,
                displayName=str(profile.get("displayName") or "") or snap.id,
                photoURL=profile.get("photoURL"),
                message=d.get("message") or "",
                requestedAt=_ts_to_iso(d.get("requestedAt")),
                status=d.get("status", "pending"),
                isMinor=bool(d.get("isMinor", False)),
                requiresOwnerReview=False,
                inviteCode=d.get("inviteCode"),
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
    membership: MembershipContext = Depends(require_leader),
) -> ReviewResponse:
    db = _db()
    actor_uid = membership.uid

    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(target_uid)

    group_ref = db.collection("groups").document(gid)

    @gcf.transactional
    def _txn(transaction: Any) -> None:
        jr_snap = jr_ref.get(transaction=transaction)
        if not jr_snap.exists or (jr_snap.to_dict() or {}).get("status") != "pending":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_found",
                message="Pending join request not found",
            )
        # ADR 0015 — load-bearing safety check: a leader must not be
        # able to approve a minor. The bubble-up to the owner queue is
        # the only legitimate path; this branch is the server-side
        # backstop in case the leader has a stale UI hiding the flag.
        if bool((jr_snap.to_dict() or {}).get("requiresOwnerReview")):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="minor_owner_review_required",
                message="Minor join requests can only be approved by an organization owner",
            )
        # Enforce soft member cap inside the transaction.
        g_snap = group_ref.get(transaction=transaction)
        g_data = g_snap.to_dict() or {}
        cap = int(g_data.get("memberCap") or DEFAULT_MEMBER_CAP)
        count = int(g_data.get("memberCount") or 0)
        if count >= cap:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="group_at_cap",
                message="This group is at its member limit.",
                details={"cap": cap, "currentCount": count},
            )
        transaction.update(
            jr_ref,
            {
                "status": "approved",
                "reviewedAt": gcf.SERVER_TIMESTAMP,
                "reviewedBy": actor_uid,
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
        transaction.update(group_ref, {"memberCount": gcf.Increment(1)})

    _txn(db.transaction())

    write_audit_log(
        actor_uid=actor_uid,
        action="approve_join_request",
        target_ref=f"groups/{gid}/joinRequests/{target_uid}",
        payload={"targetUid": target_uid},
    )
    logger.info("approve_join_request leader=%s target=%s gid=%s", actor_uid, target_uid, gid)
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
    membership: MembershipContext = Depends(require_leader),
) -> ReviewResponse:
    db = _db()
    actor_uid = membership.uid

    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(target_uid)

    @gcf.transactional
    def _reject_txn(txn: Any) -> tuple[bool, bool]:
        snap = txn.get(jr_ref)
        if not snap.exists or (snap.to_dict() or {}).get("status") != "pending":
            return False, False
        if bool((snap.to_dict() or {}).get("requiresOwnerReview")):
            # Signal to the caller that this is the wrong endpoint
            # without writing anything inside the transaction. ADR 0015
            # — minor decisions belong to the owner exclusively.
            return False, True
        txn.update(
            jr_ref,
            {
                "status": "rejected",
                "reviewedAt": gcf.SERVER_TIMESTAMP,
                "reviewedBy": actor_uid,
            },
        )
        return True, False

    decided, owner_only = _reject_txn(db.transaction())
    if owner_only:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="minor_owner_review_required",
            message="Minor join requests can only be rejected by an organization owner",
        )
    if not decided:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Pending join request not found",
        )
    write_audit_log(
        actor_uid=actor_uid,
        action="reject_join_request",
        target_ref=f"groups/{gid}/joinRequests/{target_uid}",
        payload={"targetUid": target_uid},
    )
    logger.info("reject_join_request leader=%s target=%s gid=%s", actor_uid, target_uid, gid)
    return ReviewResponse(gid=gid, uid=target_uid, status="rejected")
