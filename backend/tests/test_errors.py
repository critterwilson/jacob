"""Tests for the global error handlers in app.errors.

M-BACK-15: ensure the 429 (RateLimitExceeded) handler reshapes the body
to the project's `{"error": {"code","message","details"}}` contract
rather than slowapi's default `{"detail": "..."}`.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.errors import http_exception_handler, rate_limit_exceeded_handler


def test_429_handler_returns_project_error_shape() -> None:
    """When slowapi raises RateLimitExceeded the response MUST follow the
    `{"error": {"code","message","details"}}` contract, not slowapi's
    default `{"detail": "..."}` shape."""
    app = FastAPI()
    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]

    @app.get("/lim")
    @limiter.limit("1/minute")
    def lim(request: Request) -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    first = client.get("/lim")
    assert first.status_code == 200

    second = client.get("/lim")
    assert second.status_code == 429
    body = second.json()
    # The body MUST have the project error envelope, NOT `{"detail": ...}`.
    assert "detail" not in body
    assert "error" in body
    err = body["error"]
    assert err["code"] == "rate_limited"
    assert isinstance(err["message"], str) and err["message"]
    assert err["details"] == {}
