"""Standard API error shape.

Every error response is `{"error": {"code", "message", "details"}}`.
`APIError` raises with that shape pre-baked; the global handler in
`main.py` ensures plain `HTTPException`s and validation errors are
rendered the same way.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class APIError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail={
                "error": {
                    "code": code,
                    "message": message,
                    "details": details or {},
                }
            },
            headers=headers,
        )


async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail,
            headers=exc.headers,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "http_error",
                "message": str(exc.detail),
                "details": {},
            }
        },
        headers=exc.headers,
    )


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "validation_error",
                "message": "Request validation failed",
                "details": {"errors": exc.errors()},
            }
        },
    )


async def rate_limit_exceeded_handler(_: Request, exc: Exception) -> JSONResponse:
    """slowapi's default 429 handler returns `{"detail": "..."}` which
    breaks the `{"error": {"code","message","details"}}` contract.
    Re-shape it here, while preserving the standard `Retry-After`/
    `X-RateLimit-*` headers slowapi attaches.
    """
    detail = getattr(exc, "detail", None) or "Rate limit exceeded"
    headers = getattr(exc, "headers", None) or {}
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "error": {
                "code": "rate_limited",
                "message": str(detail),
                "details": {},
            }
        },
        headers=headers,
    )
