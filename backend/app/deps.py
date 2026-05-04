"""Auth dependencies for protected FastAPI endpoints.

Every protected route depends on `get_current_user`. Admin-only routes
depend on `require_admin`, which extends `get_current_user` with a
custom-claim check.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, Header, Request, status
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
