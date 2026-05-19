"""Users router — M2 of the data-layer migration.

Owns every `users/{uid}` and `users/{uid}/...` read/write that the
frontend used to perform via the Firestore SDK. Every endpoint scopes to
the calling user (`me`) — administrative reads on other users live
elsewhere.

The cookie-bootstrap (`GET /api/users/me/bootstrap`) is the load-bearing
endpoint for the onboarding redirect: `frontend/middleware.ts` keys off
the `jacob-has-profile` cookie, and after M2 the cookie is set
server-side from the bootstrap response (and from `POST /api/users/me`).
See `docs/data-layer-migration-plan.md` §7.M2.5.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import (
    MY_GROUPS_LIST,
    NOTIFICATION_READ,
    RECENT_MESSAGES_READ,
    USER_BLOCKS_WRITE,
    USER_BOOTSTRAP,
    USER_DEVICE_REGISTER,
    USER_MUTES_WRITE,
    USER_NOTIFICATION_PREFS_WRITE,
    USER_NOTIFICATIONS_LIST,
    USER_PROFILE_CREATE,
    USER_PROFILE_UPDATE,
)
from app.middleware.rate_limit import limiter
from app.models.members import GroupSummary, MyGroupsResponse
from app.models.messages import RecentMessage, RecentMessagesResponse
from app.models.user import CurrentUser
from app.models.users import (
    BlockResponse,
    BlocksResponse,
    BootstrapClaims,
    BootstrapResponse,
    CreateProfileRequest,
    DeviceResponse,
    MuteResponse,
    MutesResponse,
    Notification,
    NotificationPrefs,
    NotificationsListResponse,
    RegisterDeviceRequest,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.audit import write_audit_log
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users/me", tags=["users"])

_DEFAULT_NOTIFICATION_PREFS = NotificationPrefs()
_NOTIFICATIONS_PAGE_DEFAULT = 50
_NOTIFICATIONS_PAGE_MAX = 100


# ── helpers ────────────────────────────────────────────────────────────────


def _ts_to_dt(value: Any) -> datetime | None:
    """Convert Firestore Timestamp / datetime / None to a datetime."""
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


def _user_doc_to_profile(uid: str, data: dict[str, Any]) -> UserProfile:
    """Hydrate a `UserProfile` from a `users/{uid}` snapshot dict."""
    return UserProfile(
        uid=uid,
        displayName=str(data.get("displayName") or ""),
        email=data.get("email"),
        photoURL=data.get("photoURL"),
        role=str(data.get("role") or "member"),
        schemaVersion=int(data.get("schemaVersion") or 1),
        isMinor=bool(data.get("isMinor") or False),
        createdAt=_ts_to_dt(data.get("createdAt")),
        phone=data.get("phone"),
        location=data.get("location"),
        faithBackground=data.get("faithBackground"),
        locale=data.get("locale"),
    )


def _set_profile_cookie(response: Response, request: Request, *, has_profile: bool) -> None:
    """Set or clear the `jacob-has-profile` cookie used by the Next.js middleware."""
    secure = request.url.scheme == "https"
    if has_profile:
        response.set_cookie(
            "jacob-has-profile",
            "1",
            path="/",
            samesite="lax",
            secure=secure,
            httponly=False,
        )
    else:
        # Clear the cookie. Browsers expect Max-Age=0 alongside the same
        # Path/SameSite attributes the original cookie was written with.
        response.set_cookie(
            "jacob-has-profile",
            "",
            path="/",
            max_age=0,
            samesite="lax",
            secure=secure,
            httponly=False,
        )


def _device_id_from_token(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return digest[:16]


def _encode_cursor(created_at: datetime, doc_id: str) -> str:
    payload = f"{created_at.isoformat()}|{doc_id}".encode()
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        ts_str, doc_id = raw.split("|", 1)
        return datetime.fromisoformat(ts_str), doc_id
    except Exception:  # noqa: BLE001
        return None


# ── bootstrap ──────────────────────────────────────────────────────────────


@router.get("/bootstrap", response_model=BootstrapResponse)
@limiter.limit(USER_BOOTSTRAP)
def bootstrap(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> BootstrapResponse:
    db = get_firestore()
    snap = db.collection("users").document(user.uid).get()
    has_profile = bool(getattr(snap, "exists", False))
    profile: UserProfile | None = None
    deletion_requested_at: datetime | None = None
    if has_profile:
        data = snap.to_dict() or {}
        profile = _user_doc_to_profile(user.uid, data)
        deletion_requested_at = _ts_to_dt(data.get("deletionRequestedAt"))

    # ADR 0012 — surface the application status alongside the user doc
    # so the frontend can route pending/rejected applicants to the
    # waiting screen without an extra round-trip. Existing users
    # (pre-this-PR) have no application doc; for them this stays None.
    application_status: str | None = None
    app_snap = db.collection("applications").document(user.uid).get()
    if getattr(app_snap, "exists", False):
        app_status_raw = (app_snap.to_dict() or {}).get("status")
        if app_status_raw in ("pending", "approved", "rejected"):
            application_status = app_status_raw

    _set_profile_cookie(response, request, has_profile=has_profile)

    return BootstrapResponse(
        profile=profile,
        hasProfile=has_profile,
        claims=BootstrapClaims(
            admin=user.claims.get("admin") is True,
            ministryOwner=user.claims.get("ministry_owner") is True,
        ),
        deletionRequestedAt=deletion_requested_at,
        applicationStatus=application_status,
    )


# ── profile create / update ───────────────────────────────────────────────


@router.post("", response_model=UserProfile, status_code=status.HTTP_201_CREATED)
@limiter.limit(USER_PROFILE_CREATE)
def create_profile(
    request: Request,
    response: Response,
    body: CreateProfileRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> UserProfile:
    """**Deprecated post-ADR 0012.** New signups must go through
    `POST /api/applications/me` and wait for admin approval. The
    `users/{uid}` document is created server-side by the admin
    approve endpoint, not by this route. We keep the endpoint
    available but refuse calls that don't have a corresponding
    approved application — that is the new ingress contract.
    """
    db = get_firestore()
    user_ref = db.collection("users").document(user.uid)
    snap = user_ref.get()
    if getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="profile_exists",
            message="Profile already exists",
        )

    # ADR 0012: refuse direct profile creation without an approved
    # application. The frontend now uses `/api/applications/me`; this
    # endpoint exists only so an already-approved user (theoretical
    # race: approve flips status, the user doc write fails, the user
    # retries) can finish provisioning. In every other case the user
    # must apply first.
    app_snap = db.collection("applications").document(user.uid).get()
    if not getattr(app_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="application_required",
            message="Submit an application via POST /api/applications/me first",
        )
    app_status = str((app_snap.to_dict() or {}).get("status") or "")
    if app_status != "approved":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="application_not_approved",
            message="Your application has not been approved yet",
            details={"status": app_status},
        )

    photo_url = str(body.photoURL) if body.photoURL is not None else None
    payload: dict[str, Any] = {
        "displayName": body.displayName,
        "email": user.email,
        "photoURL": photo_url,
        "role": "member",
        "schemaVersion": 1,
        "isMinor": body.isMinor,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
    }
    if body.phone:
        payload["phone"] = body.phone
    if body.location:
        payload["location"] = body.location
    if body.faithBackground:
        payload["faithBackground"] = body.faithBackground

    user_ref.set(payload)
    write_audit_log(
        actor_uid=user.uid,
        action="account.create_profile",
        target_ref=f"users/{user.uid}",
        payload={"isMinor": body.isMinor},
    )

    fresh = user_ref.get()
    profile = _user_doc_to_profile(user.uid, fresh.to_dict() or {})
    _set_profile_cookie(response, request, has_profile=True)
    return profile


@router.patch("", response_model=UserProfile)
@limiter.limit(USER_PROFILE_UPDATE)
def update_profile(
    request: Request,
    response: Response,
    body: UpdateProfileRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> UserProfile:
    supplied = body.model_dump(exclude_unset=True)
    if not supplied:
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="empty_update",
            message="At least one field must be supplied",
        )

    db = get_firestore()
    user_ref = db.collection("users").document(user.uid)
    existing_snap = user_ref.get()
    if not getattr(existing_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="Profile does not exist",
        )

    update: dict[str, Any] = {}
    if "displayName" in supplied:
        update["displayName"] = supplied["displayName"]
    if "photoURL" in supplied:
        url = supplied["photoURL"]
        update["photoURL"] = str(url) if url is not None else None
    if "isMinor" in supplied:
        update["isMinor"] = bool(supplied["isMinor"])
    if "locale" in supplied:
        update["locale"] = supplied["locale"]
    if "phone" in supplied:
        update["phone"] = supplied["phone"]
    if "location" in supplied:
        update["location"] = supplied["location"]
    if "faithBackground" in supplied:
        update["faithBackground"] = supplied["faithBackground"]

    # PR13 / L3: Firebase Auth lets users change their email. The Firestore
    # mirror set at create-time then diverges — leaders see stale emails on
    # the members list, digests email an old address, etc. Sync from the
    # already-verified ID token whenever the value differs from the doc.
    # No extra reads — `user.email` comes from the token; the user doc was
    # just fetched above for the existence check.
    existing = existing_snap.to_dict() or {}
    if user.email is not None and existing.get("email") != user.email:
        update["email"] = user.email

    user_ref.update(update)
    write_audit_log(
        actor_uid=user.uid,
        action="account.update_profile",
        target_ref=f"users/{user.uid}",
        payload={"changedKeys": sorted(update.keys())},
    )

    fresh = user_ref.get()
    profile = _user_doc_to_profile(user.uid, fresh.to_dict() or {})
    return profile


# ── notification preferences ─────────────────────────────────────────────


@router.get("/notification-prefs", response_model=NotificationPrefs)
def get_notification_prefs(
    user: CurrentUser = Depends(get_current_user),
) -> NotificationPrefs:
    db = get_firestore()
    snap = (
        db.collection("users")
        .document(user.uid)
        .collection("notificationPrefs")
        .document("main")
        .get()
    )
    if not getattr(snap, "exists", False):
        return _DEFAULT_NOTIFICATION_PREFS
    data = snap.to_dict() or {}
    # Merge with defaults — older docs may pre-date a new flag.
    merged = _DEFAULT_NOTIFICATION_PREFS.model_copy(
        update={
            k: v for k, v in data.items() if k in NotificationPrefs.model_fields and v is not None
        }
    )
    return merged


@router.put(
    "/notification-prefs", response_model=NotificationPrefs
)  # PUT is correct: caller sends the complete prefs doc and ref.set() replaces it wholesale
@limiter.limit(USER_NOTIFICATION_PREFS_WRITE)
def put_notification_prefs(
    request: Request,
    response: Response,
    body: NotificationPrefs,
    user: CurrentUser = Depends(require_not_banned),
) -> NotificationPrefs:
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("notificationPrefs").document("main")
    ref.set(body.model_dump())
    return body


# ── FCM device registration ───────────────────────────────────────────────


@router.post("/devices", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(USER_DEVICE_REGISTER)
def register_device(
    request: Request,
    response: Response,
    body: RegisterDeviceRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> DeviceResponse:
    db = get_firestore()
    devices_col = db.collection("users").document(user.uid).collection("devices")

    # Dedupe: if this fcmToken already exists for the user, return the
    # existing deviceId rather than spawn a duplicate doc. The original
    # client logic hashed the token to derive a stable id so duplicates
    # were already collapsed; the backend matches that contract.
    existing = list(devices_col.where("fcmToken", "==", body.fcmToken).limit(1).stream())
    if existing:
        snap = existing[0]
        snap.reference.update({"lastSeenAt": fb_firestore.SERVER_TIMESTAMP})
        registered = _ts_to_dt((snap.to_dict() or {}).get("createdAt")) or datetime.now(UTC)
        return DeviceResponse(deviceId=snap.id, registeredAt=registered)

    device_id = _device_id_from_token(body.fcmToken)
    now = datetime.now(UTC)
    devices_col.document(device_id).set(
        {
            "fcmToken": body.fcmToken,
            "platform": body.platform,
            "userAgent": body.userAgent,
            "appVersion": body.appVersion,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "lastSeenAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    return DeviceResponse(deviceId=device_id, registeredAt=now)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)  # noqa: not-banned
def delete_device(
    device_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("devices").document(device_id)
    if not getattr(ref.get(), "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="device_not_found",
            message="Device not registered",
        )
    ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── notifications inbox ──────────────────────────────────────────────────


@router.get("/notifications", response_model=NotificationsListResponse)
@limiter.limit(USER_NOTIFICATIONS_LIST)
def list_notifications(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_NOTIFICATIONS_PAGE_DEFAULT, ge=1, le=_NOTIFICATIONS_PAGE_MAX),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    user: CurrentUser = Depends(get_current_user),
) -> NotificationsListResponse:
    db = get_firestore()
    col = db.collection("users").document(user.uid).collection("notifications")
    query = col.order_by("createdAt", direction=fb_firestore.Query.DESCENDING)
    if unread_only:
        query = query.where("readAt", "==", None)
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_cursor",
                message="Cursor is malformed",
            )
        cursor_ts, cursor_doc_id = decoded
        # PR10 / M2: tie-break on __name__ so notifications with identical
        # createdAt don't drop or duplicate at the page boundary.
        query = query.order_by("__name__", direction=fb_firestore.Query.DESCENDING).start_after(
            {"createdAt": cursor_ts, "__name__": cursor_doc_id}
        )
    query = query.limit(limit + 1)

    items: list[Notification] = []
    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]
    for snap in snaps:
        data = snap.to_dict() or {}
        created_at = _ts_to_dt(data.get("createdAt"))
        if created_at is None:
            continue
        items.append(
            Notification(
                id=snap.id,
                kind=str(data.get("kind") or "unknown"),
                createdAt=created_at,
                readAt=_ts_to_dt(data.get("readAt")),
                payload=dict(data.get("payload") or {}),
            )
        )

    next_cursor: str | None = None
    if has_more and items:
        last = items[-1]
        next_cursor = _encode_cursor(last.createdAt, last.id)

    return NotificationsListResponse(items=items, nextCursor=next_cursor)


@router.post(  # noqa: not-banned
    "/notifications/{notification_id}/read",
    response_model=Notification,
)
@limiter.limit(NOTIFICATION_READ)
def mark_notification_read(
    request: Request,
    response: Response,
    notification_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Notification:
    """Mark a notification as read.

    Replaces the prior client-side `updateDoc(notification, {readAt})`.
    Returns the fresh notification doc. Mirrors `firestore.rules:653-660`
    — the user only writes `readAt`, never any other field.
    """
    db = get_firestore()
    ref = (
        db.collection("users")
        .document(user.uid)
        .collection("notifications")
        .document(notification_id)
    )
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="notification_not_found",
            message="Notification not found",
        )
    data = snap.to_dict() or {}
    if data.get("readAt") is None:
        ref.update({"readAt": fb_firestore.SERVER_TIMESTAMP})
    fresh = ref.get()
    fresh_data = fresh.to_dict() or {}
    created_at = _ts_to_dt(fresh_data.get("createdAt")) or datetime.now(UTC)
    return Notification(
        id=fresh.id,
        kind=str(fresh_data.get("kind") or "unknown"),
        createdAt=created_at,
        readAt=_ts_to_dt(fresh_data.get("readAt")),
        payload=dict(fresh_data.get("payload") or {}),
    )


# ── mutes ────────────────────────────────────────────────────────────────


@router.get("/mutes", response_model=MutesResponse)
def list_mutes(
    user: CurrentUser = Depends(get_current_user),
) -> MutesResponse:
    db = get_firestore()
    col = db.collection("users").document(user.uid).collection("mutes")
    return MutesResponse(mutedUids=[snap.id for snap in col.stream()])


@router.post(
    "/mutes/{other_uid}",
    response_model=MuteResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(USER_MUTES_WRITE)
def create_mute(
    request: Request,
    response: Response,
    other_uid: str,
    user: CurrentUser = Depends(require_not_banned),
) -> MuteResponse:
    if other_uid == user.uid:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="self_mute",
            message="Cannot mute yourself",
        )
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("mutes").document(other_uid)
    now = datetime.now(UTC)
    ref.set({"mutedAt": fb_firestore.SERVER_TIMESTAMP})
    return MuteResponse(uid=other_uid, mutedAt=now)


@router.delete("/mutes/{other_uid}", status_code=status.HTTP_204_NO_CONTENT)  # noqa: not-banned
@limiter.limit(USER_MUTES_WRITE)
def delete_mute(
    request: Request,
    response: Response,
    other_uid: str,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("mutes").document(other_uid)
    ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── blocks ───────────────────────────────────────────────────────────────


@router.get("/blocks", response_model=BlocksResponse)
def list_blocks(
    user: CurrentUser = Depends(get_current_user),
) -> BlocksResponse:
    db = get_firestore()
    col = db.collection("users").document(user.uid).collection("blocks")
    return BlocksResponse(blockedUids=[snap.id for snap in col.stream()])


@router.post(
    "/blocks/{other_uid}",
    response_model=BlockResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(USER_BLOCKS_WRITE)
def create_block(
    request: Request,
    response: Response,
    other_uid: str,
    user: CurrentUser = Depends(require_not_banned),
) -> BlockResponse:
    if other_uid == user.uid:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="self_block",
            message="Cannot block yourself",
        )
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("blocks").document(other_uid)
    now = datetime.now(UTC)
    ref.set({"blockedAt": fb_firestore.SERVER_TIMESTAMP})
    return BlockResponse(uid=other_uid, blockedAt=now)


@router.delete("/blocks/{other_uid}", status_code=status.HTTP_204_NO_CONTENT)  # noqa: not-banned
@limiter.limit(USER_BLOCKS_WRITE)
def delete_block(
    request: Request,
    response: Response,
    other_uid: str,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("blocks").document(other_uid)
    ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── M3: groups list + recent-messages feed ────────────────────────────────


_ARCHIVE_HIDE_DAYS = 60
_RECENT_FEED_LIMIT = 10
_RECENT_PER_GROUP = 6


def _archived_after_cutoff(archived_at: datetime | None) -> bool:
    """`useGroups` filtered out groups archived more than 60 days ago.
    Mirror that filter server-side so the frontend doesn't have to.
    """
    if archived_at is None:
        return True
    cutoff = datetime.now(UTC) - timedelta(days=_ARCHIVE_HIDE_DAYS)
    archived_aware = archived_at if archived_at.tzinfo else archived_at.replace(tzinfo=UTC)
    return archived_aware >= cutoff


@router.get("/groups", response_model=MyGroupsResponse)
@limiter.limit(MY_GROUPS_LIST)
def my_groups(
    request: Request,
    response: Response,
    archived: str = Query(default="exclude", pattern="^(include|exclude)$"),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: CurrentUser = Depends(get_current_user),
) -> Any:
    """Replaces the frontend collection-group `members` query.

    For each membership doc the caller owns, joins against the parent
    group doc to return a `GroupSummary`. Groups archived more than 60
    days ago are excluded by default (matches the prior client filter).
    """
    db = get_firestore()
    cg = db.collection_group("members").where("uid", "==", user.uid)
    member_snaps = list(cg.stream())

    # Pull each membership's parent group via batched get_all().
    pairs: list[tuple[str, dict[str, Any]]] = []
    group_ref_by_gid: dict[str, Any] = {}
    for snap in member_snaps:
        parent_group = snap.reference.parent.parent
        if parent_group is None:
            continue
        gid = parent_group.id
        member_data = snap.to_dict() or {}
        pairs.append((gid, member_data))
        group_ref_by_gid.setdefault(gid, parent_group)

    group_docs: list[Any] = []
    if group_ref_by_gid:
        group_docs = list(db.get_all(list(group_ref_by_gid.values())))
    group_data_by_gid: dict[str, dict[str, Any]] = {}
    for doc in group_docs:
        if getattr(doc, "exists", False):
            group_data_by_gid[doc.id] = doc.to_dict() or {}

    # PR13 / L2: log orphan memberships (the `members/{uid}` doc points at a
    # group that has been deleted). Catches zombie membership rows that
    # accumulate when group deletes don't fan out cleanly. Logged once per
    # request for the calling uid.
    orphan_gids = [gid for gid, _ in pairs if gid not in group_data_by_gid]
    if orphan_gids:
        logger.warning(
            "my_groups_orphan_memberships uid=%s gids=%s count=%d",
            user.uid,
            ",".join(sorted(set(orphan_gids))[:20]),
            len(orphan_gids),
        )

    summaries: list[GroupSummary] = []
    for gid, member_data in pairs:
        group_data = group_data_by_gid.get(gid)
        if group_data is None:
            continue
        archived_at = _ts_to_dt(group_data.get("archivedAt"))
        if archived == "exclude" and not _archived_after_cutoff(archived_at):
            continue
        role_raw = str(member_data.get("role") or "member")
        role: Literal["member", "leader"] = "leader" if role_raw == "leader" else "member"
        summaries.append(
            GroupSummary(
                gid=gid,
                name=str(group_data.get("name") or ""),
                description=str(group_data.get("description") or ""),
                avatarUrl=group_data.get("avatarUrl"),
                isPrivate=bool(group_data.get("isPrivate") or False),
                archivedAt=archived_at,
                role=role,
                joinedAt=_ts_to_dt(member_data.get("joinedAt")),
                memberCount=int(group_data.get("memberCount") or 0),
                lastMessageAt=_ts_to_dt(group_data.get("lastMessageAt")),
            )
        )
    payload = MyGroupsResponse(groups=summaries)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'
    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return payload


@router.get("/recent-messages", response_model=RecentMessagesResponse)
@limiter.limit(RECENT_MESSAGES_READ)
def recent_messages(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> RecentMessagesResponse:
    """Cross-group recent-messages feed for the authenticated user.

    Mirrors the prior `useRecentMessages` hook: per-group N most-recent
    top-level non-deleted messages, merged + sorted server-side. Returns
    at most `_RECENT_FEED_LIMIT` items.
    """
    db = get_firestore()
    cg = db.collection_group("members").where("uid", "==", user.uid)
    pairs: list[tuple[str, dict[str, Any]]] = []
    group_refs: dict[str, Any] = {}
    for snap in cg.stream():
        parent_group = snap.reference.parent.parent
        if parent_group is None:
            continue
        gid = parent_group.id
        pairs.append((gid, snap.to_dict() or {}))
        group_refs.setdefault(gid, parent_group)

    if not group_refs:
        return RecentMessagesResponse(messages=[])

    group_docs = list(db.get_all(list(group_refs.values())))
    name_by_gid = {
        d.id: str((d.to_dict() or {}).get("name") or "")
        for d in group_docs
        if getattr(d, "exists", False)
    }

    def _fetch_for_group(gid: str) -> list[RecentMessage]:
        col = db.collection("groups").document(gid).collection("messages")
        q = (
            col.where("parentMessageId", "==", None)
            .order_by("createdAt", direction=fb_firestore.Query.DESCENDING)
            .limit(_RECENT_PER_GROUP)
        )
        out: list[RecentMessage] = []
        for snap in q.stream():
            data = snap.to_dict() or {}
            if data.get("deletedAt") is not None:
                continue
            mod = data.get("moderation") or {}
            if isinstance(mod, dict) and mod.get("state") == "hidden":
                continue
            out.append(
                RecentMessage(
                    id=snap.id,
                    gid=gid,
                    groupName=name_by_gid[gid],
                    authorUid=str(data.get("authorUid") or ""),
                    body=str(data.get("body") or ""),
                    createdAt=_ts_to_dt(data.get("createdAt")),
                    deletedAt=None,
                    mediaRefs=list(data.get("mediaRefs") or []),
                )
            )
        return out

    # PR10 / M1: per-group queries used to run sequentially. A user in 20
    # groups paid 20× the round-trip latency. Parallelize them — same total
    # Firestore reads, much faster wall-clock and lower handler-timeout
    # risk. Worker cap is generous for typical accounts and bounded so a
    # user in 100+ groups doesn't blow the pool.
    accumulated: list[RecentMessage] = []
    gids = list(name_by_gid.keys())
    if gids:
        max_workers = min(10, len(gids))
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            for chunk in ex.map(_fetch_for_group, gids):
                accumulated.extend(chunk)

    accumulated.sort(
        key=lambda m: (m.createdAt or datetime.min.replace(tzinfo=UTC)),
        reverse=True,
    )
    return RecentMessagesResponse(messages=accumulated[:_RECENT_FEED_LIMIT])


__all__ = ["router"]
