"""Auth dependencies for protected FastAPI endpoints.

Every protected route depends on `get_current_user`. Admin-only routes
depend on `require_admin`, which extends `get_current_user` with a
custom-claim check.
"""

from __future__ import annotations

from fastapi import Depends, Header, status
from firebase_admin import auth as firebase_auth

from app.errors import APIError
from app.models.user import CurrentUser
from app.services.firebase import init_firebase_admin

_BEARER_PREFIX = "Bearer "


def _unauthenticated(message: str) -> APIError:
    return APIError(
        status_code=status.HTTP_401_UNAUTHORIZED,
        code="unauthenticated",
        message=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
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

    return CurrentUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        claims=decoded,
    )


def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.claims.get("admin") is not True:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Admin privileges required",
        )
    return user
