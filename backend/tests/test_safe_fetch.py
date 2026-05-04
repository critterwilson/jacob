"""Tests for the SSRF-guarded fetcher (T53 P11)."""

from __future__ import annotations

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
    import socket

    with patch("app.services.safe_fetch.socket.getaddrinfo") as mock_dns:
        mock_dns.side_effect = socket.gaierror("nope")
        with pytest.raises(sf.SafeFetchError) as exc_info:
            sf.safe_fetch("https://does-not-exist.example/")
    assert exc_info.value.code == "dns_failed"
