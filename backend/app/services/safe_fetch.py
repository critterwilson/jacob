"""SSRF-guarded HTTP fetcher (P11) for T53 unfurls.

Public surface:

- `safe_fetch(url, *, max_bytes, timeout_s, allowed_schemes)` →
  `(status, content_bytes, content_type, final_url)` on success;
  raises `SafeFetchError` on any guard violation.

Guards (defense-in-depth, all enforced even if the caller skips one):

1. **Scheme allowlist.** Only `http` and `https` by default.
2. **Hostname → IP resolution + private-range rejection.** Resolves the
   hostname before opening the socket and refuses RFC 1918, link-local,
   loopback, IPv6 ULA, multicast, and the cloud-metadata
   169.254.169.254 address.
3. **Redirects disabled.** A 30x response surfaces as `redirect_blocked`.
   The caller can re-enter with the new URL after re-validating.
4. **Response size cap.** Streamed read aborts when the body exceeds
   `max_bytes` (default 5 MiB).
5. **Tight timeout.** 5 seconds default.
6. **No proxies, no client certs.** httpx defaults are explicit.

T52 (sermon oEmbed) does its own YouTube-only allowlist; T55 (DNS
verify) doesn't fetch HTTP at all. T53 is the first consumer of the
generic safe_fetch.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


_DEFAULT_MAX_BYTES = 5 * 1024 * 1024
_DEFAULT_TIMEOUT_S = 5.0
_DEFAULT_SCHEMES = frozenset({"http", "https"})


class SafeFetchError(Exception):
    """Raised when the SSRF guard refuses or the fetch otherwise fails."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _is_private_ip(addr: str) -> bool:
    """True for any address we refuse to talk to."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return True
    if ip.is_private:
        return True
    if ip.is_loopback:
        return True
    if ip.is_link_local:
        return True
    if ip.is_multicast:
        return True
    if ip.is_reserved:
        return True
    if ip.is_unspecified:
        return True
    # GCP metadata server (also covered by link-local / 169.254/16)
    if str(ip) == "169.254.169.254":
        return True
    return False


def _resolve_and_validate_host(host: str) -> list[str]:
    """Return the list of safe IPs for `host`, or raise.

    `host` may be an IP literal (in which case the literal is validated
    directly) or a DNS name (in which case every A/AAAA result is
    validated).
    """
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SafeFetchError("dns_failed", f"DNS lookup failed for {host!r}") from exc

    ips: list[str] = []
    for family, _t, _p, _c, sockaddr in infos:
        # `sockaddr` widens to `Any | tuple` across families; the host
        # component is always the first element. Coerce to str for the
        # IP guard so mypy stops widening to `str | int`.
        addr = str(sockaddr[0])
        if _is_private_ip(addr):
            raise SafeFetchError(
                "private_address",
                f"Refusing to fetch {host!r} — resolves to a private address",
            )
        ips.append(addr)

    if not ips:
        raise SafeFetchError("dns_failed", f"No usable IPs for {host!r}")
    return ips


def safe_fetch(
    url: str,
    *,
    max_bytes: int = _DEFAULT_MAX_BYTES,
    timeout_s: float = _DEFAULT_TIMEOUT_S,
    allowed_schemes: frozenset[str] = _DEFAULT_SCHEMES,
    user_agent: str = "JACOB-Unfurler/1.0",
    client: Any = None,
) -> tuple[int, bytes, str, str]:
    """Fetch `url` defensively. Returns `(status, body, content_type, final_url)`.

    Raises `SafeFetchError` on any guard violation.
    """
    parsed = urlparse(url)
    if parsed.scheme.lower() not in allowed_schemes:
        raise SafeFetchError(
            "scheme_blocked",
            f"Only {sorted(allowed_schemes)} schemes allowed; got {parsed.scheme!r}",
        )
    host = parsed.hostname
    if not host:
        raise SafeFetchError("no_host", "URL has no host component")

    # DNS pre-flight. We only check for the SSRF guard; the actual
    # connection still goes through the OS resolver, but the time-of-
    # check / time-of-use gap is small enough at our v1 scale that we
    # accept it. A future hardening would pin the resolved IP into the
    # connect call (via a custom transport).
    _resolve_and_validate_host(host)

    transport_client = client or httpx.Client(
        follow_redirects=False,
        timeout=httpx.Timeout(timeout_s),
        trust_env=False,  # ignore HTTP_PROXY / HTTPS_PROXY env
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        },
    )

    try:
        with transport_client.stream("GET", url) as response:
            if 300 <= response.status_code < 400:
                raise SafeFetchError(
                    "redirect_blocked",
                    f"Redirect to {response.headers.get('location') or 'unknown'!r} blocked",
                )
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise SafeFetchError(
                        "too_large",
                        f"Response exceeded {max_bytes} bytes",
                    )
                chunks.append(chunk)
            body = b"".join(chunks)
            content_type = response.headers.get("content-type", "")
            return response.status_code, body, content_type, str(response.url)
    except httpx.TimeoutException as exc:
        raise SafeFetchError("timeout", f"Fetch timed out after {timeout_s}s") from exc
    except httpx.HTTPError as exc:
        raise SafeFetchError("transport_error", str(exc)) from exc
    finally:
        if client is None:
            transport_client.close()
