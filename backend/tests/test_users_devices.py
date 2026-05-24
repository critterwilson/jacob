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


# ── installationId dedupe (PR #345) ───────────────────────────────────────


def _installation_device_db(
    *,
    existing_install: dict[str, object] | None = None,
    legacy_orphans: list[dict[str, object]] | None = None,
) -> MagicMock:
    """Build a db where:

    * a `where("installationId", ==, ...)` query returns
      `existing_install` if provided (else empty), and
    * `where("fcmToken", ==, ...)` returns empty (we never want to
      fall back to the legacy path when installationId is supplied),
    * `devices_col.stream()` yields the legacy_orphans (docs without
      an `installationId` field — the sweep should delete these).
    """
    db = MagicMock()
    user_ref = MagicMock()
    devices_col = MagicMock()
    user_ref.collection.return_value = devices_col

    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db.collection.return_value = users_col

    def _where_side_effect(field: str, _op: str, _value: object) -> MagicMock:
        chain = MagicMock()
        if field == "installationId" and existing_install is not None:
            snap = MagicMock()
            snap.id = existing_install.get("id", "existing-install-doc")
            snap.exists = True
            snap.reference = MagicMock()
            snap.to_dict.return_value = existing_install.get("data", {})
            chain.limit.return_value.stream.return_value = iter([snap])
            db._existing_install_snap = snap  # type: ignore[attr-defined]
        else:
            chain.limit.return_value.stream.return_value = iter([])
        return chain

    devices_col.where.side_effect = _where_side_effect

    orphan_snaps: list[MagicMock] = []
    for orphan in legacy_orphans or []:
        snap = MagicMock()
        snap.id = orphan.get("id", "legacy-orphan")
        snap.reference = MagicMock()
        snap.to_dict.return_value = orphan.get("data", {})
        orphan_snaps.append(snap)
    devices_col.stream.return_value = iter(orphan_snaps)
    db._orphan_snaps = orphan_snaps  # type: ignore[attr-defined]
    db._devices_col = devices_col  # type: ignore[attr-defined]
    return db


def test_register_device_with_installation_id_creates_new_doc_and_sweeps_legacy() -> None:
    """A first-time installationId-bearing registration creates a new
    doc keyed by the installationId AND deletes any device docs that
    lack an installationId field — those are pre-migration orphans
    that fan-out would otherwise keep sending to in parallel."""
    db = _installation_device_db(
        existing_install=None,
        legacy_orphans=[
            {"id": "legacy-a", "data": {"fcmToken": "old-A", "userAgent": "x"}},
            {"id": "legacy-b", "data": {"fcmToken": "old-B", "userAgent": "x"}},
            # An already-migrated peer should NOT be swept — it has an
            # installationId of its own. Different installation, real
            # second physical device.
            {
                "id": "peer-laptop",
                "data": {"fcmToken": "laptop", "installationId": "other-install"},
            },
        ],
    )
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={
                "fcmToken": "fresh-token",
                "platform": "web",
                "userAgent": "Safari",
                "appVersion": "1.0.0",
                "installationId": "install-abc",
            },
        )

    assert res.status_code == 201
    new_doc_id = res.json()["deviceId"]
    # Doc id is derived deterministically from the installationId.
    assert new_doc_id.startswith("i")
    # The new doc was set with installationId persisted as a field.
    set_payload = db._devices_col.document.return_value.set.call_args[0][0]
    assert set_payload["installationId"] == "install-abc"
    assert set_payload["fcmToken"] == "fresh-token"
    # Legacy orphans (no installationId field) were deleted.
    deleted = {snap.id for snap in db._orphan_snaps if snap.reference.delete.called}
    assert deleted == {"legacy-a", "legacy-b"}
    # The already-migrated peer was NOT deleted.
    peer_snap = next(s for s in db._orphan_snaps if s.id == "peer-laptop")
    peer_snap.reference.delete.assert_not_called()


def test_register_device_with_installation_id_rotates_existing_token_in_place() -> None:
    """Same installationId re-registering with a NEW fcmToken should
    update the existing doc rather than spawn a duplicate."""
    db = _installation_device_db(
        existing_install={
            "id": "existing-doc",
            "data": {
                "fcmToken": "old-token",
                "installationId": "install-abc",
                "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
            },
        },
    )
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={
                "fcmToken": "rotated-token",
                "platform": "web",
                "userAgent": "Safari",
                "installationId": "install-abc",
            },
        )

    assert res.status_code == 201
    assert res.json()["deviceId"] == "existing-doc"
    # The existing snap got its fcmToken rotated in place.
    update_payload = db._existing_install_snap.reference.update.call_args[0][0]
    assert update_payload["fcmToken"] == "rotated-token"
    # No new doc was created.
    db._devices_col.document.assert_not_called()
    # Sweep does not run when an existing-install doc was found.
    db._devices_col.stream.assert_not_called()


def test_register_device_falls_back_to_legacy_dedup_when_installation_id_absent() -> None:
    """Older clients that haven't shipped the installationId send yet
    must still hit the legacy fcmToken-based dedup path."""
    db = _device_db(existing_token="legacy-token")
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/users/me/devices",
            json={
                "fcmToken": "legacy-token",
                "platform": "web",
                "userAgent": "x",
            },
        )

    assert res.status_code == 201
    assert res.json()["deviceId"] == "dup-device"


def test_register_device_validates_installation_id_length() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(user))
    res = client.post(
        "/api/users/me/devices",
        json={
            "fcmToken": "abc",
            "platform": "web",
            "userAgent": "x",
            "installationId": "x" * 129,
        },
    )
    assert res.status_code == 422


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
