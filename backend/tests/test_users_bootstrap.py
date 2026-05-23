"""Tests for the bootstrap and profile endpoints (M2 of the data-layer migration).

The Firestore Admin SDK is mocked so no real writes happen. The
`firebase_admin` init in `get_current_user` is bypassed by the
dependency override.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
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


def _app(*, authed_user: CurrentUser | None = None, override_not_banned: bool = True) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.state.limiter = limiter
    app.include_router(users_router)
    if authed_user is not None:
        app.dependency_overrides[get_current_user] = lambda: authed_user
        if override_not_banned:
            app.dependency_overrides[require_not_banned] = lambda: authed_user
    return app


def _user_snap(*, exists: bool, data: dict | None = None) -> MagicMock:
    snap = MagicMock()
    snap.exists = exists
    snap.to_dict.return_value = data or {}
    return snap


def _user_db(snap: MagicMock, *, app_snap: MagicMock | None = None) -> MagicMock:
    """Mock Firestore client with separate collections for users / applications.

    `app_snap` defaults to an approved application — that's the state
    that lets the deprecated `POST /api/users/me` endpoint write the
    user doc (ADR 0011: post-deploy, only an approved application
    permits direct profile creation). Tests for the bootstrap or
    update paths can pass `app_snap=_user_snap(exists=False)` if the
    application doc shouldn't exist.
    """
    db = MagicMock()
    user_ref = MagicMock()
    user_ref.get.return_value = snap
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    if app_snap is None:
        app_snap = _user_snap(exists=True, data={"status": "approved"})
    app_ref = MagicMock()
    app_ref.get.return_value = app_snap
    apps_col = MagicMock()
    apps_col.document.return_value = app_ref

    def _collection(name: str) -> MagicMock:
        if name == "applications":
            return apps_col
        return users_col

    db.collection.side_effect = _collection
    db._user_ref = user_ref  # type: ignore[attr-defined]
    db._app_ref = app_ref  # type: ignore[attr-defined]
    return db


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    """Disable slowapi for these tests — bootstrap is hit on every render."""
    limiter.enabled = False
    yield
    limiter.enabled = True


# ── bootstrap ─────────────────────────────────────────────────────────────


def test_bootstrap_returns_profile_for_existing_user() -> None:
    snap = _user_snap(
        exists=True,
        data={
            "displayName": "Alice",
            "email": "alice@example.com",
            "photoURL": "https://example.com/a.jpg",
            "isMinor": False,
            "schemaVersion": 1,
        },
    )
    db = _user_db(snap)
    user = CurrentUser(uid="alice", email="alice@example.com", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.get("/api/users/me/bootstrap")

    assert res.status_code == 200
    body = res.json()
    assert body["hasProfile"] is True
    assert body["profile"]["uid"] == "alice"
    assert body["profile"]["displayName"] == "Alice"
    assert body["claims"] == {"admin": False, "ministryOwner": False}
    # Cookie set side-effect — required so middleware redirects work.
    set_cookie = res.headers.get("set-cookie") or ""
    assert "jacob-has-profile=1" in set_cookie
    assert "Path=/" in set_cookie
    assert "SameSite=lax" in set_cookie or "SameSite=Lax" in set_cookie


def test_bootstrap_returns_null_for_new_user() -> None:
    snap = _user_snap(exists=False)
    db = _user_db(snap)
    user = CurrentUser(uid="ghost", email="ghost@example.com", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.get("/api/users/me/bootstrap")

    assert res.status_code == 200
    body = res.json()
    assert body["hasProfile"] is False
    assert body["profile"] is None
    set_cookie = res.headers.get("set-cookie") or ""
    # Clearing cookie carries Max-Age=0.
    assert "jacob-has-profile=" in set_cookie
    assert "Max-Age=0" in set_cookie


def test_bootstrap_admin_claim_propagates() -> None:
    snap = _user_snap(
        exists=True, data={"displayName": "Alice", "schemaVersion": 1, "isMinor": False}
    )
    db = _user_db(snap)
    user = CurrentUser(uid="alice", claims={"admin": True})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.get("/api/users/me/bootstrap")
    assert res.status_code == 200
    assert res.json()["claims"] == {"admin": True, "ministryOwner": False}


def test_bootstrap_passes_through_deletion_pending_state() -> None:
    snap = _user_snap(
        exists=True,
        data={
            "displayName": "Alice",
            "schemaVersion": 1,
            "isMinor": False,
            "deletionRequestedAt": datetime(2026, 5, 1, tzinfo=UTC),
        },
    )
    db = _user_db(snap)
    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.get("/api/users/me/bootstrap")
    body = res.json()
    assert body["deletionRequestedAt"].startswith("2026-05-01")


def test_bootstrap_requires_auth() -> None:
    client = TestClient(_app(authed_user=None))
    res = client.get("/api/users/me/bootstrap")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


# ── create profile ────────────────────────────────────────────────────────


def _create_profile_db(*, fresh_snap: MagicMock) -> MagicMock:
    """Mock for the ADR 0014 onboarding write.

    `users/{uid}` is absent on the first read and present on the second;
    the `private/profile` subcollection write is captured for assertions
    on the DOB persistence path.
    """
    user_ref = MagicMock()
    user_ref.get.side_effect = [_user_snap(exists=False), fresh_snap]
    # `users/{uid}/private/profile` write — exposed for tests that check
    # the DOB-on-private-subcollection contract.
    private_ref = MagicMock()
    private_col = MagicMock()
    private_col.document.return_value = private_ref
    user_ref.collection.return_value = private_col
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    db = MagicMock()
    db.collection.return_value = users_col
    db._user_ref = user_ref  # type: ignore[attr-defined]
    db._private_ref = private_ref  # type: ignore[attr-defined]
    return db


def _adult_dob() -> str:
    return (date.today() - timedelta(days=365 * 30)).isoformat()


def _minor_dob() -> str:
    return (date.today() - timedelta(days=365 * 15)).isoformat()


def _under_13_dob() -> str:
    return (date.today() - timedelta(days=365 * 10)).isoformat()


def test_create_profile_persists_required_fields() -> None:
    # First .get() returns no doc; after .set() the next .get() returns one.
    fresh_snap = _user_snap(
        exists=True,
        data={
            "displayName": "Alice",
            "email": "alice@example.com",
            "photoURL": "https://example.com/a.jpg",
            "isMinor": False,
            "schemaVersion": 1,
        },
    )
    db = _create_profile_db(fresh_snap=fresh_snap)
    user_ref = db._user_ref  # type: ignore[attr-defined]
    private_ref = db._private_ref  # type: ignore[attr-defined]

    user = CurrentUser(uid="alice", email="alice@example.com", claims={})
    adult_dob = _adult_dob()
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log") as audit,
    ):
        client = TestClient(_app(authed_user=user))
        res = client.post(
            "/api/users/me",
            json={
                "displayName": "Alice",
                "photoURL": "https://example.com/a.jpg",
                "dob": adult_dob,
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert body["uid"] == "alice"
    assert body["displayName"] == "Alice"

    # Wrote the user doc.
    user_ref.set.assert_called_once()
    payload = user_ref.set.call_args[0][0]
    assert payload["displayName"] == "Alice"
    assert payload["email"] == "alice@example.com"
    assert payload["photoURL"] == "https://example.com/a.jpg"
    assert payload["schemaVersion"] == 1
    assert payload["role"] == "member"
    # server computes isMinor from dob — adult dob ⇒ false
    assert payload["isMinor"] is False
    assert "dob" not in payload  # DOB never lands on the public user doc
    # createdAt is the server sentinel — assert it's not a literal datetime
    # (that would mean we're trusting the client).
    assert not isinstance(payload["createdAt"], datetime)

    # Wrote DOB to the private subcollection.
    private_ref.set.assert_called_once()
    private_payload = private_ref.set.call_args[0][0]
    assert private_payload["dob"] == adult_dob

    # Audit log recorded.
    audit.assert_called_once()
    assert audit.call_args.kwargs["action"] == "account.create_profile"

    # Cookie set.
    set_cookie = res.headers.get("set-cookie") or ""
    assert "jacob-has-profile=1" in set_cookie


def test_create_profile_minor_dob_sets_is_minor() -> None:
    """ADR 0014: server computes isMinor from dob, ignoring any client-side flag."""
    fresh_snap = _user_snap(
        exists=True,
        data={"displayName": "Mia", "isMinor": True, "schemaVersion": 1},
    )
    db = _create_profile_db(fresh_snap=fresh_snap)
    user_ref = db._user_ref  # type: ignore[attr-defined]

    user = CurrentUser(uid="mia", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log"),
    ):
        client = TestClient(_app(authed_user=user))
        res = client.post(
            "/api/users/me",
            json={"displayName": "Mia", "dob": _minor_dob()},
        )
    assert res.status_code == 201
    payload = user_ref.set.call_args[0][0]
    assert payload["isMinor"] is True


def test_create_profile_under_13_refused() -> None:
    db = _create_profile_db(fresh_snap=_user_snap(exists=True))
    user = CurrentUser(uid="tim", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.post(
            "/api/users/me",
            json={"displayName": "Tim", "dob": _under_13_dob()},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "under_minimum_age"
    db._user_ref.set.assert_not_called()  # type: ignore[attr-defined]


def test_create_profile_409_on_duplicate() -> None:
    user_ref = MagicMock()
    user_ref.get.return_value = _user_snap(exists=True, data={"displayName": "Alice"})
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", email="alice@example.com", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.post(
            "/api/users/me",
            json={"displayName": "Alice", "dob": _adult_dob()},
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "profile_exists"
    user_ref.set.assert_not_called()


def test_create_profile_validates_display_name_too_short() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(authed_user=user))
    res = client.post(
        "/api/users/me",
        json={"displayName": "", "dob": _adult_dob()},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_create_profile_validates_display_name_too_long() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(authed_user=user))
    res = client.post(
        "/api/users/me",
        json={"displayName": "x" * 101, "dob": _adult_dob()},
    )
    assert res.status_code == 422


def test_create_profile_rejects_extra_keys() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(authed_user=user))
    res = client.post(
        "/api/users/me",
        json={"displayName": "Alice", "dob": _adult_dob(), "role": "admin"},
    )
    assert res.status_code == 422


def test_create_profile_rejects_invalid_photo_url() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(authed_user=user))
    res = client.post(
        "/api/users/me",
        json={"displayName": "Alice", "dob": _adult_dob(), "photoURL": "not-a-url"},
    )
    assert res.status_code == 422


def test_create_profile_persists_optional_fields_when_supplied() -> None:
    fresh_snap = _user_snap(
        exists=True,
        data={
            "displayName": "Alice",
            "phone": "+1-555-0100",
            "location": "Brooklyn",
            "faithBackground": "Methodist",
            "isMinor": False,
            "schemaVersion": 1,
        },
    )
    db = _create_profile_db(fresh_snap=fresh_snap)
    user_ref = db._user_ref  # type: ignore[attr-defined]

    user = CurrentUser(uid="alice", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log"),
    ):
        client = TestClient(_app(authed_user=user))
        res = client.post(
            "/api/users/me",
            json={
                "displayName": "Alice",
                "dob": _adult_dob(),
                "phone": "+1-555-0100",
                "location": "Brooklyn",
                "faithBackground": "Methodist",
            },
        )

    assert res.status_code == 201
    payload = user_ref.set.call_args[0][0]
    assert payload["phone"] == "+1-555-0100"
    assert payload["location"] == "Brooklyn"
    assert payload["faithBackground"] == "Methodist"


# ── update profile ────────────────────────────────────────────────────────


def test_update_profile_only_writes_supplied_keys() -> None:
    user_ref = MagicMock()
    user_ref.get.side_effect = [
        _user_snap(exists=True, data={"displayName": "Old"}),
        _user_snap(
            exists=True,
            data={"displayName": "New", "schemaVersion": 1, "isMinor": False},
        ),
    ]
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log") as audit,
    ):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={"displayName": "New"})

    assert res.status_code == 200
    user_ref.update.assert_called_once_with({"displayName": "New"})
    assert audit.call_args.kwargs["payload"] == {"changedKeys": ["displayName"]}


def test_update_profile_rejects_extra_keys() -> None:
    user = CurrentUser(uid="alice", claims={})
    client = TestClient(_app(authed_user=user))
    res = client.patch("/api/users/me", json={"role": "admin"})
    assert res.status_code == 422


def test_update_profile_empty_body_422() -> None:
    user_ref = MagicMock()
    user_ref.get.return_value = _user_snap(exists=True, data={"displayName": "Alice"})
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "empty_update"


def test_update_profile_404_when_no_doc() -> None:
    user_ref = MagicMock()
    user_ref.get.return_value = _user_snap(exists=False)
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="ghost", claims={})
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={"displayName": "Alice"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "user_not_found"


def test_update_profile_403_when_banned() -> None:
    """`require_not_banned` rejects the request before touching Firestore."""
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(users_router)
    user = CurrentUser(uid="alice", claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    # Don't override require_not_banned — let the real dep run against a
    # patched Firestore that says the user has an active ban.
    bans_db = MagicMock()
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {"expiresAt": datetime(9999, 1, 1, tzinfo=UTC)}
    bans_db.collection.return_value.document.return_value.get.return_value = snap

    limiter.enabled = False
    try:
        with patch("app.deps.get_firestore", return_value=bans_db):
            client = TestClient(app)
            res = client.patch("/api/users/me", json={"displayName": "Alice"})
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "banned"
    finally:
        limiter.enabled = True


def test_update_profile_photo_url_to_null_persists_null() -> None:
    user_ref = MagicMock()
    user_ref.get.side_effect = [
        _user_snap(exists=True, data={"photoURL": "https://example.com/a.jpg"}),
        _user_snap(
            exists=True,
            data={"displayName": "Alice", "photoURL": None, "isMinor": False, "schemaVersion": 1},
        ),
    ]
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log"),
    ):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={"photoURL": None})
    assert res.status_code == 200
    user_ref.update.assert_called_once_with({"photoURL": None})


# ── auth gates ────────────────────────────────────────────────────────────


def test_create_profile_requires_auth() -> None:
    client = TestClient(_app(authed_user=None))
    res = client.post("/api/users/me", json={"displayName": "Alice", "isMinor": False})
    assert res.status_code == 401


def test_update_profile_requires_auth() -> None:
    client = TestClient(_app(authed_user=None))
    res = client.patch("/api/users/me", json={"displayName": "Alice"})
    assert res.status_code == 401


def test_create_profile_403_banned() -> None:
    from tests.conftest import banned_db

    user = CurrentUser(uid="alice", email="a@example.com", claims={})
    with patch("app.deps.get_firestore", return_value=banned_db()):
        client = TestClient(_app(authed_user=user, override_not_banned=False))
        res = client.post("/api/users/me", json={"displayName": "Alice", "isMinor": False})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_update_profile_syncs_changed_email_from_token() -> None:
    """PR13 / L3: when the Firebase Auth email differs from the doc's
    `email`, the update mirrors the token value into Firestore."""
    user_ref = MagicMock()
    user_ref.get.side_effect = [
        _user_snap(exists=True, data={"displayName": "Alice", "email": "old@example.com"}),
        _user_snap(
            exists=True,
            data={
                "displayName": "Alice",
                "email": "new@example.com",
                "schemaVersion": 1,
                "isMinor": False,
            },
        ),
    ]
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", email="new@example.com", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log"),
    ):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={"displayName": "Alice"})
    assert res.status_code == 200
    payload = user_ref.update.call_args[0][0]
    assert payload.get("email") == "new@example.com"


def test_update_profile_does_not_write_email_when_unchanged() -> None:
    """When token email matches the existing doc email, no email field is
    re-written (cheap optimization, also keeps audit-log payload tidy)."""
    user_ref = MagicMock()
    user_ref.get.side_effect = [
        _user_snap(exists=True, data={"displayName": "Alice", "email": "same@example.com"}),
        _user_snap(
            exists=True,
            data={
                "displayName": "Alice",
                "email": "same@example.com",
                "schemaVersion": 1,
                "isMinor": False,
            },
        ),
    ]
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", email="same@example.com", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log"),
    ):
        client = TestClient(_app(authed_user=user))
        res = client.patch("/api/users/me", json={"displayName": "Alice"})
    assert res.status_code == 200
    payload = user_ref.update.call_args[0][0]
    assert "email" not in payload


def test_update_profile_persists_phone_location_faith_background() -> None:
    """Regression: PATCH /api/users/me must persist phone, location, and
    faithBackground — these fields were previously accepted by CreateProfileRequest
    but omitted from UpdateProfileRequest, making them silently non-updatable."""
    user_ref = MagicMock()
    user_ref.get.side_effect = [
        _user_snap(exists=True, data={"displayName": "Alice"}),
        _user_snap(
            exists=True,
            data={
                "displayName": "Alice",
                "phone": "+1-555-0199",
                "location": "Chicago",
                "faithBackground": "Lutheran",
                "schemaVersion": 1,
                "isMinor": False,
            },
        ),
    ]
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db = MagicMock()
    db.collection.return_value = users_col

    user = CurrentUser(uid="alice", claims={})
    with (
        patch("app.routers.users.get_firestore", return_value=db),
        patch("app.routers.users.write_audit_log") as audit,
    ):
        client = TestClient(_app(authed_user=user))
        res = client.patch(
            "/api/users/me",
            json={
                "phone": "+1-555-0199",
                "location": "Chicago",
                "faithBackground": "Lutheran",
            },
        )

    assert res.status_code == 200
    payload = user_ref.update.call_args[0][0]
    assert payload["phone"] == "+1-555-0199"
    assert payload["location"] == "Chicago"
    assert payload["faithBackground"] == "Lutheran"
    assert audit.call_args.kwargs["payload"] == {
        "changedKeys": ["faithBackground", "location", "phone"]
    }
