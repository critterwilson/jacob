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
from google.cloud import firestore as gcf
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import (
    MY_GROUPS_LIST,
    MY_ORGS_LIST,
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
from app.models.orgs import MyOrgsResponse, OrgSummary
from app.models.user import CurrentUser
from app.models.users import (
    BlockedUserEntry,
    BlockResponse,
    BlocksResponse,
    BootstrapClaims,
    BootstrapResponse,
    CreateProfileRequest,
    DeviceResponse,
    MutedGroupEntry,
    MutedGroupResponse,
    MutedGroupsResponse,
    MutedUserEntry,
    MuteResponse,
    MutesResponse,
    Notification,
    NotificationPrefs,
    NotificationsListResponse,
    RegisterDeviceRequest,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.applications import MIN_AGE, compute_age
from app.services.applications import is_minor as _is_minor
from app.services.audit import write_audit_log
from app.services.firebase import get_firestore
from app.services.invites import consume_invite, find_invite_target_gid

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


def _device_id_from_installation(installation_id: str) -> str:
    # Namespace-prefix the digest so an installationId-derived id can
    # never accidentally collide with a token-derived id from a
    # pre-migration registration.
    digest = hashlib.sha256(("install:" + installation_id).encode("utf-8")).hexdigest()
    return "i" + digest[:15]


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
    """Onboarding submit (ADR 0015).

    Open self-signup: any email-verified user can complete onboarding
    and get a `users/{uid}` doc. The server computes `isMinor` from
    `dob`, refuses under-13 with 422, persists the raw `dob` on
    `users/{uid}/private/profile`, and lands the caller in the
    "unaffiliated" tier (no group memberships yet).

    If `inviteCode` is supplied, this route also attempts to consume
    it: adults are auto-joined; minors are escalated to the owner
    queue with the code preserved on the join-request. Failures here
    are non-fatal — the user doc is created either way; the frontend
    surfaces the join outcome on the response.
    """
    age = compute_age(body.dob)
    if age < MIN_AGE:
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="under_minimum_age",
            message="JACOB requires you to be at least 13",
            details={"minimumAge": MIN_AGE},
        )

    db = get_firestore()
    user_ref = db.collection("users").document(user.uid)
    snap = user_ref.get()
    if getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="profile_exists",
            message="Profile already exists",
        )

    minor_flag = _is_minor(body.dob)
    photo_url = str(body.photoURL) if body.photoURL is not None else None
    payload: dict[str, Any] = {
        "displayName": body.displayName,
        "email": user.email,
        "photoURL": photo_url,
        "role": "member",
        "schemaVersion": 1,
        "isMinor": minor_flag,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
    }
    if body.phone:
        payload["phone"] = body.phone
    if body.location:
        payload["location"] = body.location
    if body.faithBackground:
        payload["faithBackground"] = body.faithBackground

    user_ref.set(payload)
    # Persist DOB on the owner-only private subcollection. ADR 0015 § 1
    # keeps the raw date off the public user doc and on the private
    # path the leader/mod surfaces already inspect via the backend.
    user_ref.collection("private").document("profile").set(
        {"dob": body.dob.isoformat()},
        merge=True,
    )

    write_audit_log(
        actor_uid=user.uid,
        action="account.create_profile",
        target_ref=f"users/{user.uid}",
        payload={"isMinor": minor_flag, "hasInviteCode": bool(body.inviteCode)},
    )

    # Optional auto-join via invite code. Mirrors the
    # `services.invites.consume_invite` / minor-escalation branching
    # from `routers/groups.py:join_group`. We swallow errors here —
    # the profile create has already succeeded; the frontend can re-
    # offer the invite landing if the consume failed.
    if body.inviteCode:
        code = body.inviteCode.strip().upper()
        try:
            if minor_flag:
                gid = find_invite_target_gid(db, code)
                jr_ref = (
                    db.collection("groups")
                    .document(gid)
                    .collection("joinRequests")
                    .document(user.uid)
                )
                existing = jr_ref.get()
                if not (existing.exists and (existing.to_dict() or {}).get("status") == "pending"):
                    jr_ref.set(
                        {
                            "message": "",
                            "requestedAt": gcf.SERVER_TIMESTAMP,
                            "status": "pending",
                            "isMinor": True,
                            "requiresOwnerReview": True,
                            "inviteCode": code,
                            "parentalConsentObtained": None,
                            "parentalConsentNotes": "",
                        }
                    )
                    write_audit_log(
                        actor_uid=user.uid,
                        action="request_join_via_invite_minor",
                        target_ref=f"groups/{gid}/joinRequests/{user.uid}",
                        payload={"viaInvite": True, "code": code, "source": "onboarding"},
                    )
            else:
                consume_invite(db, code, user.uid)
        except APIError:
            logger.warning(
                "create_profile: invite consume/escalation failed uid=%s code=%s",
                user.uid,
                code,
            )
        except Exception:  # noqa: BLE001
            logger.exception("create_profile: unexpected error in invite path uid=%s", user.uid)

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

    # Preferred dedup path — Firebase Installations ID is stable per
    # browser install across FCM token rotations, so the same physical
    # install collapses onto a single doc no matter how many times the
    # token rotates (SW updates, PWA reinstalls, iOS subscription
    # churn). Without this, every rotation spawned a fresh device doc
    # and fan-out would FCM-send to every stale token in parallel,
    # producing duplicate notifications on a single physical device.
    if body.installationId is not None:
        existing = list(
            devices_col.where("installationId", "==", body.installationId).limit(1).stream()
        )
        if existing:
            snap = existing[0]
            snap.reference.update(
                {
                    "fcmToken": body.fcmToken,
                    "platform": body.platform,
                    "userAgent": body.userAgent,
                    "appVersion": body.appVersion,
                    "lastSeenAt": fb_firestore.SERVER_TIMESTAMP,
                }
            )
            registered = _ts_to_dt((snap.to_dict() or {}).get("createdAt")) or datetime.now(UTC)
            return DeviceResponse(deviceId=snap.id, registeredAt=registered)

        # First time this install has registered. Create the new doc,
        # then sweep any pre-migration device docs for this user that
        # lack an installationId — those are stale orphans left over
        # from the old token-only dedup path (e.g. Christopher's
        # duplicate iPhone docs that produced the original symptom).
        # We only delete docs missing the installationId field, so a
        # legitimate second physical device that has already migrated
        # is never touched.
        device_id = _device_id_from_installation(body.installationId)
        now = datetime.now(UTC)
        devices_col.document(device_id).set(
            {
                "fcmToken": body.fcmToken,
                "platform": body.platform,
                "userAgent": body.userAgent,
                "appVersion": body.appVersion,
                "installationId": body.installationId,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
                "lastSeenAt": fb_firestore.SERVER_TIMESTAMP,
            }
        )
        _sweep_legacy_devices_without_installation_id(devices_col, keep_id=device_id)
        return DeviceResponse(deviceId=device_id, registeredAt=now)

    # ── Legacy path (back-compat): pre-installationId clients ────────
    # Dedup by fcmToken — incorrect across token rotations but no worse
    # than before this PR. Will be removed once every client has shipped
    # the installationId send.
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


def _sweep_legacy_devices_without_installation_id(devices_col: Any, *, keep_id: str) -> None:
    """One-shot migration: drop pre-`installationId` device docs for the
    user once they've registered an installation-id-bearing device.

    Pre-installationId docs are dedupe-keyed by fcmToken value, which
    means every token rotation spawned a fresh doc. Now that the user
    has registered with a stable identifier, the old docs are
    duplicates of the same physical install. Deleting them stops the
    fan-out from sending to multiple tokens for one phone.

    The sweep is conservative: it only deletes docs that have NO
    `installationId` field, so a second physical device that has
    already migrated is unaffected.
    """
    for snap in devices_col.stream():
        if snap.id == keep_id:
            continue
        data = snap.to_dict() or {}
        if "installationId" in data:
            continue
        snap.reference.delete()


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
    snaps = list(col.stream())
    if not snaps:
        return MutesResponse(mutedUsers=[])
    user_refs = [db.collection("users").document(s.id) for s in snaps]
    user_docs = list(db.get_all(user_refs))
    profiles: dict[str, dict[str, Any]] = {}
    for doc in user_docs:
        if getattr(doc, "exists", False):
            profiles[doc.id] = doc.to_dict() or {}
    return MutesResponse(
        mutedUsers=[
            MutedUserEntry(
                uid=s.id,
                displayName=str(profiles.get(s.id, {}).get("displayName") or s.id),
                photoURL=profiles.get(s.id, {}).get("photoURL"),
            )
            for s in snaps
        ]
    )


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


# ── group mutes (ADR 0014) ─────────────────────────────────────────────────
#
# Per-group push silencing. Distinct from `/mutes/{uid}` (which hides a
# specific user's messages everywhere). A group mute only suppresses the
# generic `group_message` push fan-out for one group — @mentions and
# replies to your own messages still come through, because those carry
# an explicit ask for attention.


@router.get("/muted-groups", response_model=MutedGroupsResponse)
def list_muted_groups(
    user: CurrentUser = Depends(get_current_user),
) -> MutedGroupsResponse:
    db = get_firestore()
    col = db.collection("users").document(user.uid).collection("mutedGroups")
    snaps = list(col.stream())
    entries: list[MutedGroupEntry] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        muted_at = _ts_to_dt(data.get("mutedAt")) or datetime.now(UTC)
        entries.append(MutedGroupEntry(groupId=snap.id, mutedAt=muted_at))
    return MutedGroupsResponse(mutedGroups=entries)


@router.post(
    "/muted-groups/{group_id}",
    response_model=MutedGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(USER_MUTES_WRITE)
def create_group_mute(
    request: Request,
    response: Response,
    group_id: str,
    user: CurrentUser = Depends(require_not_banned),
) -> MutedGroupResponse:
    if not group_id:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_group_id",
            message="group_id is required",
        )
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("mutedGroups").document(group_id)
    now = datetime.now(UTC)
    ref.set({"groupId": group_id, "mutedAt": fb_firestore.SERVER_TIMESTAMP})
    return MutedGroupResponse(groupId=group_id, mutedAt=now)


@router.delete(  # noqa: not-banned
    "/muted-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT
)
@limiter.limit(USER_MUTES_WRITE)
def delete_group_mute(
    request: Request,
    response: Response,
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    db = get_firestore()
    ref = db.collection("users").document(user.uid).collection("mutedGroups").document(group_id)
    ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── blocks ───────────────────────────────────────────────────────────────


@router.get("/blocks", response_model=BlocksResponse)
def list_blocks(
    user: CurrentUser = Depends(get_current_user),
) -> BlocksResponse:
    db = get_firestore()
    col = db.collection("users").document(user.uid).collection("blocks")
    snaps = list(col.stream())
    if not snaps:
        return BlocksResponse(blockedUsers=[])
    user_refs = [db.collection("users").document(s.id) for s in snaps]
    user_docs = list(db.get_all(user_refs))
    profiles: dict[str, dict[str, Any]] = {}
    for doc in user_docs:
        if getattr(doc, "exists", False):
            profiles[doc.id] = doc.to_dict() or {}
    return BlocksResponse(
        blockedUsers=[
            BlockedUserEntry(
                uid=s.id,
                displayName=str(profiles.get(s.id, {}).get("displayName") or s.id),
                photoURL=profiles.get(s.id, {}).get("photoURL"),
            )
            for s in snaps
        ]
    )


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


@router.get("/orgs", response_model=MyOrgsResponse)
@limiter.limit(MY_ORGS_LIST)
def my_orgs(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> MyOrgsResponse:
    """Return the orgs the caller is an admin or member of.

    Admin membership: `orgs/{orgId}/admins/{uid}` docs that carry
    `uid == user.uid` (indexed field added alongside this endpoint).
    Member membership: derived from group memberships — any group the
    caller belongs to that has an `orgId` field set.
    Results are deduplicated with "admin" role taking precedence over "member".
    """
    db = get_firestore()

    org_roles: dict[str, Literal["admin", "member"]] = {}

    # 1. Org admin memberships — collection_group("admins") indexed by uid field.
    for snap in db.collection_group("admins").where("uid", "==", user.uid).stream():
        parent_org = snap.reference.parent.parent
        if parent_org is not None:
            org_roles[parent_org.id] = "admin"

    # 2. Org member memberships — derived from group memberships that carry orgId.
    for snap in db.collection_group("members").where("uid", "==", user.uid).stream():
        parent_group = snap.reference.parent.parent
        if parent_group is None:
            continue
        group_snap = parent_group.get()
        if not getattr(group_snap, "exists", False):
            continue
        org_id = (group_snap.to_dict() or {}).get("orgId")
        if org_id and org_id not in org_roles:
            org_roles[org_id] = "member"

    if not org_roles:
        return MyOrgsResponse(orgs=[])

    # 3. Fetch the org docs.
    org_refs = [db.collection("orgs").document(oid) for oid in org_roles]
    orgs: list[OrgSummary] = []
    for doc in db.get_all(org_refs):
        if not getattr(doc, "exists", False):
            continue
        data = doc.to_dict() or {}
        orgs.append(
            OrgSummary(
                orgId=doc.id,
                name=str(data.get("name", "")),
                slug=str(data.get("slug", "")),
                audience=data.get("audience", "christian"),
                logoUrl=data.get("logoUrl"),
                role=org_roles[doc.id],
            )
        )

    return MyOrgsResponse(orgs=orgs)


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
        key=lambda m: m.createdAt or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return RecentMessagesResponse(messages=accumulated[:_RECENT_FEED_LIMIT])


__all__ = ["router"]
