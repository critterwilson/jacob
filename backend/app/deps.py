"""Auth dependencies for protected FastAPI endpoints.

Every protected route depends on `get_current_user`. Admin-only routes
depend on `require_admin`, which extends `get_current_user` with a
custom-claim check.

M3 adds the group-membership deps (`require_member`, `require_leader`,
`require_member_or_public`, `require_member_or_public_top_level`) that
translate the `firestore.rules` membership predicates into single-source-
of-truth FastAPI dependencies. Each dep returns a `MembershipContext` (or
`PublicReadContext` for non-member readers of public groups) carrying
the already-fetched group document so handlers don't need to re-read it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import Depends, Header, Path, Request, status
from firebase_admin import auth as firebase_auth

from app.errors import APIError
from app.models.user import CurrentUser
from app.services.firebase import get_firestore, init_firebase_admin

_BEARER_PREFIX = "Bearer "


def _unauthenticated(message: str) -> APIError:
    return APIError(
        status_code=status.HTTP_401_UNAUTHORIZED,
        code="unauthenticated",
        message=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> CurrentUser:
    init_firebase_admin()

    if authorization is None:
        raise _unauthenticated("Missing Authorization header")
    if not authorization.startswith(_BEARER_PREFIX):
        raise _unauthenticated("Authorization header must use Bearer scheme")

    token = authorization[len(_BEARER_PREFIX) :].strip()
    if not token:
        raise _unauthenticated("Empty bearer token")

    try:
        decoded = firebase_auth.verify_id_token(token)
    except firebase_auth.ExpiredIdTokenError:
        raise _unauthenticated("Token expired") from None
    except firebase_auth.RevokedIdTokenError:
        raise _unauthenticated("Token revoked") from None
    except firebase_auth.InvalidIdTokenError:
        raise _unauthenticated("Invalid token") from None
    except Exception:
        # firebase-admin can surface various transport / decoding errors;
        # treat them all as 401 rather than leaking details to the client.
        raise _unauthenticated("Token verification failed") from None

    user = CurrentUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        claims=decoded,
    )
    request.state.uid = user.uid
    return user


def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.claims.get("admin") is not True:  # strict identity — `admin: 1` must not grant access
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Admin privileges required",
        )
    return user


def _ban_expires_at(snap_data: dict[str, Any] | None) -> datetime | None:
    if not snap_data:
        return None
    expires = snap_data.get("expiresAt")
    if expires is None:
        return None
    if isinstance(expires, datetime):
        return expires if expires.tzinfo else expires.replace(tzinfo=UTC)
    converter = getattr(expires, "ToDatetime", None)
    if callable(converter):
        try:
            result = converter(tzinfo=UTC)
        except TypeError:
            result = converter()
        if isinstance(result, datetime):
            return result if result.tzinfo else result.replace(tzinfo=UTC)
    return None


def require_not_banned(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Refuse the request if the caller has an active ban.

    Mirrors the `notBanned()` predicate at `firestore.rules:26-28`.
    Active = `bans/{uid}` exists and `expiresAt > now`. M2 introduces
    this dep for every authenticated *write* surface — see §5.2 of the
    data-layer migration plan.
    """
    db = get_firestore()
    snap = db.collection("bans").document(user.uid).get()
    if not getattr(snap, "exists", False):
        return user
    expires = _ban_expires_at(snap.to_dict())
    if expires is not None and expires > datetime.now(UTC):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="banned",
            message="Account is banned",
            details={"expiresAt": expires.isoformat()},
        )
    return user


# ── M3: group-membership context ────────────────────────────────────────────


@dataclass(frozen=True)
class MembershipContext:
    """Result of `require_member` / `require_leader`.

    Carries the already-fetched group dict so handlers downstream don't
    re-read the group doc. `role` is the calling user's role in this
    group ("member" or "leader").
    """

    gid: str
    uid: str
    role: Literal["member", "leader"]
    group: dict[str, Any]


@dataclass(frozen=True)
class PublicReadContext:
    """Result of `require_member_or_public*` when the caller is *not* a
    member but the group is public.

    `role` is `None` to distinguish a true membership from a public-read.
    """

    gid: str
    uid: str
    group: dict[str, Any]


MemberOrPublic = MembershipContext | PublicReadContext


def _read_group_and_member(gid: str, uid: str) -> tuple[Any, Any]:
    db = get_firestore()
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(uid)
    return group_ref.get(), member_ref.get()


def _ensure_group_exists(snap: Any, gid: str) -> dict[str, Any]:
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    data = snap.to_dict() or {}
    return data


def require_member(
    gid: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> MembershipContext:
    """Require the caller to be a member of `gid`.

    Mirrors `firestore.rules:isGroupMember` (lines 30-33). Returns the
    already-fetched group doc + role. Raises 404 if the group is missing
    and 403 if the caller is not a member.
    """
    group_snap, member_snap = _read_group_and_member(gid, user.uid)
    group_data = _ensure_group_exists(group_snap, gid)
    if not getattr(member_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="not_a_member",
            message="Not a member of this group",
        )
    role_raw = (member_snap.to_dict() or {}).get("role") or "member"
    role: Literal["member", "leader"] = "leader" if role_raw == "leader" else "member"
    return MembershipContext(gid=gid, uid=user.uid, role=role, group=group_data)


def require_leader(
    membership: MembershipContext = Depends(require_member),
) -> MembershipContext:
    """Require the caller to be a *leader* of `gid`.

    Mirrors `firestore.rules:isGroupLeader` (lines 35-38). Reuses the
    membership read from `require_member` to avoid an extra round-trip.
    """
    if membership.role != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="not_a_leader",
            message="Only group leaders can perform this action",
        )
    return membership


def require_member_or_public(
    gid: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> MemberOrPublic:
    """Allow members; also allow non-members to read public groups.

    Mirrors `firestore.rules:174-175` (`isGroupMember(gid) || resource.data.isPrivate == false`).
    Used by `GET /api/groups/{gid}` and the pinned-messages read so the
    public-discoverable group profile is reachable without a membership.
    """
    group_snap, member_snap = _read_group_and_member(gid, user.uid)
    group_data = _ensure_group_exists(group_snap, gid)
    if getattr(member_snap, "exists", False):
        role_raw = (member_snap.to_dict() or {}).get("role") or "member"
        role: Literal["member", "leader"] = "leader" if role_raw == "leader" else "member"
        return MembershipContext(gid=gid, uid=user.uid, role=role, group=group_data)
    if not bool(group_data.get("isPrivate", False)):
        return PublicReadContext(gid=gid, uid=user.uid, group=group_data)
    raise APIError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="not_a_member",
        message="Not a member of this group",
    )


def require_member_or_public_top_level(
    gid: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> MemberOrPublic:
    """Same as `require_member_or_public`, but the public branch grants
    only top-level non-deleted non-hidden message reads.

    Mirrors `firestore.rules:314-320`. The handler inspects the result
    type to decide whether to filter and which fields to include.
    """
    return require_member_or_public(gid=gid, user=user)


# ── M4: write-side guards ────────────────────────────────────────────────


def require_member_not_banned(
    membership: MembershipContext = Depends(require_member),
    _ban_check: CurrentUser = Depends(require_not_banned),
) -> MembershipContext:
    """Compose `require_member` + `require_not_banned`.

    M4 write surfaces compose this dep so the membership read is
    threaded through and the ban check happens once per request.
    """
    return membership


def require_not_archived(membership: MembershipContext) -> MembershipContext:
    """Reject writes against an archived group (firestore.rules:323-347 and
    related). The `archivedAt` timestamp is read off the already-fetched
    group doc — no extra round-trip.
    """
    if membership.group.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="archived",
            message="Group is archived; new writes are disabled",
        )
    return membership
