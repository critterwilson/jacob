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
3. **DNS pinning at connect time.** The validated IPs from step 2 are
   pinned via a scoped `socket.getaddrinfo` override for the duration
   of the httpx call, so a flapping DNS record cannot rebind to a
   private address between pre-check and connect (DNS rebinding TOCTOU).
4. **Redirects disabled.** A 30x response surfaces as `redirect_blocked`.
   The caller can re-enter with the new URL after re-validating.
5. **Response size cap.** Streamed read aborts when the body exceeds
   `max_bytes` (default 5 MiB).
6. **Tight timeout.** 5 seconds default.
7. **No proxies, no client certs.** httpx defaults are explicit.

T52 (sermon oEmbed) does its own YouTube-only allowlist; T55 (DNS
verify) doesn't fetch HTTP at all. T53 is the first consumer of the
generic safe_fetch.
"""

from __future__ import annotations

import contextlib
import ipaddress
import logging
import socket
from collections.abc import Iterator
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


def _resolve_and_validate_host(
    host: str,
) -> list[tuple[int, tuple[Any, ...]]]:
    """Return safe `(family, sockaddr)` pairs for `host`, or raise.

    `host` may be an IP literal (in which case the literal is validated
    directly) or a DNS name (in which case every A/AAAA result is
    validated). The returned tuples preserve the address family + the
    full sockaddr (port slot is rewritten by the resolver shim) so the
    pinning step can hand the exact records back to httpx without
    losing IPv6 scope information.
    """
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SafeFetchError("dns_failed", f"DNS lookup failed for {host!r}") from exc

    pairs: list[tuple[int, tuple[Any, ...]]] = []
    for family, _t, _p, _c, sockaddr in infos:
        addr = str(sockaddr[0])
        if _is_private_ip(addr):
            raise SafeFetchError(
                "private_address",
                f"Refusing to fetch {host!r} — resolves to a private address",
            )
        pairs.append((family, sockaddr))

    if not pairs:
        raise SafeFetchError("dns_failed", f"No usable IPs for {host!r}")
    return pairs


@contextlib.contextmanager
def _pin_resolver(host: str, pairs: list[tuple[int, tuple[Any, ...]]]) -> Iterator[None]:
    """Pin `host` lookups to `pairs` for the duration of the `with` block.

    Closes the DNS-rebinding TOCTOU between `_resolve_and_validate_host`
    and httpx's connect: while the patch is in effect, any
    `socket.getaddrinfo` call for `host` (case-insensitive) returns only
    the pre-validated records — the OS resolver is bypassed for that
    name. Lookups for other hosts fall through to the real resolver
    unchanged, so unrelated traffic in the same process is unaffected.

    Note: the patch is process-wide while the `with` block is open. In
    practice the only window is the httpx call itself (a few seconds at
    most), and the `host` filter means concurrent requests for
    different hosts see the real resolver. A simultaneous request for
    the *same* attacker-controlled host would be pinned to the same
    validated IPs, which is the correct behavior.
    """
    real = socket.getaddrinfo
    needle = host.lower()

    def patched(
        h: Any,
        port: Any,
        family: int = 0,
        type: int = 0,
        proto: int = 0,
        flags: int = 0,
    ) -> Any:
        if isinstance(h, (bytes, bytearray)):
            h_str = h.decode("ascii", errors="replace")
        else:
            h_str = str(h) if h is not None else ""
        if h_str.lower() == needle:
            results: list[tuple[Any, Any, int, str, tuple[Any, ...]]] = []
            for fam, sockaddr in pairs:
                if family and family != fam and family != socket.AF_UNSPEC:
                    continue
                # Replace the port slot in the captured sockaddr. IPv4
                # is (host, port); IPv6 is (host, port, flowinfo, scopeid).
                new_sa: tuple[Any, ...]
                if fam == socket.AF_INET6 and len(sockaddr) >= 4:
                    new_sa = (sockaddr[0], port or 0, sockaddr[2], sockaddr[3])
                else:
                    new_sa = (sockaddr[0], port or 0)
                results.append((fam, type or socket.SOCK_STREAM, proto or 0, "", new_sa))
            if not results:
                raise socket.gaierror(
                    socket.EAI_NONAME, f"pinned resolver: no match for family {family}"
                )
            return results
        return real(h, port, family, type, proto, flags)

    socket.getaddrinfo = patched  # type: ignore[assignment]
    try:
        yield
    finally:
        socket.getaddrinfo = real


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

    # DNS pre-flight: resolve once, validate, then pin those records via
    # `_pin_resolver` so httpx's own `getaddrinfo` call inside connect
    # cannot rebind to a private address (DNS rebinding TOCTOU).
    pinned_pairs = _resolve_and_validate_host(host)

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
        with _pin_resolver(host, pinned_pairs):
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
