"""Regression tests for the CORS allowlist on /api/*.

Without an explicit CORS allowlist, browser preflights from the App
Hosting frontend domain are blocked because the FastAPI service runs on
a different host (Cloud Run). This caught us during M1 staging smoke
testing — the bundle hits the cross-origin Cloud Run URL and the browser
swallows the request before it reaches FastAPI.
"""

from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.main import app

_STAGING_ORIGIN = "https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app"
_PROD_ORIGIN = "https://jacob.app"
_DEV_ORIGIN = "http://localhost:3000"
_EVIL_ORIGIN = "https://evil.example.com"

client = TestClient(app)


def _preflight(origin: str) -> httpx.Response:
    return client.options(
        "/api/daily-verse",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )


def test_preflight_allows_staging_origin() -> None:
    r = _preflight(_STAGING_ORIGIN)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == _STAGING_ORIGIN
    methods = r.headers["access-control-allow-methods"]
    assert "GET" in methods
    headers = r.headers["access-control-allow-headers"]
    assert "Authorization" in headers
    assert r.headers["access-control-allow-credentials"] == "true"


def test_preflight_allows_production_origin() -> None:
    r = _preflight(_PROD_ORIGIN)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == _PROD_ORIGIN


def test_preflight_allows_local_dev_origin() -> None:
    r = _preflight(_DEV_ORIGIN)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == _DEV_ORIGIN


def test_preflight_rejects_unlisted_origin() -> None:
    r = _preflight(_EVIL_ORIGIN)
    assert r.headers.get("access-control-allow-origin") is None


def test_simple_request_includes_allow_origin_for_listed_origin() -> None:
    # Even without a preflight the response should still echo the allowed
    # origin back so the browser exposes the body to the script.
    r = client.get("/health", headers={"Origin": _STAGING_ORIGIN})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == _STAGING_ORIGIN


# ── PR6: env-scoped defaults (H4) ─────────────────────────────────────────


def test_cors_origins_empty_in_prod_when_env_unset() -> None:
    """Production with no CORS_ALLOWED_ORIGINS must fail closed (empty)."""
    from app.config import Settings

    s = Settings(cors_allowed_origins="", environment="production")
    assert s.cors_origins_list == []


def test_cors_origins_empty_in_staging_when_env_unset() -> None:
    from app.config import Settings

    s = Settings(cors_allowed_origins="", environment="staging")
    assert s.cors_origins_list == []


def test_cors_origins_dev_default_includes_localhost() -> None:
    """Local dev still gets the localhost shortcut so `uvicorn` works without setup."""
    from app.config import Settings

    s = Settings(cors_allowed_origins="", environment="development")
    assert s.cors_origins_list == ["http://localhost:3000"]


def test_cors_origins_explicit_overrides_default_in_any_env() -> None:
    """Setting CORS_ALLOWED_ORIGINS always wins, regardless of environment."""
    from app.config import Settings

    s = Settings(
        cors_allowed_origins="https://prod.example.com,https://other.example.com",
        environment="production",
    )
    assert s.cors_origins_list == [
        "https://prod.example.com",
        "https://other.example.com",
    ]


def test_emulator_tokens_forbidden_in_production() -> None:
    """The Settings validator must refuse a config that would let prod
    accept signature-less Firebase Auth emulator tokens.
    """
    import pytest

    from app.config import Settings

    with pytest.raises(ValueError, match="forbidden in production"):
        Settings(jacob_allow_emulator_tokens=True, environment="production")


def test_emulator_tokens_allowed_in_staging() -> None:
    from app.config import Settings

    s = Settings(jacob_allow_emulator_tokens=True, environment="staging")
    assert s.jacob_allow_emulator_tokens is True
