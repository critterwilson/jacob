"""slowapi Limiter shared across all rate-limited endpoints.

Key function: prefer the authenticated user's UID (set on request.state by
get_current_user), fall back to the client IP for unauthenticated routes.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _key_by_uid_or_ip(request: Request) -> str:
    uid: str | None = getattr(request.state, "uid", None)
    return uid if uid else get_remote_address(request)


limiter = Limiter(key_func=_key_by_uid_or_ip, headers_enabled=True)
