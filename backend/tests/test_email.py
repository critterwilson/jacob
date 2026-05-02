"""Tests for the transactional email service (T18).

SendGridAPIClient and sentry_sdk are mocked at the call site so no real
network calls occur.  time.sleep is patched to keep tests fast.

Coverage:
- successful send returns without raising
- 5xx response triggers retry; succeeds on second attempt
- all three attempts fail → Sentry capture + re-raise
- no-op when SENDGRID_API_KEY is empty (dev mode)
- each named template (moderation_notice, deletion_confirmation,
  deletion_finalized) renders without errors
"""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from app.services import email as email_svc


def _mock_response(status: int) -> MagicMock:
    r = MagicMock()
    r.status_code = status
    return r


# ── core send_email ────────────────────────────────────────────────────────────


def test_send_email_success() -> None:
    settings = MagicMock()
    settings.sendgrid_api_key = "SG.test"
    settings.email_sender = "JACOB <noreply@example.com>"
    settings.email_reply_to = "support@example.com"

    sg_client = MagicMock()
    sg_client.send.return_value = _mock_response(202)

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.SendGridAPIClient", return_value=sg_client),
        patch("app.services.email.time.sleep") as mock_sleep,
    ):
        email_svc.send_email(
            to_email="alice@example.com",
            display_name="Alice",
            subject="Test",
            template_name="deletion_finalized",
        )

    sg_client.send.assert_called_once()
    mock_sleep.assert_not_called()


def test_send_email_retries_on_5xx_then_succeeds() -> None:
    settings = MagicMock()
    settings.sendgrid_api_key = "SG.test"
    settings.email_sender = "JACOB <noreply@example.com>"
    settings.email_reply_to = ""

    sg_client = MagicMock()
    sg_client.send.side_effect = [
        _mock_response(500),
        _mock_response(202),
    ]

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.SendGridAPIClient", return_value=sg_client),
        patch("app.services.email.time.sleep") as mock_sleep,
    ):
        email_svc.send_email(
            to_email="alice@example.com",
            display_name="Alice",
            subject="Test",
            template_name="deletion_finalized",
        )

    assert sg_client.send.call_count == 2
    mock_sleep.assert_called_once_with(1.0)


def test_send_email_all_attempts_fail_captures_sentry() -> None:
    settings = MagicMock()
    settings.sendgrid_api_key = "SG.test"
    settings.email_sender = "JACOB <noreply@example.com>"
    settings.email_reply_to = ""

    sg_client = MagicMock()
    sg_client.send.side_effect = RuntimeError("network error")

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.SendGridAPIClient", return_value=sg_client),
        patch("app.services.email.time.sleep"),
        patch("app.services.email.sentry_sdk.capture_exception") as mock_capture,
    ):
        with pytest.raises(RuntimeError, match="network error"):
            email_svc.send_email(
                to_email="alice@example.com",
                display_name="Alice",
                subject="Test",
                template_name="deletion_finalized",
            )

    assert sg_client.send.call_count == 3
    mock_capture.assert_called_once()


def test_send_email_backoff_doubles() -> None:
    """Sleep durations follow 1 s, 2 s pattern across three attempts."""
    settings = MagicMock()
    settings.sendgrid_api_key = "SG.test"
    settings.email_sender = "JACOB <noreply@example.com>"
    settings.email_reply_to = ""

    sg_client = MagicMock()
    sg_client.send.side_effect = RuntimeError("err")

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.SendGridAPIClient", return_value=sg_client),
        patch("app.services.email.time.sleep") as mock_sleep,
        patch("app.services.email.sentry_sdk.capture_exception"),
    ):
        with pytest.raises(RuntimeError):
            email_svc.send_email(
                to_email="bob@example.com",
                display_name="Bob",
                subject="X",
                template_name="deletion_finalized",
            )

    assert mock_sleep.call_args_list == [call(1.0), call(2.0)]


def test_send_email_skipped_when_no_api_key(caplog: pytest.LogCaptureFixture) -> None:
    settings = MagicMock()
    settings.sendgrid_api_key = ""

    with (
        patch("app.services.email.get_settings", return_value=settings),
        patch("app.services.email.SendGridAPIClient") as mock_sg,
    ):
        email_svc.send_email(
            to_email="alice@example.com",
            display_name="Alice",
            subject="Test",
            template_name="deletion_finalized",
        )

    mock_sg.assert_not_called()


# ── template rendering ─────────────────────────────────────────────────────────


def _render(template_name: str, ctx: dict) -> tuple[str, str]:
    return email_svc._render(template_name, {"display_name": "Test User", **ctx})


def test_moderation_notice_renders() -> None:
    html, text = _render(
        "moderation_notice",
        {"reason": "Spam", "resource_type": "message", "appeal_email": "support@example.com"},
    )
    assert "Test User" in html
    assert "Spam" in html
    assert "Test User" in text
    assert "Spam" in text


def test_deletion_confirmation_renders() -> None:
    html, text = _render(
        "deletion_confirmation",
        {"grace_days": 14, "finalize_date": "2026-05-15"},
    )
    assert "2026-05-15" in html
    assert "14" in html
    assert "2026-05-15" in text


def test_deletion_finalized_renders() -> None:
    html, text = _render("deletion_finalized", {})
    assert "Test User" in html
    assert "deleted" in html.lower()
    assert "Test User" in text


# ── convenience helpers ────────────────────────────────────────────────────────


def _patched_send_email() -> MagicMock:
    return patch("app.services.email.send_email")


def test_send_moderation_notice_calls_send_email() -> None:
    settings = MagicMock()
    settings.email_reply_to = "support@example.com"
    settings.email_sender = "JACOB <noreply@example.com>"

    with (
        patch("app.services.email.get_settings", return_value=settings),
        _patched_send_email() as mock_send,
    ):
        email_svc.send_moderation_notice(
            to_email="alice@example.com",
            display_name="Alice",
            reason="Spam",
            resource_type="message",
        )

    mock_send.assert_called_once()
    _, kwargs = mock_send.call_args
    assert kwargs["template_name"] == "moderation_notice"


def test_send_deletion_confirmation_calls_send_email() -> None:
    with _patched_send_email() as mock_send:
        email_svc.send_deletion_confirmation(
            to_email="alice@example.com",
            display_name="Alice",
            grace_days=14,
            finalize_date="2026-05-15",
        )

    mock_send.assert_called_once()
    _, kwargs = mock_send.call_args
    assert kwargs["template_name"] == "deletion_confirmation"


def test_send_deletion_finalized_calls_send_email() -> None:
    with _patched_send_email() as mock_send:
        email_svc.send_deletion_finalized(
            to_email="alice@example.com",
            display_name="Alice",
        )

    mock_send.assert_called_once()
    _, kwargs = mock_send.call_args
    assert kwargs["template_name"] == "deletion_finalized"
