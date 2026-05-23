"""Tests for notification preferences and notifications inbox endpoints (M2)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
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
        app.dependency_overrides[require_not_banned] = lambda: user
    return app


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


# ── notification preferences ──────────────────────────────────────────────


def _prefs_db(*, exists: bool, data: dict | None = None) -> MagicMock:
    db = MagicMock()
    snap = MagicMock()
    snap.exists = exists
    snap.to_dict.return_value = data or {}
    ref = MagicMock()
    ref.get.return_value = snap
    users_col = db.collection.return_value
    users_col.document.return_value.collection.return_value.document.return_value = ref
    db._prefs_ref = ref  # type: ignore[attr-defined]
    return db


def test_get_notification_prefs_returns_defaults_when_no_doc() -> None:
    db = _prefs_db(exists=False)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/notification-prefs")
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "mentions": True,
        "replies": True,
        "announcements": True,
        "digest": True,
        "ministryFeed": False,
        "groupMessages": True,
        "schemaVersion": 1,
    }


def test_get_notification_prefs_returns_stored_values() -> None:
    db = _prefs_db(
        exists=True,
        data={
            "mentions": False,
            "replies": True,
            "announcements": False,
            "digest": True,
            "schemaVersion": 1,
        },
    )
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/notification-prefs")
    body = res.json()
    assert body["mentions"] is False
    assert body["announcements"] is False


def test_put_notification_prefs_overwrites_doc() -> None:
    db = _prefs_db(exists=True, data={})
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.put(
            "/api/users/me/notification-prefs",
            json={
                "mentions": False,
                "replies": False,
                "announcements": False,
                "digest": False,
                "schemaVersion": 1,
            },
        )
    assert res.status_code == 200
    db._prefs_ref.set.assert_called_once_with(
        {
            "mentions": False,
            "replies": False,
            "announcements": False,
            "digest": False,
            "ministryFeed": False,
            "groupMessages": True,
            "schemaVersion": 1,
        }
    )


def test_put_notification_prefs_rejects_extra_keys() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(user))
    res = client.put(
        "/api/users/me/notification-prefs",
        json={
            "mentions": True,
            "replies": True,
            "announcements": True,
            "digest": True,
            "schemaVersion": 1,
            "stranger": "danger",
        },
    )
    assert res.status_code == 422


def test_get_notification_prefs_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/users/me/notification-prefs")
    assert res.status_code == 401


# ── notifications inbox ──────────────────────────────────────────────────


def _notifications_db(snaps: list[MagicMock]) -> MagicMock:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value = col

    base_query = MagicMock()
    col.order_by.return_value = base_query
    base_query.where.return_value = base_query
    base_query.start_after.return_value = base_query
    base_query.limit.return_value = base_query
    base_query.stream.return_value = iter(snaps)
    db._base_query = base_query  # type: ignore[attr-defined]
    return db


def _notif_snap(
    nid: str, kind: str, when: datetime, *, read_at: datetime | None = None
) -> MagicMock:
    snap = MagicMock()
    snap.id = nid
    snap.exists = True
    snap.to_dict.return_value = {
        "kind": kind,
        "createdAt": when,
        "readAt": read_at,
        "payload": {"foo": "bar"},
    }
    return snap


def test_list_notifications_returns_items() -> None:
    snaps = [
        _notif_snap("n1", "mention", datetime(2026, 5, 1, 12, 0, tzinfo=UTC)),
        _notif_snap("n2", "reply", datetime(2026, 5, 1, 11, 0, tzinfo=UTC)),
    ]
    db = _notifications_db(snaps)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/notifications")

    assert res.status_code == 200
    body = res.json()
    assert [n["id"] for n in body["items"]] == ["n1", "n2"]
    assert body["nextCursor"] is None


def test_list_notifications_emits_next_cursor_when_overflow() -> None:
    # 3 returned with limit=2 → has_more, nextCursor populated.
    snaps = [
        _notif_snap("n1", "mention", datetime(2026, 5, 1, 12, 0, tzinfo=UTC)),
        _notif_snap("n2", "reply", datetime(2026, 5, 1, 11, 0, tzinfo=UTC)),
        _notif_snap("n3", "announcement", datetime(2026, 5, 1, 10, 0, tzinfo=UTC)),
    ]
    db = _notifications_db(snaps)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/notifications?limit=2")

    body = res.json()
    assert len(body["items"]) == 2
    assert body["nextCursor"] is not None
    # base_query.limit was called with limit + 1 (= 3) so the handler can
    # detect the overflow.
    db._base_query.limit.assert_called_once_with(3)


def test_list_notifications_unread_only_filter_passed_to_query() -> None:
    db = _notifications_db([])
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        client.get("/api/users/me/notifications?unreadOnly=true")
    db._base_query.where.assert_called_once_with("readAt", "==", None)


def test_list_notifications_400_on_bad_cursor() -> None:
    user = CurrentUser(uid="alice", claims={})
    db = _notifications_db([])
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/notifications?cursor=not-base64!")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_cursor"


def test_list_notifications_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/users/me/notifications")
    assert res.status_code == 401
