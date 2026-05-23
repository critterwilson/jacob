"""Tests for the admin-approval signup flow (ADR 0011).

Covers:
- `POST /api/applications/me` accept/refuse paths (email-unverified,
  under-13, already-approved, resubmit-while-pending).
- `GET /api/applications/me` 404 when no application, returns hydrated
  view otherwise.
- `GET /api/admin/applications` admin-only listing + status filter.
- `POST /api/admin/applications/{uid}/approve` requires parental
  consent for under-18 applicants, idempotent on already-decided.
- `POST /api/admin/applications/{uid}/reject` records reason + audit.

`firebase_admin` is not initialised — every test patches the firestore
client at the router-module boundary.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.admin import router as admin_router
from app.routers.applications import router as applications_router


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    """slowapi is configured at module-level; relax the limit for tests."""
    limiter.enabled = False
    yield
    limiter.enabled = True


def _snap(*, exists: bool, data: dict[str, Any] | None = None) -> MagicMock:
    snap = MagicMock()
    snap.exists = exists
    snap.to_dict.return_value = data or {}
    return snap


def _applicant_app(
    *,
    uid: str = "alice",
    email: str = "alice@example.com",
) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(applications_router)

    user = CurrentUser(uid=uid, email=email, claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    # The submit endpoint composes `require_not_banned`; override so tests
    # don't need a Firestore mock for the bans collection unless they
    # explicitly want to assert the ban path.
    app.dependency_overrides[require_not_banned] = lambda: user
    return app


def _admin_app(*, uid: str = "admin-uid", is_admin: bool = True) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(admin_router)
    user = CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_admin] = lambda: user
    return app


def _make_db(
    *,
    user_exists: bool = False,
    user_data: dict[str, Any] | None = None,
    app_exists: bool = False,
    app_data: dict[str, Any] | None = None,
) -> MagicMock:
    """Two-collection mock: users + applications.

    Each collection's `document(...).get()` returns a snap built from
    the supplied args. The application doc ref's `set()` and `update()`
    are MagicMocks the tests assert against. A separate audit_log
    collection mock is exposed so `write_audit_log` doesn't blow up.
    """
    user_snap = _snap(exists=user_exists, data=user_data or {})
    app_snap = _snap(exists=app_exists, data=app_data or {})

    user_ref = MagicMock()
    user_ref.get.return_value = user_snap
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    app_ref = MagicMock()
    # `set` replaces the snap so subsequent .get() picks up the new state.
    app_ref.get.return_value = app_snap
    apps_col = MagicMock()
    apps_col.document.return_value = app_ref

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()

    db = MagicMock()

    def _collection(name: str) -> MagicMock:
        if name == "applications":
            return apps_col
        if name == "audit_log":
            return audit_col
        return users_col

    db.collection.side_effect = _collection
    db._user_ref = user_ref  # type: ignore[attr-defined]
    db._app_ref = app_ref  # type: ignore[attr-defined]
    db._users_col = users_col  # type: ignore[attr-defined]
    return db


def _adult_dob() -> str:
    return (date.today() - timedelta(days=365 * 30)).isoformat()


def _minor_dob() -> str:
    return (date.today() - timedelta(days=365 * 15)).isoformat()


def _under_13_dob() -> str:
    return (date.today() - timedelta(days=365 * 10)).isoformat()


# ── POST /api/applications/me ─────────────────────────────────────────────


def test_submit_application_returns_410_gone() -> None:
    """ADR 0015: the platform-wide application queue is retired.

    `POST /api/applications/me` is preserved for OpenAPI schema parity
    but always returns 410 with code `application_flow_retired`. The
    new ingress is `POST /api/users/me` (onboarding) + per-group
    join-requests.
    """
    res = TestClient(_applicant_app()).post(
        "/api/applications/me",
        json={"displayName": "Alice", "dob": _adult_dob()},
    )
    assert res.status_code == 410
    assert res.json()["error"]["code"] == "application_flow_retired"


# ── GET /api/applications/me ──────────────────────────────────────────────


def test_get_my_application_404_when_missing() -> None:
    db = _make_db()
    with patch("app.routers.applications.get_firestore", return_value=db):
        res = TestClient(_applicant_app()).get("/api/applications/me")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "application_not_found"


def test_get_my_application_returns_view_when_present() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "dob": _adult_dob(),
            "isMinor": False,
            "status": "pending",
        },
    )
    with patch("app.routers.applications.get_firestore", return_value=db):
        res = TestClient(_applicant_app()).get("/api/applications/me")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert body["displayName"] == "Alice"
    assert body["isMinor"] is False
    assert body["age"] is not None and body["age"] >= 18


# ── Admin: list ───────────────────────────────────────────────────────────


def test_admin_list_applications_filters_by_status() -> None:
    db = _make_db()
    snap1 = _snap(
        exists=True,
        data={
            "email": "a@example.com",
            "displayName": "Alice",
            "status": "pending",
            "isMinor": False,
        },
    )
    snap1.id = "alice"  # type: ignore[attr-defined]
    snap2 = _snap(
        exists=True,
        data={
            "email": "b@example.com",
            "displayName": "Bob",
            "status": "pending",
            "isMinor": True,
        },
    )
    snap2.id = "bob"  # type: ignore[attr-defined]
    apps_col = db.collection("applications")
    apps_col.where.return_value.order_by.return_value.limit.return_value.stream.return_value = [
        snap1,
        snap2,
    ]

    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_admin_app()).get("/api/admin/applications")
    assert res.status_code == 200
    body = res.json()
    assert len(body["items"]) == 2
    assert {i["uid"] for i in body["items"]} == {"alice", "bob"}


def test_admin_list_applications_403_for_non_admin() -> None:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(admin_router)

    def _raise_forbidden() -> CurrentUser:
        raise HTTPException(
            status_code=403,
            detail={
                "error": {
                    "code": "forbidden",
                    "message": "Admin privileges required",
                    "details": {},
                }
            },
        )

    app.dependency_overrides[require_admin] = _raise_forbidden
    res = TestClient(app).get("/api/admin/applications")
    assert res.status_code == 403


def test_admin_list_applications_invalid_status_400() -> None:
    db = _make_db()
    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_admin_app()).get("/api/admin/applications?status=banana")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_status"


# ── Admin: approve ────────────────────────────────────────────────────────


def test_admin_approve_adult_writes_user_doc() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
            "phone": "555-0100",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"

    # users/{uid} doc was written.
    db._user_ref.set.assert_called_once()  # type: ignore[attr-defined]
    user_payload = db._user_ref.set.call_args[0][0]  # type: ignore[attr-defined]
    assert user_payload["displayName"] == "Alice"
    assert user_payload["email"] == "alice@example.com"
    assert user_payload["isMinor"] is False
    assert user_payload["role"] == "member"
    assert user_payload["phone"] == "555-0100"

    # applications/{uid} doc was marked approved.
    db._app_ref.update.assert_called_once()  # type: ignore[attr-defined]
    app_payload = db._app_ref.update.call_args[0][0]  # type: ignore[attr-defined]
    assert app_payload["status"] == "approved"
    assert app_payload["decidedBy"] == "admin-uid"


def test_admin_approve_minor_without_consent_returns_422() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "mia@example.com",
            "displayName": "Mia",
            "isMinor": True,
            "status": "pending",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/mia/approve",
            json={"parentalConsentObtained": False, "parentalConsentNotes": ""},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "parental_consent_required"
    db._user_ref.set.assert_not_called()  # type: ignore[attr-defined]
    db._app_ref.update.assert_not_called()  # type: ignore[attr-defined]


def test_admin_approve_minor_without_consent_field_returns_422() -> None:
    """Omitting `parentalConsentObtained` for a minor is treated as 'no'."""
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "mia@example.com",
            "displayName": "Mia",
            "isMinor": True,
            "status": "pending",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/mia/approve",
            json={},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "parental_consent_required"


def test_admin_approve_minor_with_consent_succeeds_and_records_notes() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "mia@example.com",
            "displayName": "Mia",
            "isMinor": True,
            "status": "pending",
        },
    )
    notes = "Spoke with parent at ministry meeting on 2026-05-14"
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/mia/approve",
            json={
                "parentalConsentObtained": True,
                "parentalConsentNotes": notes,
            },
        )
    assert res.status_code == 200
    db._user_ref.set.assert_called_once()  # type: ignore[attr-defined]
    user_payload = db._user_ref.set.call_args[0][0]  # type: ignore[attr-defined]
    assert user_payload["isMinor"] is True

    app_payload = db._app_ref.update.call_args[0][0]  # type: ignore[attr-defined]
    assert app_payload["parentalConsentObtained"] is True
    assert app_payload["parentalConsentNotes"] == notes


def test_admin_approve_404_when_application_missing() -> None:
    db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/ghost/approve",
            json={},
        )
    assert res.status_code == 404


def test_admin_approve_409_when_already_decided() -> None:
    db = _make_db(
        app_exists=True,
        app_data={"status": "approved", "isMinor": False},
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "application_already_decided"


# ── Admin approve: invite consumption (Case B) ────────────────────────────


def test_admin_approve_consumes_invite_code_from_application() -> None:
    """If the application doc has an inviteCode, approve calls consume_invite."""
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
            "inviteCode": "ABCD1234",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch(
            "app.routers.admin.consume_invite",
            return_value=("group-xyz", "invite-uuid"),
        ) as mock_consume,
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 200
    # `consume_invite` was called with the normalized code + the
    # applicant's uid (NOT the admin's uid).
    mock_consume.assert_called_once_with(db, "ABCD1234", "alice")
    # User doc was created BEFORE the invite consume (so consume_invite
    # has a valid `users/{uid}` to bind the member doc to).
    db._user_ref.set.assert_called_once()  # type: ignore[attr-defined]
    # The audit log records the join outcome.
    audit_set_call = db.collection("audit_log").document().set
    audit_payload = audit_set_call.call_args[0][0]
    invite_outcome = audit_payload["payload"]["invite"]
    assert invite_outcome["attempted"] is True
    assert invite_outcome["status"] == "joined"
    assert invite_outcome["gid"] == "group-xyz"


def test_admin_approve_does_not_attempt_consume_when_no_invite_code() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.routers.admin.consume_invite") as mock_consume,
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 200
    mock_consume.assert_not_called()
    audit_set_call = db.collection("audit_log").document().set
    invite_outcome = audit_set_call.call_args[0][0]["payload"]["invite"]
    assert invite_outcome["attempted"] is False


def test_admin_approve_continues_when_invite_code_expired() -> None:
    """Expired/revoked invite must NOT block approval — log + audit instead."""
    from fastapi import status as http_status

    from app.errors import APIError as _APIError

    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
            "inviteCode": "ABCD1234",
        },
    )

    def _raise_expired(_db_arg, _code, _uid):  # type: ignore[no-untyped-def]
        raise _APIError(
            status_code=http_status.HTTP_410_GONE,
            code="invite_expired",
            message="This invite has expired",
        )

    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch(
            "app.routers.admin.consume_invite",
            side_effect=_raise_expired,
        ),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    # Approval still succeeds — the user is approved even if the invite
    # they originally clicked has since expired. They'll just need to
    # be re-invited if they still want to join the group.
    assert res.status_code == 200
    assert res.json()["status"] == "approved"
    # User doc was created (the approval did fully complete).
    db._user_ref.set.assert_called_once()  # type: ignore[attr-defined]
    # Audit records the failed consume with the error code.
    audit_set_call = db.collection("audit_log").document().set
    invite_outcome = audit_set_call.call_args[0][0]["payload"]["invite"]
    assert invite_outcome["status"] == "failed"
    assert invite_outcome["errorCode"] == "invite_expired"


def test_admin_approve_continues_when_group_at_cap() -> None:
    """At-cap is also non-fatal — same shape as expired."""
    from fastapi import status as http_status

    from app.errors import APIError as _APIError

    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
            "inviteCode": "ABCD1234",
        },
    )

    def _raise_at_cap(_db_arg, _code, _uid):  # type: ignore[no-untyped-def]
        raise _APIError(
            status_code=http_status.HTTP_409_CONFLICT,
            code="group_at_cap",
            message="This group is at its member limit.",
            details={"cap": 20, "currentCount": 20},
        )

    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch(
            "app.routers.admin.consume_invite",
            side_effect=_raise_at_cap,
        ),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 200
    audit_set_call = db.collection("audit_log").document().set
    invite_outcome = audit_set_call.call_args[0][0]["payload"]["invite"]
    assert invite_outcome["status"] == "failed"
    assert invite_outcome["errorCode"] == "group_at_cap"


def test_admin_approve_swallows_unexpected_error_from_consume() -> None:
    """An unexpected exception during consume must not roll back approval."""
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "alice@example.com",
            "displayName": "Alice",
            "isMinor": False,
            "status": "pending",
            "inviteCode": "ABCD1234",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch(
            "app.routers.admin.consume_invite",
            side_effect=RuntimeError("firestore down"),
        ),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/approve",
            json={},
        )
    assert res.status_code == 200
    audit_set_call = db.collection("audit_log").document().set
    invite_outcome = audit_set_call.call_args[0][0]["payload"]["invite"]
    assert invite_outcome["status"] == "errored"


# ── Admin: reject ─────────────────────────────────────────────────────────


def test_admin_reject_records_reason_and_audit() -> None:
    db = _make_db(
        app_exists=True,
        app_data={
            "email": "x@example.com",
            "displayName": "X",
            "isMinor": False,
            "status": "pending",
        },
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/x/reject",
            json={"reason": "Out of geography; ministry is local-only"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"

    app_payload = db._app_ref.update.call_args[0][0]  # type: ignore[attr-defined]
    assert app_payload["status"] == "rejected"
    assert "geography" in app_payload["rejectionReason"]
    # We do NOT create a user doc on reject.
    db._user_ref.set.assert_not_called()  # type: ignore[attr-defined]


def test_admin_reject_404_when_missing() -> None:
    db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/ghost/reject",
            json={"reason": "..."},
        )
    assert res.status_code == 404


def test_admin_reject_409_when_already_decided() -> None:
    db = _make_db(
        app_exists=True,
        app_data={"status": "approved", "isMinor": False},
    )
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/applications/alice/reject",
            json={"reason": "Late reject"},
        )
    assert res.status_code == 409


def test_admin_reject_empty_reason_returns_422() -> None:
    res = TestClient(_admin_app()).post(
        "/api/admin/applications/x/reject",
        json={"reason": ""},
    )
    assert res.status_code == 422
