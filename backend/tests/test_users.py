"""Tests for the users router's mutes/blocks reads and require_not_banned dep (M2)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.users import router as users_router


def _app(user: CurrentUser | None = None) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.state.limiter = limiter
    app.include_router(users_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


def _list_db(ids: list[str]) -> MagicMock:
    db = MagicMock()
    col = MagicMock()
    snaps = [MagicMock(id=i) for i in ids]
    col.stream.return_value = iter(snaps)
    db.collection.return_value.document.return_value.collection.return_value = col
    return db


# ── mutes / blocks reads ──────────────────────────────────────────────────


def test_list_mutes_returns_uid_list() -> None:
    db = _list_db(["bob", "carol"])
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/mutes")
    assert res.status_code == 200
    assert res.json() == {"mutedUids": ["bob", "carol"]}


def test_list_mutes_empty_when_no_docs() -> None:
    db = _list_db([])
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/mutes")
    assert res.json() == {"mutedUids": []}


def test_list_mutes_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/users/me/mutes")
    assert res.status_code == 401


def test_list_blocks_returns_uid_list() -> None:
    db = _list_db(["bob", "dave"])
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/blocks")
    assert res.status_code == 200
    assert res.json() == {"blockedUids": ["bob", "dave"]}


def test_list_blocks_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/users/me/blocks")
    assert res.status_code == 401


# ── require_not_banned dep behaviour ──────────────────────────────────────


def _bans_db(*, exists: bool, expires: datetime | None = None) -> MagicMock:
    db = MagicMock()
    snap = MagicMock()
    snap.exists = exists
    if exists:
        snap.to_dict.return_value = {"expiresAt": expires} if expires is not None else {}
    db.collection.return_value.document.return_value.get.return_value = snap
    return db


def _bans_app(user: CurrentUser) -> FastAPI:
    """Tiny app that wires require_not_banned to a probe endpoint."""
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_current_user] = lambda: user

    @app.get("/probe")
    def probe(u: CurrentUser = Depends(require_not_banned)) -> dict[str, str]:
        return {"uid": u.uid}

    return app


def test_require_not_banned_allows_unbanned() -> None:
    db = _bans_db(exists=False)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.deps.get_firestore", return_value=db):
        res = TestClient(_bans_app(user)).get("/probe")
    assert res.status_code == 200
    assert res.json() == {"uid": "alice"}


def test_require_not_banned_rejects_active_ban() -> None:
    db = _bans_db(exists=True, expires=datetime(9999, 1, 1, tzinfo=UTC))
    user = CurrentUser(uid="alice", claims={})
    with patch("app.deps.get_firestore", return_value=db):
        res = TestClient(_bans_app(user)).get("/probe")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"
    assert "expiresAt" in res.json()["error"]["details"]


def test_require_not_banned_passes_expired_ban() -> None:
    """An expired ban should not block — `expiresAt` is in the past."""
    db = _bans_db(exists=True, expires=datetime(2000, 1, 1, tzinfo=UTC))
    user = CurrentUser(uid="alice", claims={})
    with patch("app.deps.get_firestore", return_value=db):
        res = TestClient(_bans_app(user)).get("/probe")
    assert res.status_code == 200


def test_require_not_banned_handles_missing_expires_field() -> None:
    """A bans/{uid} doc with no expiresAt is treated as not-active."""
    db = _bans_db(exists=True, expires=None)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.deps.get_firestore", return_value=db):
        res = TestClient(_bans_app(user)).get("/probe")
    assert res.status_code == 200
