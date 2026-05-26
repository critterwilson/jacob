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
from typing import TYPE_CHECKING, Any

import sentry_sdk
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Content, Header, Mail, ReplyTo, To

if TYPE_CHECKING:
    from app.services.digest import DigestPayload

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


def _redact_email(addr: str) -> str:
    """Return a partially-redacted form of *addr* safe to write to logs.

    `alice@example.com` -> `a***@example.com`
    `a@example.com`     -> `*@example.com`
    Anything that doesn't look like an email is returned as `<redacted>`.
    """
    if not addr or "@" not in addr:
        return "<redacted>"
    local, _, domain = addr.partition("@")
    if not local or not domain:
        return "<redacted>"
    if len(local) <= 1:
        return f"*@{domain}"
    return f"{local[0]}***@{domain}"


def _render(template_name: str, context: dict[str, Any]) -> tuple[str, str]:
    """Return (html_body, text_body) for *template_name*."""
    html = _jinja_env.get_template(f"{template_name}.html.j2").render(**context)
    text = _jinja_env.get_template(f"{template_name}.txt.j2").render(**context)
    return html, text


def _send_message(message: Mail, *, label: str, to_email: str) -> None:
    """Send a pre-built Mail object with retry/backoff. Raises on final failure."""
    settings = get_settings()
    last_exc: Exception = RuntimeError("unreachable")
    for attempt in range(_MAX_ATTEMPTS):
        try:
            sg = SendGridAPIClient(settings.sendgrid_api_key)
            response = sg.send(message)
            if response.status_code < 300:
                logger.info(
                    "email_sent label=%s to=%s status=%s",
                    label,
                    _redact_email(to_email),
                    response.status_code,
                )
                return
            raise RuntimeError(f"SendGrid returned status {response.status_code}")
        except Exception as exc:
            last_exc = exc
            if attempt < _MAX_ATTEMPTS - 1:
                sleep_s = _BACKOFF_BASE * (2**attempt)
                logger.warning(
                    "email_retry attempt=%d/%d label=%s error=%s sleep=%.1fs",
                    attempt + 1,
                    _MAX_ATTEMPTS,
                    label,
                    exc,
                    sleep_s,
                )
                time.sleep(sleep_s)

    logger.error(
        "email_failed label=%s to=%s after %d attempts: %s",
        label,
        _redact_email(to_email),
        _MAX_ATTEMPTS,
        last_exc,
    )
    sentry_sdk.capture_exception(last_exc)
    raise last_exc


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
            _redact_email(to_email),
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

    _send_message(message, label=template_name, to_email=to_email)


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


def send_export_ready(
    to_email: str,
    display_name: str,
    *,
    download_url: str,
    expires_at: Any,
) -> None:
    """T38 — your data export is ready and downloadable."""
    if hasattr(expires_at, "strftime"):
        expires_str = expires_at.strftime("%B %d, %Y at %H:%M UTC")
    else:
        expires_str = str(expires_at)
    send_email(
        to_email=to_email,
        display_name=display_name,
        subject="Your JACOB data export is ready",
        template_name="export_ready",
        context={
            "download_url": download_url,
            "expires_at": expires_str,
        },
    )


def send_weekly_digest(
    to_email: str,
    payload: DigestPayload,
    unsub_token: str,
) -> None:
    """Send the weekly digest email with RFC 8058 List-Unsubscribe headers.

    Skipped silently when SENDGRID_API_KEY is not set (same as send_email).
    Raises on final failure after _MAX_ATTEMPTS retries.
    """
    settings = get_settings()
    if not settings.sendgrid_api_key:
        logger.warning(
            "email_skipped: SENDGRID_API_KEY not set — would have sent digest to %s",
            _redact_email(to_email),
        )
        return

    unsub_url = f"{settings.api_url}/api/account/unsubscribe?token={unsub_token}"
    ctx = {
        "display_name": payload.display_name,
        "app_url": settings.app_url,
        "unsubscribe_url": unsub_url,
        "top_stickers": payload.top_stickers,
        "missed_replies": payload.missed_replies,
        "new_members": payload.new_members,
        "groups": payload.groups,
        "quiet_week": payload.quiet_week,
    }
    html_body, text_body = _render("weekly_digest", ctx)

    message = Mail(
        from_email=settings.email_sender,
        to_emails=To(email=to_email, name=payload.display_name),
        subject="Your JACOB Week",
    )
    message.content = [
        Content("text/plain", text_body),
        Content("text/html", html_body),
    ]
    unsub_mailto = "mailto:unsubscribe@jacob.app?subject=unsubscribe"
    message.header = [
        Header("List-Unsubscribe", f"<{unsub_mailto}>, <{unsub_url}>"),
        Header("List-Unsubscribe-Post", "List-Unsubscribe=One-Click"),
    ]

    if settings.sendgrid_sandbox:
        from sendgrid.helpers.mail import MailSettings, SandBoxMode

        mail_settings = MailSettings()
        mail_settings.sandbox_mode = SandBoxMode(True)
        message.mail_settings = mail_settings

    _send_message(message, label="weekly_digest", to_email=to_email)
