"""Tests for the T53 unfurl service + endpoint."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.unfurl import router
from app.services import safe_fetch as sf
from app.services import unfurl as unfurl_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1") -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})


def _app(*, user: CurrentUser) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return app


# ── parse_og_metadata ───────────────────────────────────────────────────────


def test_parse_og_pulls_title_description_image() -> None:
    html = """
    <html><head>
      <meta property="og:title" content="The Title">
      <meta property="og:description" content="A description">
      <meta property="og:image" content="https://example.com/img.jpg">
      <meta property="og:site_name" content="Example">
    </head></html>
    """
    result = unfurl_service.parse_og_metadata(html)
    assert result["title"] == "The Title"
    assert result["description"] == "A description"
    assert result["imageUrl"] == "https://example.com/img.jpg"
    assert result["siteName"] == "Example"


def test_parse_og_falls_back_to_title_tag() -> None:
    html = "<html><head><title>Just a title</title></head></html>"
    result = unfurl_service.parse_og_metadata(html)
    assert result["title"] == "Just a title"


def test_parse_og_falls_back_to_meta_description() -> None:
    html = '<html><head><meta name="description" content="The desc"></head></html>'
    result = unfurl_service.parse_og_metadata(html)
    assert result["description"] == "The desc"


def test_parse_og_handles_html_entities() -> None:
    html = '<meta property="og:title" content="Title &amp; subtitle">'
    result = unfurl_service.parse_og_metadata(html)
    assert result["title"] == "Title & subtitle"


def test_parse_og_returns_none_for_empty_input() -> None:
    result = unfurl_service.parse_og_metadata("")
    assert result == {
        "title": None,
        "description": None,
        "imageUrl": None,
        "siteName": None,
    }


# ── unfurl service: cache + fetcher ─────────────────────────────────────────


def test_unfurl_hits_cache_when_fresh() -> None:
    fs = FakeFirestore()
    key = unfurl_service.url_hash("https://example.com")
    fs._doc_set(
        f"unfurl_cache/{key}",
        {
            "urlHash": key,
            "title": "Cached title",
            "description": None,
            "imageUrl": None,
            "siteName": None,
            "fetchedAt": datetime.now(UTC),
            "expiresAt": datetime.now(UTC) + timedelta(hours=1),
        },
    )

    def boom(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("safe_fetch should not be called on cache hit")

    result = unfurl_service.unfurl("https://example.com", db=fs, fetcher=boom)
    assert result["title"] == "Cached title"


def test_unfurl_re_fetches_when_cache_expired() -> None:
    fs = FakeFirestore()
    key = unfurl_service.url_hash("https://example.com")
    fs._doc_set(
        f"unfurl_cache/{key}",
        {
            "title": "Stale",
            "description": None,
            "imageUrl": None,
            "siteName": None,
            "fetchedAt": datetime.now(UTC) - timedelta(days=2),
            "expiresAt": datetime.now(UTC) - timedelta(days=1),
        },
    )

    fresh_html = b'<html><head><meta property="og:title" content="Fresh"></head></html>'

    def fake_fetcher(_url: str) -> Any:
        return 200, fresh_html, "text/html; charset=utf-8", "https://example.com"

    result = unfurl_service.unfurl("https://example.com", db=fs, fetcher=fake_fetcher)
    assert result["title"] == "Fresh"
    # Cache replaced
    assert fs._doc_get(f"unfurl_cache/{key}")["title"] == "Fresh"


def test_unfurl_returns_empty_record_on_safe_fetch_error() -> None:
    fs = FakeFirestore()

    def fake_fetcher(_url: str) -> Any:
        raise sf.SafeFetchError("private_address", "blocked")

    result = unfurl_service.unfurl(
        "https://internal.example/",
        db=fs,
        fetcher=fake_fetcher,
    )
    assert result == {
        "title": None,
        "description": None,
        "imageUrl": None,
        "siteName": None,
    }


def test_unfurl_returns_empty_for_non_html_response() -> None:
    fs = FakeFirestore()

    def fake_fetcher(_url: str) -> Any:
        return 200, b"%PDF-1.4...", "application/pdf", "https://example.com/x.pdf"

    result = unfurl_service.unfurl("https://example.com/x.pdf", db=fs, fetcher=fake_fetcher)
    assert result["title"] is None


# ── /api/unfurl endpoint ────────────────────────────────────────────────────


def test_endpoint_returns_metadata() -> None:
    fs = FakeFirestore()

    def fake_fetcher(_url: str) -> Any:
        html = (
            b'<html><head><meta property="og:title" content="Hello">'
            b'<meta property="og:image" content="https://example.com/i.jpg">'
            b"</head></html>"
        )
        return 200, html, "text/html", "https://example.com"

    user = _user()
    with (
        patch("app.routers.unfurl._db", return_value=fs),
        patch("app.services.unfurl.sf.safe_fetch", side_effect=fake_fetcher),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/unfurl",
            json={"url": "https://example.com"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Hello"
    assert body["imageUrl"] == "https://example.com/i.jpg"


def test_endpoint_returns_blank_card_on_blocked_fetch() -> None:
    fs = FakeFirestore()

    def boom(_url: str) -> Any:
        raise sf.SafeFetchError("private_address", "blocked")

    user = _user()
    with (
        patch("app.routers.unfurl._db", return_value=fs),
        patch("app.services.unfurl.sf.safe_fetch", side_effect=boom),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/unfurl",
            json={"url": "http://169.254.169.254/latest/"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] is None
    assert body["url"] == "http://169.254.169.254/latest/"


def test_endpoint_rejects_invalid_url() -> None:
    user = _user()
    res = TestClient(_app(user=user)).post(
        "/api/unfurl",
        json={"url": "not a url"},
    )
    assert res.status_code == 422
