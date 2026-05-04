"""Tests for the stickers router (M1 of the data-layer migration)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers import stickers as stickers_router
from app.routers.stickers import router


def _app(*, authed: bool = True) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    if authed:
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            uid="alice", email="alice@example.com", claims={}
        )
    return app


def _sticker_snap(
    slug: str,
    name: str,
    audience: str = "christian",
    order: int = 1,
    color: str = "#2563EB",
) -> MagicMock:
    snap = MagicMock()
    snap.id = slug
    snap.exists = True
    snap.to_dict.return_value = {
        "slug": slug,
        "name": name,
        "audience": audience,
        "order": order,
        "color": color,
    }
    return snap


def _make_db(snaps: list[MagicMock]) -> MagicMock:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value = col

    ordered = MagicMock()
    col.order_by.return_value = ordered
    # Without audience filter, .stream() runs on the ordered query directly.
    ordered.stream.return_value = iter(snaps)
    # With audience filter, .where(...) is chained then .stream().
    filtered = MagicMock()
    ordered.where.return_value = filtered
    filtered.stream.return_value = iter(snaps)
    return db


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    stickers_router._clear_cache()
    yield
    stickers_router._clear_cache()


def test_list_stickers_happy_path() -> None:
    snaps = [
        _sticker_snap("check-in", "Check-In", order=1, color="#2563EB"),
        _sticker_snap("prayer-request", "Prayer Request", order=2, color="#7C3AED"),
    ]
    with patch("app.routers.stickers.get_firestore", return_value=_make_db(snaps)):
        client = TestClient(_app())
        res = client.get("/api/stickers", headers={"Authorization": "Bearer t"})

    assert res.status_code == 200
    body = res.json()
    assert [s["slug"] for s in body["stickers"]] == ["check-in", "prayer-request"]
    assert body["stickers"][0] == {
        "slug": "check-in",
        "name": "Check-In",
        "audience": "christian",
        "order": 1,
        "color": "#2563EB",
    }
    assert body["etag"].startswith('W/"')
    assert "ETag" in res.headers
    assert res.headers["ETag"] == body["etag"]
    assert "max-age=300" in res.headers["Cache-Control"]


def test_list_stickers_requires_auth() -> None:
    # No dependency override — get_current_user runs and rejects the missing
    # Authorization header.
    client = TestClient(_app(authed=False))
    res = client.get("/api/stickers")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_list_stickers_audience_filter_passed_to_query() -> None:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value = col
    ordered = MagicMock()
    col.order_by.return_value = ordered
    filtered = MagicMock()
    ordered.where.return_value = filtered
    filtered.stream.return_value = iter([_sticker_snap("check-in", "Check-In")])

    with patch("app.routers.stickers.get_firestore", return_value=db):
        client = TestClient(_app())
        res = client.get(
            "/api/stickers?audience=christian",
            headers={"Authorization": "Bearer t"},
        )

    assert res.status_code == 200
    ordered.where.assert_called_once_with("audience", "==", "christian")


def test_list_stickers_caches_within_ttl() -> None:
    snaps = [_sticker_snap("check-in", "Check-In")]
    db = _make_db(snaps)

    with patch("app.routers.stickers.get_firestore", return_value=db) as gf:
        client = TestClient(_app())
        client.get("/api/stickers", headers={"Authorization": "Bearer t"})
        client.get("/api/stickers", headers={"Authorization": "Bearer t"})

    # Two HTTP calls, but only one Firestore round-trip — the second hit comes
    # from the in-process cache.
    assert gf.call_count == 1


def test_list_stickers_503_on_firestore_failure() -> None:
    failing_db = MagicMock()
    failing_db.collection.side_effect = RuntimeError("firestore down")
    with patch("app.routers.stickers.get_firestore", return_value=failing_db):
        client = TestClient(_app())
        res = client.get("/api/stickers", headers={"Authorization": "Bearer t"})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "stickers_unavailable"


def test_list_stickers_skips_invalid_doc() -> None:
    bad_snap = MagicMock()
    bad_snap.id = "broken"
    bad_snap.exists = True
    bad_snap.to_dict.return_value = {
        "slug": "broken",
        "name": "Broken",
        "audience": "not-a-real-audience",
        "order": 9,
        "color": "#000000",
    }
    good = _sticker_snap("check-in", "Check-In")
    db = _make_db([bad_snap, good])
    with patch("app.routers.stickers.get_firestore", return_value=db):
        client = TestClient(_app())
        res = client.get("/api/stickers", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    slugs = [s["slug"] for s in res.json()["stickers"]]
    assert slugs == ["check-in"]
