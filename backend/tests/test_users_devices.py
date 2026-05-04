"""Tests for FCM device registration endpoints (M2)."""

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


def _app(user: CurrentUser | None = None) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.state.limiter = limiter
    app.include_router(users_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _device_db(*, existing_token: str | None = None) -> MagicMock:
    """Build a db where `existing_token` (if any) appears in the devices subcollection."""
    db = MagicMock()
    user_ref = MagicMock()
    devices_col = MagicMock()
    user_ref.collection.return_value = devices_col

    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db.collection.return_value = users_col

    if existing_token is not None:
        snap = MagicMock()
        snap.id = "dup-device"
        snap.exists = True
        snap.reference = MagicMock()
        snap.to_dict.return_value = {
            "fcmToken": existing_token,
            "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
        }
        devices_col.where.return_value.limit.return_value.stream.return_value = iter([snap])
        db._existing_snap = snap  # type: ignore[attr-defined]
    else:
        devices_col.where.return_value.limit.return_value.stream.return_value = iter([])

    db._devices_col = devices_col  # type: ignore[attr-defined]
    return db


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


def test_register_device_creates_new_doc() -> None:
    db = _device_db()
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={
                "fcmToken": "abc123",
                "platform": "web",
                "userAgent": "Mozilla/5.0",
                "appVersion": "1.0.0",
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert "deviceId" in body
    assert "registeredAt" in body
    db._devices_col.document.assert_called_once()
    doc_id = db._devices_col.document.call_args[0][0]
    assert doc_id == body["deviceId"]
    set_call = db._devices_col.document.return_value.set.call_args[0][0]
    assert set_call["fcmToken"] == "abc123"
    assert set_call["platform"] == "web"
    assert set_call["userAgent"] == "Mozilla/5.0"
    assert set_call["appVersion"] == "1.0.0"


def test_register_device_dedupes_existing_token() -> None:
    db = _device_db(existing_token="abc123")
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={"fcmToken": "abc123", "platform": "web", "userAgent": "x"},
        )

    assert res.status_code == 201
    body = res.json()
    # Returns the *existing* deviceId, not a fresh hash.
    assert body["deviceId"] == "dup-device"
    # Updated lastSeenAt on the existing doc rather than creating new.
    db._existing_snap.reference.update.assert_called_once()
    db._devices_col.document.assert_not_called()


def test_register_device_validates_platform() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(user))
    res = client.post(
        "/api/users/me/devices",
        json={"fcmToken": "abc", "platform": "windows", "userAgent": "x"},
    )
    assert res.status_code == 422


def test_register_device_validates_token_length() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(user))
    res = client.post(
        "/api/users/me/devices",
        json={"fcmToken": "x" * 4097, "platform": "web", "userAgent": "x"},
    )
    assert res.status_code == 422


def test_register_device_rejects_extra_keys() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(user))
    res = client.post(
        "/api/users/me/devices",
        json={
            "fcmToken": "abc",
            "platform": "web",
            "userAgent": "x",
            "thisFieldIsNotAllowed": True,
        },
    )
    assert res.status_code == 422


def test_register_device_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.post(
        "/api/users/me/devices",
        json={"fcmToken": "abc", "platform": "web", "userAgent": "x"},
    )
    assert res.status_code == 401


def test_delete_device_204_on_success() -> None:
    db = MagicMock()
    user_ref = MagicMock()
    devices_col = MagicMock()
    device_ref = MagicMock()
    snap = MagicMock()
    snap.exists = True
    device_ref.get.return_value = snap
    devices_col.document.return_value = device_ref
    user_ref.collection.return_value = devices_col
    db.collection.return_value.document.return_value = user_ref

    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.delete("/api/users/me/devices/dev-1")

    assert res.status_code == 204
    device_ref.delete.assert_called_once()


def test_delete_device_404_when_missing() -> None:
    db = MagicMock()
    user_ref = MagicMock()
    devices_col = MagicMock()
    device_ref = MagicMock()
    snap = MagicMock()
    snap.exists = False
    device_ref.get.return_value = snap
    devices_col.document.return_value = device_ref
    user_ref.collection.return_value = devices_col
    db.collection.return_value.document.return_value = user_ref

    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.delete("/api/users/me/devices/dev-1")

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "device_not_found"
    device_ref.delete.assert_not_called()


# ── 403 banned coverage (PR1 sweep) ─────────────────────────────────────────


def test_register_device_403_banned() -> None:
    from tests.conftest import banned_db

    user = CurrentUser(uid="alice", claims={})
    with patch("app.deps.get_firestore", return_value=banned_db()):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={"fcmToken": "x" * 60, "platform": "ios"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"
