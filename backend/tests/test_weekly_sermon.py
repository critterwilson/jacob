"""Tests for the weekly-sermon router + ISO-week helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.weekly_sermon import (
    admin_router,
    current_week_key,
    week_start_for_key,
)
from app.routers.weekly_sermon import (
    router as weekly_router,
)


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


def _app(user: CurrentUser | None = None) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(  # type: ignore[arg-type]
        RequestValidationError, validation_exception_handler
    )
    app.state.limiter = limiter
    app.include_router(weekly_router)
    app.include_router(admin_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
        # The owner write gate composes require_not_banned, which reads the
        # `bans` collection via get_firestore(); override it so unit tests
        # don't depend on the emulator for the ban check.
        app.dependency_overrides[require_not_banned] = lambda: user
    return app


def _sermon_doc(*, week_key: str = "2026-W22") -> dict[str, Any]:
    return {
        "weekKey": week_key,
        "weekStart": "2026-05-25",
        "videoUrl": "https://youtu.be/abc123",
        "title": "Abiding in the Vine",
        "description": "Reflect on John 15.",
        "postedAt": datetime.now(UTC),
        "postedBy": "owner",
    }


def _build_db(
    *,
    current_exists: bool = True,
    recent: list[dict[str, Any]] | None = None,
) -> tuple[MagicMock, MagicMock]:
    """Mock the `weekly_sermons` collection.

    `current_exists` controls whether `document(<current week>).get()`
    resolves; `recent` seeds the most-recent fallback query.
    """
    db = MagicMock()

    doc_snap = MagicMock()
    doc_snap.exists = current_exists
    doc_snap.id = current_week_key()
    doc_snap.to_dict.return_value = _sermon_doc(week_key=current_week_key())

    doc_ref = MagicMock()
    doc_ref.get.return_value = doc_snap

    recent_snaps: list[MagicMock] = []
    for data in recent or []:
        s = MagicMock()
        s.id = data["weekKey"]
        s.exists = True
        s.to_dict.return_value = data
        recent_snaps.append(s)

    query = MagicMock()
    query.order_by.return_value = query
    query.limit.return_value = query
    query.stream.return_value = iter(recent_snaps)

    col = MagicMock()
    col.document.return_value = doc_ref
    col.order_by.return_value = query

    def _coll(name: str) -> MagicMock:
        if name == "weekly_sermons":
            return col
        return MagicMock()

    db.collection.side_effect = _coll
    return db, doc_ref


# ── helpers ───────────────────────────────────────────────────────────────


def test_current_week_key_format() -> None:
    key = current_week_key(datetime(2026, 5, 29, tzinfo=UTC))
    assert key == "2026-W22"


def test_week_start_is_monday_of_iso_week() -> None:
    # 2026-W22 begins Monday 2026-05-25.
    assert week_start_for_key("2026-W22") == "2026-05-25"


def test_week_start_returns_none_on_garbage() -> None:
    assert week_start_for_key("not-a-week") is None


# ── read ──────────────────────────────────────────────────────────────────


def test_get_returns_current_week_sermon() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(current_exists=True)
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).get("/api/weekly-sermon")
    assert res.status_code == 200, res.text
    sermon = res.json()["sermon"]
    assert sermon["weekKey"] == current_week_key()
    assert sermon["videoUrl"] == "https://youtu.be/abc123"
    assert res.headers.get("ETag")


def test_get_falls_back_to_most_recent_when_week_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(
        current_exists=False,
        recent=[_sermon_doc(week_key="2026-W20")],
    )
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).get("/api/weekly-sermon")
    assert res.status_code == 200, res.text
    assert res.json()["sermon"]["weekKey"] == "2026-W20"


def test_get_returns_null_when_no_sermons_exist() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(current_exists=False, recent=[])
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).get("/api/weekly-sermon")
    assert res.status_code == 200, res.text
    assert res.json()["sermon"] is None


def test_get_returns_304_on_matching_etag() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(current_exists=True)
    with patch("app.routers.weekly_sermon._db", return_value=db):
        client = TestClient(_app(user))
        first = client.get("/api/weekly-sermon")
        etag = first.headers["ETag"]
        second = client.get("/api/weekly-sermon", headers={"If-None-Match": etag})
    assert second.status_code == 304


# ── owner write gate ────────────────────────────────────────────────────────


def test_publish_requires_ministry_owner_claim() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db()
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={"videoUrl": "https://youtu.be/abc123", "title": "Hi"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_publish_admin_is_not_implicitly_owner() -> None:
    user = CurrentUser(uid="alice", email=None, claims={"admin": True})
    db, _ = _build_db()
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={"videoUrl": "https://youtu.be/abc123", "title": "Hi"},
        )
    assert res.status_code == 403


def test_owner_claim_must_be_strict_true() -> None:
    user = CurrentUser(uid="alice", email=None, claims={"ministry_owner": 1})
    db, _ = _build_db()
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={"videoUrl": "https://youtu.be/abc123", "title": "Hi"},
        )
    assert res.status_code == 403


# ── owner publish / patch ────────────────────────────────────────────────────


def test_publish_happy_path_defaults_to_current_week() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, doc_ref = _build_db()
    with (
        patch("app.routers.weekly_sermon._db", return_value=db),
        patch("app.routers.weekly_sermon.write_audit_log"),
    ):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={
                "videoUrl": "https://youtu.be/abc123",
                "title": "Abiding in the Vine",
                "description": "Reflect on John 15.",
            },
        )
    assert res.status_code == 201, res.text
    # The doc was written under the current ISO-week id.
    args, _ = doc_ref.set.call_args
    written = args[0]
    assert written["weekKey"] == current_week_key()
    assert written["videoUrl"] == "https://youtu.be/abc123"
    assert written["postedBy"] == "owner"


def test_publish_rejects_unknown_field() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db()
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={"videoUrl": "https://youtu.be/x", "title": "Hi", "rogue": "no"},
        )
    assert res.status_code == 422


def test_publish_rejects_bad_week_key() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db()
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).post(
            "/api/admin/weekly-sermon",
            json={"videoUrl": "https://youtu.be/x", "title": "Hi", "weekKey": "2026-22"},
        )
    assert res.status_code == 422


def test_patch_404_when_week_missing() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db(current_exists=False)
    with patch("app.routers.weekly_sermon._db", return_value=db):
        res = TestClient(_app(user)).patch(
            "/api/admin/weekly-sermon",
            json={"title": "New title"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "weekly_sermon_not_found"


def test_patch_updates_only_supplied_fields() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, doc_ref = _build_db(current_exists=True)
    with (
        patch("app.routers.weekly_sermon._db", return_value=db),
        patch("app.routers.weekly_sermon.write_audit_log"),
    ):
        res = TestClient(_app(user)).patch(
            "/api/admin/weekly-sermon",
            json={"title": "Updated title"},
        )
    assert res.status_code == 200, res.text
    args, _ = doc_ref.update.call_args
    payload = args[0]
    assert payload["title"] == "Updated title"
    assert "videoUrl" not in payload
