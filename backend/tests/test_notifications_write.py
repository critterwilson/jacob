"""Tests for `POST /api/users/me/notifications/{nid}/read` (M4)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.users import router as users_router


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
    app.include_router(users_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _build_db(
    *, exists: bool = True, read_at: datetime | None = None
) -> tuple[MagicMock, MagicMock]:
    db = MagicMock()
    initial_snap = MagicMock()
    initial_snap.id = "n1"
    initial_snap.exists = exists
    initial_data = {
        "kind": "mention",
        "createdAt": datetime(2026, 5, 1, tzinfo=UTC),
        "readAt": read_at,
        "payload": {"messageRef": "groups/g1/messages/m1"},
    }
    initial_snap.to_dict.return_value = initial_data

    fresh_snap = MagicMock()
    fresh_snap.id = "n1"
    fresh_data = dict(initial_data)
    fresh_data["readAt"] = datetime.now(UTC)
    fresh_snap.to_dict.return_value = fresh_data

    ref = MagicMock()
    ref.get.side_effect = [initial_snap, fresh_snap]
    users_col = db.collection.return_value
    notifs = users_col.document.return_value.collection.return_value
    notifs.document.return_value = ref
    return db, ref


def test_mark_notification_read_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, ref = _build_db(read_at=None)
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/users/me/notifications/n1/read")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "n1"
    assert body["readAt"] is not None
    ref.update.assert_called_once()


def test_mark_notification_read_idempotent_on_already_read() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    already = datetime(2026, 5, 2, tzinfo=UTC)
    db, ref = _build_db(read_at=already)
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/users/me/notifications/n1/read")
    assert res.status_code == 200
    ref.update.assert_not_called()


def test_mark_notification_read_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(exists=False)
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/users/me/notifications/n1/read")
    assert res.status_code == 404


def test_mark_notification_read_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.post("/api/users/me/notifications/n1/read")
    assert res.status_code == 401
