"""Transactional email service using SendGrid (T18).

Public helpers:
- send_email          — low-level: renders templates + sends via SendGrid
- send_moderation_notice      — user's content was actioned by a moderator
- send_deletion_confirmation  — user requested account deletion (grace window)
- send_deletion_finalized     — account has been permanently deleted

Retry behaviour: up to 3 attempts with 1 s / 2 s / 4 s back-off.
Final failure is captured by Sentry; the exception is re-raised so the
caller can decide whether to surface a 500 or swallow it (email is
never on the critical path for write operations).

If SENDGRID_API_KEY is empty (e.g. local dev without a key), sending is
skipped and a warning is logged — all other application code continues
to function normally.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import sentry_sdk
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Content, Mail, ReplyTo, To

from app.config import get_settings

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "email"

_jinja_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "j2"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

_MAX_ATTEMPTS = 3
_BACKOFF_BASE = 1.0  # seconds; doubles each retry


def _render(template_name: str, context: dict[str, Any]) -> tuple[str, str]:
    """Return (html_body, text_body) for *template_name*."""
    html = _jinja_env.get_template(f"{template_name}.html.j2").render(**context)
    text = _jinja_env.get_template(f"{template_name}.txt.j2").render(**context)
    return html, text


def send_email(
    to_email: str,
    display_name: str,
    subject: str,
    template_name: str,
    context: dict[str, Any] | None = None,
) -> None:
    """Render *template_name* and deliver via SendGrid with retry/backoff.

    Raises the last exception after _MAX_ATTEMPTS failures (and forwards
    it to Sentry).  Callers on write paths should catch and log rather
    than propagate so a transient SendGrid outage doesn't block the user.
    """
    settings = get_settings()
    if not settings.sendgrid_api_key:
        logger.warning(
            "email_skipped: SENDGRID_API_KEY not set — would have sent '%s' to %s",
            subject,
            to_email,
        )
        return

    ctx = {"display_name": display_name, **(context or {})}
    html_body, text_body = _render(template_name, ctx)

    message = Mail(
        from_email=settings.email_sender,
        to_emails=To(email=to_email, name=display_name),
        subject=subject,
    )
    message.content = [
        Content("text/plain", text_body),
        Content("text/html", html_body),
    ]
    if settings.email_reply_to:
        message.reply_to = ReplyTo(settings.email_reply_to)

    last_exc: Exception = RuntimeError("unreachable")
    for attempt in range(_MAX_ATTEMPTS):
        try:
            sg = SendGridAPIClient(settings.sendgrid_api_key)
            response = sg.send(message)
            if response.status_code < 300:
                logger.info(
                    "email_sent template=%s to=%s status=%s",
                    template_name,
                    to_email,
                    response.status_code,
                )
                return
            raise RuntimeError(f"SendGrid returned status {response.status_code}")
        except Exception as exc:
            last_exc = exc
            if attempt < _MAX_ATTEMPTS - 1:
                sleep_s = _BACKOFF_BASE * (2**attempt)
                logger.warning(
                    "email_retry attempt=%d/%d template=%s error=%s sleep=%.1fs",
                    attempt + 1,
                    _MAX_ATTEMPTS,
                    template_name,
                    exc,
                    sleep_s,
                )
                time.sleep(sleep_s)

    logger.error(
        "email_failed template=%s to=%s after %d attempts: %s",
        template_name,
        to_email,
        _MAX_ATTEMPTS,
        last_exc,
    )
    sentry_sdk.capture_exception(last_exc)
    raise last_exc


# ── convenience helpers ────────────────────────────────────────────────────────


def send_moderation_notice(
    to_email: str,
    display_name: str,
    *,
    reason: str,
    resource_type: str = "message",
) -> None:
    settings = get_settings()
    send_email(
        to_email=to_email,
        display_name=display_name,
        subject="An update on your JACOB content",
        template_name="moderation_notice",
        context={
            "reason": reason,
            "resource_type": resource_type,
            "appeal_email": settings.email_reply_to or settings.email_sender,
        },
    )


def send_deletion_confirmation(
    to_email: str,
    display_name: str,
    *,
    grace_days: int = 14,
    finalize_date: str,
) -> None:
    send_email(
        to_email=to_email,
        display_name=display_name,
        subject="Your JACOB account deletion has been scheduled",
        template_name="deletion_confirmation",
        context={
            "grace_days": grace_days,
            "finalize_date": finalize_date,
        },
    )


def send_deletion_finalized(
    to_email: str,
    display_name: str,
) -> None:
    send_email(
        to_email=to_email,
        display_name=display_name,
        subject="Your JACOB account has been deleted",
        template_name="deletion_finalized",
        context={},
    )
