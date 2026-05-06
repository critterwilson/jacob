"""slowapi Limiter shared across all rate-limited endpoints.

Key function: prefer the authenticated user's UID (set on request.state by
get_current_user), fall back to the originating client IP for
unauthenticated routes. Cloud Run sits behind a Google load balancer that
terminates the connection and forwards the original IP in
X-Forwarded-For; without consulting that header, every unauthenticated
request shares one bucket (the LB's IP).
"""

from __future__ import annotations

import ipaddress

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _is_internal(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved


def _client_ip(request: Request) -> str:
    """Left-most non-internal value of X-Forwarded-For; else direct peer.

    uvicorn's --proxy-headers will already rewrite request.client.host to
    the leftmost forwarded address, but we read X-Forwarded-For directly
    too: it covers paths where the proxy-headers rewrite is unavailable
    (e.g. behind a misconfigured proxy or in unit tests) and lets us skip
    intermediate private hops.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        for raw in xff.split(","):
            candidate = raw.strip()
            if candidate and not _is_internal(candidate):
                return candidate
    return get_remote_address(request)


def _key_by_uid_or_ip(request: Request) -> str:
    uid: str | None = getattr(request.state, "uid", None)
    return uid if uid else _client_ip(request)


limiter = Limiter(key_func=_key_by_uid_or_ip, headers_enabled=True)
