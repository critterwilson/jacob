"""Sentry error-reporting integration.

PII scrubbing rules applied via `before_send`:
- Email addresses in exception values are replaced with "[email]".
- Request body (`data`), cookies, and the `Authorization`/`Cookie` headers
  are stripped so message bodies and tokens never reach Sentry.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.types import Event, Hint

from app.config import get_settings

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-.]+")


def _before_send(event: Event, hint: Hint) -> Event | None:
    # Scrub email addresses that may appear in exception messages
    for exc in (event.get("exception") or {}).get("values", []):
        if exc.get("value"):
            exc["value"] = _EMAIL_RE.sub("[email]", exc["value"])

    # Strip request body and sensitive headers
    req: dict[str, Any] = event.get("request") or {}
    req.pop("data", None)
    req.pop("cookies", None)
    headers: dict[str, Any] = req.get("headers") or {}
    for key in list(headers):
        if key.lower() in {"authorization", "cookie"}:
            del headers[key]

    return event


def init_sentry() -> None:
    settings = get_settings()
    if not settings.sentry_dsn:
        logger.info("Sentry DSN not configured — skipping initialisation")
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
        ],
        before_send=_before_send,
        send_default_pii=False,
    )
    logger.info("Sentry initialised for environment '%s'", settings.sentry_environment)
