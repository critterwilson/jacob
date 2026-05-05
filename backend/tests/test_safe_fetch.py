"""Tests for the SSRF-guarded fetcher (T53 P11)."""

from __future__ import annotations

import socket
from unittest.mock import patch

import pytest

from app.services import safe_fetch as sf


def test_is_private_ip_loopback() -> None:
    assert sf._is_private_ip("127.0.0.1") is True


def test_is_private_ip_link_local_metadata() -> None:
    assert sf._is_private_ip("169.254.169.254") is True


def test_is_private_ip_rfc1918() -> None:
    assert sf._is_private_ip("10.0.0.1") is True
    assert sf._is_private_ip("192.168.1.1") is True
    assert sf._is_private_ip("172.16.0.1") is True


def test_is_private_ip_ipv6_loopback() -> None:
    assert sf._is_private_ip("::1") is True


def test_is_private_ip_public() -> None:
    assert sf._is_private_ip("8.8.8.8") is False
    assert sf._is_private_ip("142.250.69.206") is False  # google.com


def test_is_private_ip_invalid_string() -> None:
    # Non-IP strings are conservatively rejected.
    assert sf._is_private_ip("not-an-ip") is True


def test_safe_fetch_rejects_non_http_scheme() -> None:
    with pytest.raises(sf.SafeFetchError) as exc_info:
        sf.safe_fetch("ftp://example.com/foo")
    assert exc_info.value.code == "scheme_blocked"


def test_safe_fetch_rejects_no_host() -> None:
    with pytest.raises(sf.SafeFetchError) as exc_info:
        sf.safe_fetch("http:///path")
    assert exc_info.value.code == "no_host"


def test_safe_fetch_rejects_when_dns_returns_private_ip() -> None:
    # Patch the resolver to claim the host resolves to a private address.
    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_dns:
        # Standard getaddrinfo returns list of (family, type, proto, canon, sockaddr)
        mock_dns.return_value = [(2, 1, 0, "", ("10.0.0.5", 0))]
        with pytest.raises(sf.SafeFetchError) as exc_info:
            sf.safe_fetch("https://malicious.example.com/")
    assert exc_info.value.code == "private_address"


def test_safe_fetch_rejects_metadata_address_directly() -> None:
    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [(2, 1, 0, "", ("169.254.169.254", 0))]
        with pytest.raises(sf.SafeFetchError) as exc_info:
            sf.safe_fetch("http://169.254.169.254/latest/meta-data/")
    assert exc_info.value.code == "private_address"


def test_safe_fetch_rejects_dns_failure() -> None:
    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_dns:
        mock_dns.side_effect = socket.gaierror("nope")
        with pytest.raises(sf.SafeFetchError) as exc_info:
            sf.safe_fetch("https://does-not-exist.example/")
    assert exc_info.value.code == "dns_failed"


# --- DNS pinning: closes the rebinding TOCTOU between pre-check and connect ---


def test_pin_resolver_returns_validated_pairs_for_target_host() -> None:
    pairs = [(socket.AF_INET, ("8.8.8.8", 0))]
    with sf._pin_resolver("Example.COM", pairs):  # case-insensitive match
        results = socket.getaddrinfo("example.com", 443, type=socket.SOCK_STREAM)
    assert len(results) == 1
    family, _t, _p, _c, sockaddr = results[0]
    assert family == socket.AF_INET
    assert sockaddr[0] == "8.8.8.8"
    assert sockaddr[1] == 443  # port slot is rewritten


def test_pin_resolver_passes_through_other_hosts() -> None:
    pairs = [(socket.AF_INET, ("8.8.8.8", 0))]
    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_real:
        mock_real.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("8.8.8.8", 53))]
        # Re-import the bound `socket` inside the contextmanager body so the
        # patch on `safe_fetch.socket` is what the shim's fallback path uses.
        import app.services.safe_fetch as sf_mod

        with sf_mod._pin_resolver("attacker.example", pairs):
            # pin matches our needle for the attacker host
            pinned = socket.getaddrinfo("attacker.example", 80)
            assert pinned[0][4][0] == "8.8.8.8"
            # an UNRELATED lookup falls through to the (mocked) real resolver
            other = sf_mod.socket.getaddrinfo("dns.google", 53)
            assert other[0][4][0] == "8.8.8.8"


def test_pin_resolver_restores_real_getaddrinfo_on_exit() -> None:
    pairs = [(socket.AF_INET, ("8.8.8.8", 0))]
    original = socket.getaddrinfo
    with sf._pin_resolver("example.com", pairs):
        assert socket.getaddrinfo is not original
    assert socket.getaddrinfo is original


def test_pin_resolver_restores_even_when_block_raises() -> None:
    pairs = [(socket.AF_INET, ("8.8.8.8", 0))]
    original = socket.getaddrinfo
    with pytest.raises(RuntimeError, match="boom"):
        with sf._pin_resolver("example.com", pairs):
            raise RuntimeError("boom")
    assert socket.getaddrinfo is original


def test_safe_fetch_pins_dns_and_blocks_rebind_attempt() -> None:
    """Regression test for the DNS rebinding TOCTOU.

    Pre-check resolves to a public IP; a flapping resolver then tries to
    return a private IP at httpx connect time. The pin must override
    that second answer so the connection still targets the validated IP.
    """
    public_record = (
        socket.AF_INET,
        socket.SOCK_STREAM,
        0,
        "",
        ("8.8.8.8", 0),
    )
    private_record = (
        socket.AF_INET,
        socket.SOCK_STREAM,
        0,
        "",
        ("127.0.0.1", 0),
    )
    call_count = {"n": 0}

    def flapping(*args: object, **kwargs: object) -> list[tuple[object, ...]]:
        call_count["n"] += 1
        # First call (pre-flight) returns the public IP.
        # Second call (would happen in httpx connect) returns the private IP.
        return [public_record] if call_count["n"] == 1 else [private_record]

    observed_addresses: list[str] = []

    class _FakeResponse:
        def __init__(self, host: str) -> None:
            self.status_code = 200
            self.headers = {"content-type": "text/html"}
            self.url = f"http://{host}/"

        def iter_bytes(self) -> list[bytes]:
            return [b"<html></html>"]

    class FakeStreamCtx:
        def __init__(self, host_to_resolve: str) -> None:
            self._host = host_to_resolve

        def __enter__(self) -> _FakeResponse:
            # This is the moment httpx would call socket.getaddrinfo. Under
            # the pin, the patched resolver must return the public IP even
            # though `flapping` would otherwise return the private one.
            results = socket.getaddrinfo(self._host, 80, type=socket.SOCK_STREAM)
            observed_addresses.append(results[0][4][0])
            return _FakeResponse(self._host)

        def __exit__(self, *_: object) -> None:
            return None

    class FakeClient:
        def stream(self, method: str, url: str) -> FakeStreamCtx:
            assert method == "GET"
            host = url.split("://", 1)[1].split("/", 1)[0]
            return FakeStreamCtx(host)

        def close(self) -> None:
            pass

    with patch("app.services.safe_fetch.socket.getaddrinfo", side_effect=flapping):
        status, body, ctype, final = sf.safe_fetch("http://attacker.example/", client=FakeClient())

    assert status == 200
    assert body == b"<html></html>"
    # The connection-time resolver call MUST have seen the public IP, not
    # the rebound private one. Without `_pin_resolver`, this assertion
    # would fail (observed_addresses[0] would be "127.0.0.1").
    assert observed_addresses == ["8.8.8.8"]


def test_resolve_and_validate_host_returns_family_sockaddr_pairs() -> None:
    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("8.8.8.8", 0)),
            (
                socket.AF_INET6,
                socket.SOCK_STREAM,
                0,
                "",
                ("2001:4860:4860::8888", 0, 0, 0),
            ),
        ]
        pairs = sf._resolve_and_validate_host("example.com")
    assert len(pairs) == 2
    families = sorted(fam for fam, _ in pairs)
    assert socket.AF_INET in families
    assert socket.AF_INET6 in families
