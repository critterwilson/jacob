"""Tests for the Sentry integration service."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from sentry_sdk.types import Event

from app.services.sentry import _before_send, init_sentry

# ── PII scrubbing ────────────────────────────────────────────────────────────


def test_before_send_scrubs_email_from_exception_value() -> None:
    event: Event = {
        "exception": {
            "values": [{"value": "Token verification failed for user@example.com"}]
        }
    }
    result = _before_send(event, {})
    assert result is not None
    assert "user@example.com" not in result["exception"]["values"][0]["value"]
    assert "[email]" in result["exception"]["values"][0]["value"]


def test_before_send_strips_request_body() -> None:
    event: Event = {
        "request": {"data": '{"body": "private message text"}', "url": "/api/foo"}
    }
    result = _before_send(event, {})
    assert result is not None
    assert "data" not in result["request"]
    assert result["request"]["url"] == "/api/foo"


def test_before_send_strips_authorization_header() -> None:
    event: Event = {
        "request": {
            "headers": {
                "authorization": "Bearer secret-token",
                "content-type": "application/json",
            }
        }
    }
    result = _before_send(event, {})
    assert result is not None
    assert "authorization" not in result["request"]["headers"]
    assert "content-type" in result["request"]["headers"]


def test_before_send_strips_cookies() -> None:
    event: Event = {
        "request": {"cookies": {"session": "abc123"}, "url": "/"}
    }
    result = _before_send(event, {})
    assert result is not None
    assert "cookies" not in result["request"]


def test_before_send_returns_event_unchanged_when_no_pii() -> None:
    event: Event = {
        "exception": {"values": [{"value": "Connection timed out"}]},
        "request": {"url": "/health", "headers": {"content-type": "application/json"}},
    }
    result = _before_send(event, {})
    assert result is not None
    assert result["exception"]["values"][0]["value"] == "Connection timed out"


# ── init_sentry ──────────────────────────────────────────────────────────────


def test_init_sentry_skips_when_no_dsn() -> None:
    with patch("app.services.sentry.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(sentry_dsn="")
        with patch("sentry_sdk.init") as mock_init:
            init_sentry()
            mock_init.assert_not_called()


def test_init_sentry_calls_sdk_init_with_dsn() -> None:
    with patch("app.services.sentry.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            sentry_dsn="https://abc@sentry.io/1",
            sentry_environment="test",
            sentry_traces_sample_rate=0.0,
        )
        with patch("sentry_sdk.init") as mock_init:
            init_sentry()
            mock_init.assert_called_once()
            call_kwargs = mock_init.call_args.kwargs
            assert call_kwargs["dsn"] == "https://abc@sentry.io/1"
            assert call_kwargs["send_default_pii"] is False
            assert call_kwargs["before_send"] is _before_send
