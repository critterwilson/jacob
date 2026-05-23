"""Tests for the ADR 0015 leader-application flow.

Covers:
- `POST /api/leader-applications` happy path + idempotency.
- `POST /api/admin/leader-applications/{appId}/approve` creates the
  target group atomically and stamps the application.
- `POST /api/admin/leader-applications/{appId}/reject` records the
  reason and audit entry.

`firebase_admin` is not initialised; the Firestore client is mocked
at the router-module boundary.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import (
    get_current_user,
    require_ministry_owner_or_admin,
    require_not_banned,
)
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.admin import router as admin_router
from app.routers.leader_applications import router as la_router


def _snap(*, exists: bool, data: dict[str, Any] | None = None) -> MagicMock:
    s = MagicMock()
    s.exists = exists
    s.to_dict.return_value = data or {}
    return s


def _applicant_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(la_router)
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    return app


def _owner_app(uid: str = "owner") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(admin_router)
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims={"ministry_owner": True})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    app.dependency_overrides[require_ministry_owner_or_admin] = lambda: user
    return app


# ── applicant: submit ──────────────────────────────────────────────────────


def test_submit_leader_application_writes_pending_doc() -> None:
    user_snap = _snap(exists=True, data={"displayName": "Alice", "email": "a@x.com"})
    user_ref = MagicMock()
    user_ref.get.return_value = user_snap
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    # No prior pending application — `.where(...).where(...).limit(...).stream()`
    # returns an empty list.
    la_col = MagicMock()
    la_col.where.return_value.where.return_value.limit.return_value.stream.return_value = []
    la_doc_ref = MagicMock()
    la_doc_ref.get.return_value = _snap(
        exists=True,
        data={
            "applicantUid": "alice",
            "applicantDisplayName": "Alice",
            "applicantEmail": "a@x.com",
            "proposedGroupName": "Tuesday Night",
            "proposedGroupDescription": "Tues night small group",
            "proposedAudience": "christian",
            "motivation": "",
            "status": "pending",
        },
    )
    la_col.document.return_value = la_doc_ref

    db = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "leader_applications":
            return la_col
        return users_col

    db.collection.side_effect = _col

    with (
        patch("app.routers.leader_applications.get_firestore", return_value=db),
        patch("app.routers.leader_applications.write_audit_log"),
    ):
        res = TestClient(_applicant_app()).post(
            "/api/leader-applications",
            json={
                "proposedGroupName": "Tuesday Night",
                "proposedGroupDescription": "Tues night small group",
                "proposedAudience": "christian",
                "motivation": "",
            },
        )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "pending"
    assert body["proposedGroupName"] == "Tuesday Night"

    payload = la_doc_ref.set.call_args[0][0]
    assert payload["applicantUid"] == "alice"
    assert payload["status"] == "pending"
    assert payload["createdGroupId"] is None


def test_submit_leader_application_409_when_pending_exists() -> None:
    user_snap = _snap(exists=True, data={"displayName": "Alice"})
    user_ref = MagicMock()
    user_ref.get.return_value = user_snap
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    existing = _snap(exists=True, data={"status": "pending"})
    existing.id = "prev-app"  # type: ignore[attr-defined]
    la_col = MagicMock()
    la_col.where.return_value.where.return_value.limit.return_value.stream.return_value = [existing]

    db = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "leader_applications":
            return la_col
        return users_col

    db.collection.side_effect = _col

    with patch("app.routers.leader_applications.get_firestore", return_value=db):
        res = TestClient(_applicant_app()).post(
            "/api/leader-applications",
            json={
                "proposedGroupName": "X",
                "proposedGroupDescription": "Y",
                "proposedAudience": "christian",
            },
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "application_pending"


def test_submit_leader_application_requires_user_profile() -> None:
    user_ref = MagicMock()
    user_ref.get.return_value = _snap(exists=False)
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    db = MagicMock()
    db.collection.return_value = users_col

    with patch("app.routers.leader_applications.get_firestore", return_value=db):
        res = TestClient(_applicant_app()).post(
            "/api/leader-applications",
            json={
                "proposedGroupName": "Tuesday Night",
                "proposedGroupDescription": "desc",
                "proposedAudience": "christian",
            },
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "profile_required"


# ── owner: approve creates a group ─────────────────────────────────────────


def test_owner_approve_leader_application_creates_group() -> None:
    la_ref = MagicMock()
    la_ref.get.return_value = _snap(
        exists=True,
        data={
            "applicantUid": "alice",
            "applicantDisplayName": "Alice",
            "proposedGroupName": "Tuesday Night",
            "proposedGroupDescription": "Tues night small group",
            "proposedAudience": "christian",
            "status": "pending",
        },
    )
    la_col = MagicMock()
    la_col.document.return_value = la_ref

    user_ref = MagicMock()
    user_ref.get.return_value = _snap(exists=True, data={"displayName": "Alice"})
    users_col = MagicMock()
    users_col.document.return_value = user_ref

    db = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "leader_applications":
            return la_col
        return users_col

    db.collection.side_effect = _col

    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch(
            "app.routers.admin.create_group_for_approved_application",
            return_value="new-gid",
        ) as create_group,
    ):
        res = TestClient(_owner_app()).post(
            "/api/admin/leader-applications/app1/approve",
            json={"decisionNotes": "Welcome aboard"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["createdGroupId"] == "new-gid"

    # Group create was called with the applicant + proposed metadata.
    create_group.assert_called_once()
    kwargs = create_group.call_args.kwargs
    assert kwargs["applicant_uid"] == "alice"
    assert kwargs["name"] == "Tuesday Night"

    # Application was marked approved with the new gid stamped on.
    update_payload = la_ref.update.call_args[0][0]
    assert update_payload["status"] == "approved"
    assert update_payload["createdGroupId"] == "new-gid"


def test_owner_approve_leader_application_404_when_missing() -> None:
    la_ref = MagicMock()
    la_ref.get.return_value = _snap(exists=False)
    la_col = MagicMock()
    la_col.document.return_value = la_ref
    db = MagicMock()
    db.collection.return_value = la_col

    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/leader-applications/missing/approve",
            json={},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "leader_application_not_found"


def test_owner_approve_leader_application_409_when_decided() -> None:
    la_ref = MagicMock()
    la_ref.get.return_value = _snap(exists=True, data={"status": "approved"})
    la_col = MagicMock()
    la_col.document.return_value = la_ref
    db = MagicMock()
    db.collection.return_value = la_col

    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/leader-applications/app1/approve",
            json={},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "leader_application_already_decided"


def test_owner_reject_leader_application_records_reason() -> None:
    la_ref = MagicMock()
    la_ref.get.return_value = _snap(
        exists=True,
        data={"applicantUid": "alice", "status": "pending"},
    )
    la_col = MagicMock()
    la_col.document.return_value = la_ref
    db = MagicMock()
    db.collection.return_value = la_col

    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_owner_app()).post(
            "/api/admin/leader-applications/app1/reject",
            json={"reason": "Not yet a fit for this ministry"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    update_payload = la_ref.update.call_args[0][0]
    assert update_payload["status"] == "rejected"
    assert "fit" in update_payload["decisionNotes"]
