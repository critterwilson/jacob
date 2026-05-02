"""Dev-only endpoints — only mounted when Settings.debug is True.

The /debug/sentry-test endpoint deliberately raises so you can verify
that Sentry captures backend exceptions with a stack trace and no PII.
Never enable in production.
"""

from __future__ import annotations

from fastapi import APIRouter

router: APIRouter = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/sentry-test")
def sentry_test() -> dict[str, str]:
    raise ValueError("Sentry integration test — this error is intentional")
