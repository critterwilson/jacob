"""Admin router: moderation queue, user ban/unban, group search.

All endpoints require the `admin` custom claim (enforced by `require_admin`).
Every mutating action writes an audit_log entry via `services.audit`.

Collections accessed here (moderation_queue, bans, audit_log, users, groups)
all have `allow read, write: if false` in Firestore security rules; the
Admin SDK bypasses those rules by design.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import require_admin, require_ministry_owner_or_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, ADMIN_MUTATION
from app.middleware.rate_limit import limiter
from app.models.admin import (
    AdminGroup,
    AdminGroupListResponse,
    AdminUser,
    AdminUserListResponse,
    BanRequest,
    BanResponse,
    BulkResolveRequest,
    BulkResolveResponse,
    ModerationItem,
    ModerationListResponse,
    ResolveRequest,
    ResolveResponse,
    UnbanResponse,
    UserRolesResponse,
)
from app.models.applications import (
    ApplicationDecisionResponse,
    ApplicationListResponse,
    ApproveApplicationRequest,
    RejectApplicationRequest,
)
from app.models.discover import (
    MinorJoinRequest,
    MinorJoinRequestsResponse,
    OwnerApproveJoinRequest,
    OwnerRejectJoinRequest,
    ReviewResponse,
)
from app.models.group import DEFAULT_MEMBER_CAP
from app.models.leader_applications import (
    ApproveLeaderApplicationRequest,
    LeaderApplicationDecisionResponse,
    LeaderApplicationListResponse,
    RejectLeaderApplicationRequest,
)
from app.models.ministry_feed import MinistryOwnerGrantResponse
from app.models.user import CurrentUser
from app.services.applications import application_doc_to_view, compute_age
from app.services.audit import write_audit_log
from app.services.email import send_moderation_notice
from app.services.firebase import init_firebase_admin
from app.services.invites import consume_invite
from app.services.leader_applications import (
    create_group_for_approved_application,
    leader_application_doc_to_view,
)

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


_KNOWN_STATUSES = {"pending", "approved", "rejected"}
_KNOWN_REASONS = {
    "harassment",
    "sexual",
    "violence",
    "self-harm",
    "spam",
    "other",
    # Legacy free-text reason stored verbatim from the T12 report form.
    # Used as a filter value so operator can surface these queue rows.
    "legacy",
}
_KNOWN_SORTS = {"createdAt", "severity"}


@router.get("/moderation", response_model=ModerationListResponse)
@limiter.limit(ADMIN_LIST)
def list_moderation_queue(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    status_filter: str = Query(default="pending", alias="status"),
    reason: str | None = Query(default=None),
    sort_by: str = Query(default="createdAt", alias="sortBy"),
    admin: CurrentUser = Depends(require_admin),
) -> ModerationListResponse:
    db = _db()
    if status_filter not in _KNOWN_STATUSES:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_KNOWN_STATUSES)}",
        )
    if sort_by not in _KNOWN_SORTS:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_sort",
            message=f"sortBy must be one of {sorted(_KNOWN_SORTS)}",
        )

    query = db.collection("moderation_queue").where("status", "==", status_filter)
    if reason:
        query = query.where("reason", "==", reason)

    if sort_by == "severity":
        query = query.order_by("severity", direction="DESCENDING").order_by(
            "createdAt", direction="DESCENDING"
        )
    else:
        query = query.order_by("createdAt")

    query = query.limit(limit + 1)
    if cursor:
        cursor_snap = db.collection("moderation_queue").document(cursor).get()
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)

    docs = list(query.stream())
    has_more = len(docs) > limit
    page = docs[:limit]

    known_keys = {
        "resourceRef",
        "reason",
        "severity",
        "status",
        "uploaderUid",
        "reportedBy",
        "resourceType",
        "groupId",
        "context",
        "auto",
        "createdAt",
    }

    items = []
    for doc in page:
        data = doc.to_dict() or {}
        extra = {k: v for k, v in data.items() if k not in known_keys}
        items.append(
            ModerationItem(
                itemId=doc.id,
                resourceRef=data.get("resourceRef", ""),
                reason=data.get("reason"),
                severity=data.get("severity"),
                status=data.get("status", "pending"),
                uploaderUid=data.get("uploaderUid"),
                reportedBy=data.get("reportedBy"),
                resourceType=data.get("resourceType"),
                groupId=data.get("groupId"),
                context=data.get("context"),
                auto=bool(data.get("auto", False)),
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

    if new_status == "rejected" and item_data.get("reason") != "wellbeing_concern":
        _notify_reported_author(db, item_data)

    return ResolveResponse(itemId=item_id, status=new_status)


@router.post("/moderation/bulk-resolve", response_model=BulkResolveResponse)
@limiter.limit(ADMIN_MUTATION)
def bulk_resolve_moderation_items(
    request: Request,
    response: Response,
    body: BulkResolveRequest,
    admin: CurrentUser = Depends(require_admin),
) -> BulkResolveResponse:
    """Bulk-approve / bulk-reject up to 100 queue items.

    Any items that are missing or already resolved are returned in
    `skipped`. One audit_log row is written per resolved item.
    """
    db = _db()
    new_status = "approved" if body.resolution == "approve" else "rejected"
    resolved: list[str] = []
    skipped: list[str] = []
    seen: set[str] = set()

    for item_id in body.itemIds:
        if item_id in seen:
            skipped.append(item_id)
            continue
        seen.add(item_id)
        item_ref = db.collection("moderation_queue").document(item_id)
        snap = item_ref.get()
        if not snap.exists:
            skipped.append(item_id)
            continue
        data = snap.to_dict() or {}
        if data.get("status") != "pending":
            skipped.append(item_id)
            continue

        item_ref.update({"status": new_status, "reviewedBy": admin.uid})
        write_audit_log(
            actor_uid=admin.uid,
            action=f"moderation_{new_status}",
            target_ref=f"moderation_queue/{item_id}",
            payload={
                "resolution": body.resolution,
                "resourceRef": data.get("resourceRef", ""),
                "bulk": True,
            },
        )
        if new_status == "rejected" and data.get("reason") != "wellbeing_concern":
            _notify_reported_author(db, data)
        resolved.append(item_id)

    logger.info(
        "admin=%s bulk_resolved count=%s as=%s skipped=%s",
        admin.uid,
        len(resolved),
        new_status,
        len(skipped),
    )
    return BulkResolveResponse(resolved=resolved, skipped=skipped)


# ── users ──────────────────────────────────────────────────────────────────────


@router.get("/users", response_model=AdminUserListResponse)
@limiter.limit(ADMIN_LIST)
def search_users(
    request: Request,
    response: Response,
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


@router.get("/users/{uid}/roles", response_model=UserRolesResponse)
@limiter.limit(ADMIN_LIST)
def get_user_roles(
    uid: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> UserRolesResponse:
    """Return the current platform-level custom claims for a user.

    Reports admin, moderator, and ministry_owner. There is intentionally no
    endpoint to grant the admin claim itself — use a one-off script via the
    Admin SDK for that (granting admin from within the app would be a
    privilege-escalation risk without an out-of-band approval step).
    """
    try:
        fb_user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError as exc:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="Firebase user not found",
        ) from exc
    claims: dict[str, object] = dict(fb_user.custom_claims or {})
    return UserRolesResponse(
        uid=uid,
        isAdmin=bool(claims.get("admin")),
        isModerator=bool(claims.get("moderator")),
        isMinistryOwner=bool(claims.get("ministry_owner")),
    )


# ── groups ─────────────────────────────────────────────────────────────────────


@router.get("/groups", response_model=AdminGroupListResponse)
@limiter.limit(ADMIN_LIST)
def search_groups(
    request: Request,
    response: Response,
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


# ── applications (admin-approval signup, ADR 0012) ────────────────────────────


_APPLICATION_STATUSES = {"pending", "approved", "rejected"}


@router.get("/applications", response_model=ApplicationListResponse)
@limiter.limit(ADMIN_LIST)
def list_applications(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    status_filter: str = Query(default="pending", alias="status"),
    admin: CurrentUser = Depends(require_admin),
) -> ApplicationListResponse:
    """List signup applications filtered by status (default: pending)."""
    if status_filter not in _APPLICATION_STATUSES:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_APPLICATION_STATUSES)}",
        )

    db = _db()
    query = (
        db.collection("applications")
        .where("status", "==", status_filter)
        .order_by("createdAt")
        .limit(limit + 1)
    )
    if cursor:
        cursor_snap = db.collection("applications").document(cursor).get()
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)

    docs = list(query.stream())
    has_more = len(docs) > limit
    page = docs[:limit]

    items = [application_doc_to_view(snap.id, snap.to_dict() or {}) for snap in page]
    next_cursor = page[-1].id if has_more and page else None
    return ApplicationListResponse(items=items, nextCursor=next_cursor)


@router.post(
    "/applications/{uid}/approve",
    response_model=ApplicationDecisionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def approve_application(
    uid: str,
    request: Request,
    response: Response,
    body: ApproveApplicationRequest,
    admin: CurrentUser = Depends(require_admin),
) -> ApplicationDecisionResponse:
    """Approve a pending application and create the `users/{uid}` doc.

    For applicants with `isMinor: true` the admin MUST pass
    `parentalConsentObtained: true` (refused with 422
    `parental_consent_required` otherwise). The admin's notes are
    persisted on the application doc and surfaced via the audit log.

    Idempotent on the failure side: if the application is missing or
    already decided, returns 404 / 409 without touching state.
    """
    db = _db()
    app_ref = db.collection("applications").document(uid)
    app_snap = app_ref.get()
    if not app_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="application_not_found",
            message="No application on file for this user",
        )

    app_data = app_snap.to_dict() or {}
    current_status = str(app_data.get("status") or "")
    if current_status != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="application_already_decided",
            message="Application has already been decided",
            details={"status": current_status},
        )

    minor = bool(app_data.get("isMinor", False))
    if minor and body.parentalConsentObtained is not True:
        dob_raw = app_data.get("dob")
        applicant_age: int | None = None
        if dob_raw:
            try:
                applicant_age = compute_age(date.fromisoformat(str(dob_raw)))
            except (ValueError, TypeError):
                pass
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="parental_consent_required",
            message="Parental consent must be confirmed for under-18 applicants",
            details={"applicantAge": applicant_age},
        )

    # Create the `users/{uid}` doc — this is the load-bearing "approved
    # member" artefact that gates every downstream access predicate.
    user_ref = db.collection("users").document(uid)
    existing_user = user_ref.get()
    if not existing_user.exists:
        user_payload: dict[str, Any] = {
            "displayName": app_data.get("displayName") or "",
            "email": app_data.get("email"),
            "photoURL": app_data.get("photoURL"),
            "role": "member",
            "schemaVersion": 1,
            "isMinor": minor,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
        # Echo the optional onboarding fields back onto the user doc
        # so the existing UserProfile shape stays populated.
        for field in ("phone", "location", "faithBackground"):
            value = app_data.get(field)
            if value:
                user_payload[field] = value
        user_ref.set(user_payload)

    # If the applicant arrived via an invite link before signing up,
    # the code was persisted on the application doc at submit time.
    # Consume it now — the user doc above is the prerequisite for
    # `consume_invite` to write a `groups/{gid}/members/{uid}` entry.
    #
    # Failure here is non-fatal: the approval has already produced a
    # working user account, so we log and audit the outcome but never
    # roll back. Realistic failure modes (invite expired, revoked, at
    # member cap, group archived) just mean the user lands without
    # auto-join and can re-open the invite link manually if it's
    # still valid.
    invite_code = app_data.get("inviteCode")
    invite_outcome: dict[str, Any] = {"attempted": False}
    if invite_code:
        invite_outcome["attempted"] = True
        invite_outcome["code"] = str(invite_code)
        try:
            joined_gid, joined_invite_id = consume_invite(db, str(invite_code), uid)
            invite_outcome["status"] = "joined"
            invite_outcome["gid"] = joined_gid
            invite_outcome["inviteId"] = joined_invite_id
            logger.info(
                "approve: consumed invite uid=%s gid=%s inviteId=%s",
                uid,
                joined_gid,
                joined_invite_id,
            )
        except APIError as err:
            # `APIError` inherits from `HTTPException`; its standard
            # shape is `.detail = {"error": {"code", "message", "details"}}`.
            err_payload: dict[str, Any] = {}
            if isinstance(err.detail, dict):
                err_payload = err.detail.get("error") or {}
            err_code = str(err_payload.get("code") or "unknown_error")
            err_message = str(err_payload.get("message") or err.detail or "")
            invite_outcome["status"] = "failed"
            invite_outcome["errorCode"] = err_code
            logger.warning(
                "approve: invite consume failed uid=%s code=%s err=%s",
                uid,
                err_code,
                err_message,
            )
        except Exception:  # noqa: BLE001
            invite_outcome["status"] = "errored"
            logger.exception("approve: unexpected error consuming invite uid=%s", uid)

    app_ref.update(
        {
            "status": "approved",
            "decidedAt": fb_firestore.SERVER_TIMESTAMP,
            "decidedBy": admin.uid,
            "parentalConsentObtained": (
                bool(body.parentalConsentObtained)
                if body.parentalConsentObtained is not None
                else None
            ),
            "parentalConsentNotes": body.parentalConsentNotes,
            "rejectionReason": "",
        }
    )

    write_audit_log(
        actor_uid=admin.uid,
        action="application.approve",
        target_ref=f"applications/{uid}",
        payload={
            "isMinor": minor,
            "parentalConsentObtained": (
                bool(body.parentalConsentObtained)
                if body.parentalConsentObtained is not None
                else None
            ),
            "parentalConsentNotesLength": len(body.parentalConsentNotes or ""),
            "invite": invite_outcome,
        },
    )

    logger.info(
        "admin=%s approved application uid=%s isMinor=%s",
        admin.uid,
        uid,
        minor,
    )
    return ApplicationDecisionResponse(uid=uid, status="approved")


@router.post(
    "/applications/{uid}/reject",
    response_model=ApplicationDecisionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def reject_application(
    uid: str,
    request: Request,
    response: Response,
    body: RejectApplicationRequest,
    admin: CurrentUser = Depends(require_admin),
) -> ApplicationDecisionResponse:
    """Reject a pending application.

    The applicant's Firebase Auth user stays in place; on next sign-in
    they see the rejection screen via `GET /api/applications/me`. The
    rejection reason is admin-supplied free text — the audit log
    captures who rejected, when, and the length of the supplied
    reason (so reviewers can spot empty placeholders without leaking
    the contents into logging surfaces).
    """
    db = _db()
    app_ref = db.collection("applications").document(uid)
    app_snap = app_ref.get()
    if not app_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="application_not_found",
            message="No application on file for this user",
        )

    app_data = app_snap.to_dict() or {}
    current_status = str(app_data.get("status") or "")
    if current_status != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="application_already_decided",
            message="Application has already been decided",
            details={"status": current_status},
        )

    app_ref.update(
        {
            "status": "rejected",
            "decidedAt": fb_firestore.SERVER_TIMESTAMP,
            "decidedBy": admin.uid,
            "rejectionReason": body.reason,
        }
    )

    write_audit_log(
        actor_uid=admin.uid,
        action="application.reject",
        target_ref=f"applications/{uid}",
        payload={"reasonLength": len(body.reason)},
    )

    logger.info("admin=%s rejected application uid=%s", admin.uid, uid)
    return ApplicationDecisionResponse(uid=uid, status="rejected")


# ── ministry_owner claim ──────────────────────────────────────────────────


def _set_ministry_owner_claim(uid: str, *, value: bool) -> None:
    """Set or clear `ministry_owner` while preserving other claims.

    Raises `APIError(404)` if the auth user does not exist. The custom-
    claim payload is the full claim set; we read-modify-write to avoid
    nuking sibling claims (e.g. `admin`).
    """
    try:
        user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError as exc:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="Firebase user not found",
        ) from exc
    existing: dict[str, object] = dict(user.custom_claims or {})
    if value:
        existing["ministry_owner"] = True
    else:
        existing.pop("ministry_owner", None)
    firebase_auth.set_custom_user_claims(uid, existing)


@router.post(
    "/users/{uid}/ministry-owner",
    response_model=MinistryOwnerGrantResponse,
)
@limiter.limit(ADMIN_MUTATION)
def grant_ministry_owner(
    request: Request,
    response: Response,
    uid: str = Path(..., min_length=1),
    admin: CurrentUser = Depends(require_admin),
) -> MinistryOwnerGrantResponse:
    _set_ministry_owner_claim(uid, value=True)
    write_audit_log(
        actor_uid=admin.uid,
        action="grant_ministry_owner",
        target_ref=f"users/{uid}",
        payload={},
    )
    logger.info("admin=%s granted ministry_owner uid=%s", admin.uid, uid)
    return MinistryOwnerGrantResponse(uid=uid, ministryOwner=True)


@router.delete(
    "/users/{uid}/ministry-owner",
    response_model=MinistryOwnerGrantResponse,
)
@limiter.limit(ADMIN_MUTATION)
def revoke_ministry_owner(
    request: Request,
    response: Response,
    uid: str = Path(..., min_length=1),
    admin: CurrentUser = Depends(require_admin),
) -> MinistryOwnerGrantResponse:
    _set_ministry_owner_claim(uid, value=False)
    write_audit_log(
        actor_uid=admin.uid,
        action="revoke_ministry_owner",
        target_ref=f"users/{uid}",
        payload={},
    )
    logger.info("admin=%s revoked ministry_owner uid=%s", admin.uid, uid)
    return MinistryOwnerGrantResponse(uid=uid, ministryOwner=False)


# ── leader applications (ADR 0014) ────────────────────────────────────────────


@router.get("/leader-applications", response_model=LeaderApplicationListResponse)
@limiter.limit(ADMIN_LIST)
def list_leader_applications(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    status_filter: str = Query(default="pending", alias="status"),
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> LeaderApplicationListResponse:
    """List leader applications by status (default: pending).

    Owner-only (admin is a superset). The pending queue is the
    "register your gym" queue — pending applications are the only ones
    actionable from the owner queue UI; approved/rejected are exposed
    for audit history.
    """
    if status_filter not in {"pending", "approved", "rejected"}:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message="status must be one of pending, approved, rejected",
        )

    db = _db()
    query = (
        db.collection("leader_applications")
        .where("status", "==", status_filter)
        .order_by("createdAt")
        .limit(limit + 1)
    )
    if cursor:
        cursor_snap = db.collection("leader_applications").document(cursor).get()
        if cursor_snap.exists:
            query = query.start_after(cursor_snap)

    docs = list(query.stream())
    has_more = len(docs) > limit
    page = docs[:limit]
    items = [leader_application_doc_to_view(snap.id, snap.to_dict() or {}) for snap in page]
    next_cursor = page[-1].id if has_more and page else None
    return LeaderApplicationListResponse(items=items, nextCursor=next_cursor)


@router.post(
    "/leader-applications/{app_id}/approve",
    response_model=LeaderApplicationDecisionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def approve_leader_application(
    app_id: str,
    request: Request,
    response: Response,
    body: ApproveLeaderApplicationRequest,
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> LeaderApplicationDecisionResponse:
    """Approve a pending leader application and create the target group.

    The group is created atomically with the applicant as leader via
    `services.leader_applications.create_group_for_approved_application`,
    which mirrors `POST /api/groups`. On success the application doc
    records `createdGroupId` for the audit trail.
    """
    db = _db()
    app_ref = db.collection("leader_applications").document(app_id)
    app_snap = app_ref.get()
    if not app_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="leader_application_not_found",
            message="Leader application not found",
        )
    app_data = app_snap.to_dict() or {}
    if str(app_data.get("status") or "") != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="leader_application_already_decided",
            message="This application has already been decided",
            details={"status": app_data.get("status")},
        )

    applicant_uid = str(app_data.get("applicantUid") or "")
    if not applicant_uid:
        raise APIError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="application_corrupt",
            message="Application is missing an applicantUid",
        )

    # Verify the applicant still has a user doc — if they deleted their
    # account between submit and approve, we can't make them a leader.
    user_snap = db.collection("users").document(applicant_uid).get()
    if not getattr(user_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="applicant_missing",
            message="The applicant no longer has a JACOB account",
        )

    audience = body.audienceOverride or str(app_data.get("proposedAudience") or "christian")
    gid = create_group_for_approved_application(
        db,
        applicant_uid=applicant_uid,
        name=str(app_data.get("proposedGroupName") or ""),
        description=str(app_data.get("proposedGroupDescription") or ""),
        audience=audience,
    )

    app_ref.update(
        {
            "status": "approved",
            "decidedAt": fb_firestore.SERVER_TIMESTAMP,
            "decidedBy": owner.uid,
            "decisionNotes": body.decisionNotes,
            "createdGroupId": gid,
        }
    )

    write_audit_log(
        actor_uid=owner.uid,
        action="leader_application.approve",
        target_ref=f"leader_applications/{app_id}",
        payload={
            "applicantUid": applicant_uid,
            "createdGroupId": gid,
            "audience": audience,
        },
    )
    logger.info(
        "owner=%s approved leader_application=%s applicant=%s gid=%s",
        owner.uid,
        app_id,
        applicant_uid,
        gid,
    )
    return LeaderApplicationDecisionResponse(appId=app_id, status="approved", createdGroupId=gid)


@router.post(
    "/leader-applications/{app_id}/reject",
    response_model=LeaderApplicationDecisionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def reject_leader_application(
    app_id: str,
    request: Request,
    response: Response,
    body: RejectLeaderApplicationRequest,
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> LeaderApplicationDecisionResponse:
    db = _db()
    app_ref = db.collection("leader_applications").document(app_id)
    app_snap = app_ref.get()
    if not app_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="leader_application_not_found",
            message="Leader application not found",
        )
    app_data = app_snap.to_dict() or {}
    if str(app_data.get("status") or "") != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="leader_application_already_decided",
            message="This application has already been decided",
            details={"status": app_data.get("status")},
        )

    app_ref.update(
        {
            "status": "rejected",
            "decidedAt": fb_firestore.SERVER_TIMESTAMP,
            "decidedBy": owner.uid,
            "decisionNotes": body.reason,
        }
    )

    write_audit_log(
        actor_uid=owner.uid,
        action="leader_application.reject",
        target_ref=f"leader_applications/{app_id}",
        payload={"reasonLength": len(body.reason)},
    )
    logger.info("owner=%s rejected leader_application=%s", owner.uid, app_id)
    return LeaderApplicationDecisionResponse(appId=app_id, status="rejected")


# ── owner-side minor join-request queue (ADR 0014) ───────────────────────────


def _ts_to_iso(ts: Any) -> str:
    if ts is None:
        return ""
    try:
        if hasattr(ts, "isoformat"):
            return str(ts.isoformat())
        if hasattr(ts, "seconds"):
            return datetime.fromtimestamp(ts.seconds, UTC).isoformat()
        return str(ts)
    except Exception:  # noqa: BLE001
        return ""


@router.get("/minor-join-requests", response_model=MinorJoinRequestsResponse)
@limiter.limit(ADMIN_LIST)
def list_minor_join_requests(
    request: Request,
    response: Response,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=100),
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> MinorJoinRequestsResponse:
    """Owner queue: pending join-requests that escalated for minor review.

    Collection-group query on `joinRequests` filtered by
    `requiresOwnerReview == true && status == "pending"`. The CG index
    is declared in `firestore/firestore.indexes.json` (ADR 0014).
    The leader-facing queue strips these rows so a leader can never see
    or action a minor's request.
    """
    db = _db()
    snaps = list(
        db.collection_group("joinRequests")
        .where("requiresOwnerReview", "==", True)
        .where("status", "==", "pending")
        .order_by("requestedAt", direction=gcf.Query.ASCENDING)
        .limit(limit)
        .stream()
    )

    rows: list[MinorJoinRequest] = []
    # Batch-read the parent group + applicant user docs so the per-row
    # render is one round-trip per kind.
    group_refs: dict[str, Any] = {}
    user_refs: dict[str, Any] = {}
    parent_path_by_snap: dict[str, tuple[str, str]] = {}
    for snap in snaps:
        parent_group = snap.reference.parent.parent
        if parent_group is None:
            continue
        gid = parent_group.id
        uid = snap.id
        parent_path_by_snap[snap.id] = (gid, uid)
        group_refs.setdefault(gid, parent_group)
        user_refs.setdefault(uid, db.collection("users").document(uid))

    group_data_by_gid: dict[str, dict[str, Any]] = {}
    user_data_by_uid: dict[str, dict[str, Any]] = {}
    if group_refs:
        for doc in db.get_all(list(group_refs.values())):
            if getattr(doc, "exists", False):
                group_data_by_gid[doc.id] = doc.to_dict() or {}
    if user_refs:
        for doc in db.get_all(list(user_refs.values())):
            if getattr(doc, "exists", False):
                user_data_by_uid[doc.id] = doc.to_dict() or {}

    for snap in snaps:
        if snap.id not in parent_path_by_snap:
            continue
        gid, uid = parent_path_by_snap[snap.id]
        data = snap.to_dict() or {}
        group_data = group_data_by_gid.get(gid, {})
        user_data = user_data_by_uid.get(uid, {})

        # Surface age if we have it on the user doc; otherwise leave None.
        # DOB lives on `users/{uid}/private/profile` (ADR 0014 § 1) so this
        # CG-time read does not have access to it — by design, to keep the
        # owner queue query cheap. The owner can drill into the user
        # profile if precise age matters; the isMinor signal is enough
        # to know the bubble-up was correct.
        rows.append(
            MinorJoinRequest(
                gid=gid,
                groupName=str(group_data.get("name") or ""),
                uid=uid,
                displayName=str(user_data.get("displayName") or "") or uid,
                photoURL=user_data.get("photoURL"),
                age=None,
                message=str(data.get("message") or ""),
                requestedAt=_ts_to_iso(data.get("requestedAt")),
                inviteCode=data.get("inviteCode"),
            )
        )

    return MinorJoinRequestsResponse(requests=rows, nextCursor=None)


@router.post(
    "/groups/{gid}/join-requests/{uid}/approve",
    response_model=ReviewResponse,
)
@limiter.limit(ADMIN_MUTATION)
def owner_approve_join_request(
    gid: str,
    uid: str,
    request: Request,
    response: Response,
    body: OwnerApproveJoinRequest,
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> ReviewResponse:
    """Owner approves a minor's join-request with parental consent (ADR 0014).

    Refuses (422 `parental_consent_required`) unless the body sets
    `parentalConsentObtained: true`. Also refuses (409
    `not_a_minor_request`) if the join-request was not flagged for
    owner review — the leader's normal approve endpoint handles those.
    """
    db = _db()
    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(uid)
    group_ref = db.collection("groups").document(gid)

    jr_snap = jr_ref.get()
    jr_exists = getattr(jr_snap, "exists", False)
    jr_status = (jr_snap.to_dict() or {}).get("status") if jr_exists else None
    if jr_status != "pending":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Pending join request not found",
        )
    jr_data = jr_snap.to_dict() or {}
    if not bool(jr_data.get("requiresOwnerReview")):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_a_minor_request",
            message=(
                "This request is not flagged for owner review; " "the group leader can approve it."
            ),
        )

    if body.parentalConsentObtained is not True:
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="parental_consent_required",
            message="Parental consent must be confirmed to approve an under-18 join request",
        )

    invite_code = jr_data.get("inviteCode")

    @gcf.transactional
    def _txn(transaction: Any) -> None:
        fresh_jr = jr_ref.get(transaction=transaction)
        if not fresh_jr.exists or (fresh_jr.to_dict() or {}).get("status") != "pending":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_found",
                message="Pending join request not found",
            )
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
                "reviewedAt": fb_firestore.SERVER_TIMESTAMP,
                "reviewedBy": owner.uid,
                "parentalConsentObtained": True,
                "parentalConsentNotes": body.parentalConsentNotes,
            },
        )
        member_ref = group_ref.collection("members").document(uid)
        transaction.set(
            member_ref,
            {
                "role": "member",
                "joinedAt": fb_firestore.SERVER_TIMESTAMP,
                "uid": uid,
            },
        )
        transaction.update(group_ref, {"memberCount": gcf.Increment(1)})

    _txn(db.transaction())

    # If the request originated from an invite landing, consume the
    # invite NOW so its useCount / lastUsedAt reflect reality. Failure
    # here is non-fatal: the membership write above already succeeded.
    # `consume_invite` is the same path adult invite-landings take, but
    # for an already-joined user it raises `409 already_member`, which
    # we treat as "fine, the member doc is there, that's all we wanted".
    invite_outcome: dict[str, Any] = {"attempted": False}
    if invite_code:
        invite_outcome["attempted"] = True
        invite_outcome["code"] = str(invite_code)
        try:
            consumed_gid, consumed_invite_id = consume_invite(db, str(invite_code), uid)
            invite_outcome["status"] = "joined"
            invite_outcome["gid"] = consumed_gid
            invite_outcome["inviteId"] = consumed_invite_id
        except APIError as err:
            err_payload: dict[str, Any] = {}
            if isinstance(err.detail, dict):
                err_payload = err.detail.get("error") or {}
            err_code = str(err_payload.get("code") or "unknown_error")
            invite_outcome["status"] = "failed"
            invite_outcome["errorCode"] = err_code
            # already_member is the expected outcome — we just added them.
            if err_code != "already_member":
                logger.warning(
                    "owner_approve_join: invite consume failed uid=%s gid=%s code=%s err=%s",
                    uid,
                    gid,
                    invite_code,
                    err_code,
                )
        except Exception:  # noqa: BLE001
            invite_outcome["status"] = "errored"
            logger.exception(
                "owner_approve_join: unexpected error consuming invite uid=%s gid=%s",
                uid,
                gid,
            )

    write_audit_log(
        actor_uid=owner.uid,
        action="owner_approve_join_request",
        target_ref=f"groups/{gid}/joinRequests/{uid}",
        payload={
            "targetUid": uid,
            "parentalConsentObtained": True,
            "parentalConsentNotesLength": len(body.parentalConsentNotes or ""),
            "invite": invite_outcome,
        },
    )
    logger.info(
        "owner=%s approved minor join_request gid=%s uid=%s",
        owner.uid,
        gid,
        uid,
    )
    return ReviewResponse(gid=gid, uid=uid, status="approved")


@router.post(
    "/groups/{gid}/join-requests/{uid}/reject",
    response_model=ReviewResponse,
)
@limiter.limit(ADMIN_MUTATION)
def owner_reject_join_request(
    gid: str,
    uid: str,
    request: Request,
    response: Response,
    body: OwnerRejectJoinRequest,
    owner: CurrentUser = Depends(require_ministry_owner_or_admin),
) -> ReviewResponse:
    """Owner rejects a minor's join-request with a reason (ADR 0014)."""
    db = _db()
    jr_ref = db.collection("groups").document(gid).collection("joinRequests").document(uid)
    jr_snap = jr_ref.get()
    jr_exists = getattr(jr_snap, "exists", False)
    jr_status = (jr_snap.to_dict() or {}).get("status") if jr_exists else None
    if jr_status != "pending":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="Pending join request not found",
        )
    jr_data = jr_snap.to_dict() or {}
    if not bool(jr_data.get("requiresOwnerReview")):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_a_minor_request",
            message=(
                "This request is not flagged for owner review; " "the group leader can reject it."
            ),
        )

    jr_ref.update(
        {
            "status": "rejected",
            "reviewedAt": fb_firestore.SERVER_TIMESTAMP,
            "reviewedBy": owner.uid,
            "rejectionReason": body.reason,
        }
    )
    write_audit_log(
        actor_uid=owner.uid,
        action="owner_reject_join_request",
        target_ref=f"groups/{gid}/joinRequests/{uid}",
        payload={"targetUid": uid, "reasonLength": len(body.reason)},
    )
    logger.info("owner=%s rejected minor join_request gid=%s uid=%s", owner.uid, gid, uid)
    return ReviewResponse(gid=gid, uid=uid, status="rejected")
