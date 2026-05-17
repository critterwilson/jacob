"""slowapi Limiter shared across all rate-limited endpoints.

Key function: prefer the authenticated user's UID (set on request.state by
get_current_user), fall back to the originating client IP for
unauthenticated routes.

Client-IP extraction is **position-based, not content-based**. Cloud Run
sits behind a Google HTTPS load balancer that appends exactly two entries
to X-Forwarded-For — `<client-IP-as-seen-by-the-LB>, <LB-forwarding-rule-IP>`
— regardless of what the caller supplied. The LB-attested client IP is
therefore the second-to-last entry; anything before is attacker-controlled
and a caller rotating a fresh leftmost value per request would otherwise
trivially bypass per-IP limits.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _client_ip(request: Request) -> str:
    """Return the GCP-LB-attested client IP, or the direct peer.

    GCP HTTPS LB always appends `<client>, <LB>` to X-Forwarded-For, so
    the trusted value is the second-to-last entry. When XFF is missing
    or has fewer than two entries (local dev, unit tests), fall back to
    the direct peer.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if len(parts) >= 2:
            return parts[-2]
        if len(parts) == 1:
            return parts[0]
    return get_remote_address(request)


def _key_by_uid_or_ip(request: Request) -> str:
    uid: str | None = getattr(request.state, "uid", None)
    return uid if uid else _client_ip(request)


limiter = Limiter(key_func=_key_by_uid_or_ip, headers_enabled=True)
