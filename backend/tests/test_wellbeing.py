"""Tests for the wellbeing flag pipeline.

Covers:
- POST /api/wellbeing/flags: happy path, dedup, unauthenticated
- GET /api/admin/wellbeing: list by status, invalid status
- POST /api/admin/wellbeing/{item_id}/status: valid transitions, invalid transition, 404
- GET /api/admin/wellbeing/{item_id}/audit: happy path, 404
- POST /api/admin/users/{uid}/moderator: grant, revoke, user not found
- GET /api/admin/moderators: list
- require_moderator_or_admin dep: admin passes, moderator passes, plain user fails
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin, require_moderator_or_admin
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.models.wellbeing import valid_next_statuses
from app.routers.wellbeing import admin_router, router


# ── helpers ────────────────────────────────────────────────────────────────────


def _make_app(
    uid: str = "user-uid",
    claims: dict[str, Any] | None = None,
    override_moderator_dep: bool = False,
) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.include_router(admin_router)
    user = CurrentUser(uid=uid, email=f"{uid}@test.com", claims=claims or {})
    app.dependency_overrides[get_current_user] = lambda: user
    if override_moderator_dep:
        app.dependency_overrides[require_moderator_or_admin] = lambda: user
    return app


def _admin_app(uid: str = "admin-uid") -> FastAPI:
    app = _make_app(uid=uid, claims={"admin": True})
    app.dependency_overrides[require_admin] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@test.com", claims={"admin": True}
    )
    app.dependency_overrides[require_moderator_or_admin] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@test.com", claims={"admin": True}
    )
    return app


def _moderator_app(uid: str = "mod-uid") -> FastAPI:
    app = _make_app(uid=uid, claims={"moderator": True})
    app.dependency_overrides[require_moderator_or_admin] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@test.com", claims={"moderator": True}
    )
    return app


def _plain_user_app(uid: str = "user-uid") -> FastAPI:
    return _make_app(uid=uid, claims={})


def _make_db_no_dedup() -> MagicMock:
    db = MagicMock()
    modq = MagicMock()
    modq.where.return_value = modq
    modq.limit.return_value = modq
    modq.stream.return_value = []
    modq.document.return_value = MagicMock()
    db.collection.return_value = modq
    return db


def _make_queue_item(
    item_id: str = "flag-1",
    status: str = "open",
    reason: str = "wellbeing_concern",
) -> MagicMock:
    snap = MagicMock()
    snap.exists = True
    snap.id = item_id
    snap.to_dict.return_value = {
        "reason": reason,
        "status": status,
        "reportedBy": "reporter-uid",
        "subjectUid": "subject-uid",
        "resourceRef": "users/subject-uid",
        "context": "I am worried about this person",
        "groupId": None,
        "createdAt": None,
    }
    return snap


# ── model tests ────────────────────────────────────────────────────────────────


def test_valid_next_statuses_open() -> None:
    assert valid_next_statuses("open") == {"in_progress"}


def test_valid_next_statuses_in_progress() -> None:
    assert valid_next_statuses("in_progress") == {"resolved"}


def test_valid_next_statuses_resolved() -> None:
    assert valid_next_statuses("resolved") == set()


def test_valid_next_statuses_unknown() -> None:
    assert valid_next_statuses("pending") == set()


# ── require_moderator_or_admin dep ────────────────────────────────────────────


def test_dep_admin_passes() -> None:
    from app.deps import require_moderator_or_admin as dep

    user = CurrentUser(uid="a", email="a@x.com", claims={"admin": True})
    result = dep(user=user)
    assert result.uid == "a"


def test_dep_moderator_passes() -> None:
    from app.deps import require_moderator_or_admin as dep

    user = CurrentUser(uid="m", email="m@x.com", claims={"moderator": True})
    result = dep(user=user)
    assert result.uid == "m"


def test_dep_plain_user_forbidden() -> None:
    from app.deps import require_moderator_or_admin as dep
    from app.errors import APIError

    user = CurrentUser(uid="u", email="u@x.com", claims={})
    with pytest.raises(APIError) as exc:
        dep(user=user)
    assert exc.value.status_code == 403
    assert exc.value.detail["error"]["code"] == "forbidden"


# ── submit wellbeing flag ─────────────────────────────────────────────────────


def test_submit_wellbeing_flag_happy_path() -> None:
    db = _make_db_no_dedup()
    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_make_app()).post(
            "/api/wellbeing/flags",
            json={"subjectUid": "subject-1", "note": "I am worried about this person"},
        )
    assert r.status_code == 201
    body = r.json()
    assert "flagId" in body
    assert body["dedup"] is False


def test_submit_wellbeing_flag_dedup() -> None:
    db = MagicMock()
    modq = MagicMock()
    modq.where.return_value = modq
    modq.limit.return_value = modq
    existing = MagicMock()
    existing.id = "existing-flag"
    modq.stream.return_value = [existing]
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_make_app()).post(
            "/api/wellbeing/flags",
            json={"subjectUid": "subject-1", "note": "I am worried about this person"},
        )
    assert r.status_code == 201
    body = r.json()
    assert body["dedup"] is True
    assert body["flagId"] == "existing-flag"


def test_submit_wellbeing_flag_short_note_rejected() -> None:
    r = TestClient(_make_app()).post(
        "/api/wellbeing/flags",
        json={"subjectUid": "subject-1", "note": "short"},
    )
    assert r.status_code == 422


def test_submit_wellbeing_flag_unauthenticated() -> None:
    app = FastAPI()
    app.include_router(router)
    r = TestClient(app, raise_server_exceptions=False).post(
        "/api/wellbeing/flags",
        json={"subjectUid": "subject-1", "note": "I am worried about this person"},
    )
    assert r.status_code == 401


# ── list wellbeing queue ──────────────────────────────────────────────────────


def test_list_wellbeing_queue_returns_items() -> None:
    db = MagicMock()
    modq = MagicMock()
    snap = _make_queue_item()
    modq.where.return_value = modq
    modq.order_by.return_value = modq
    modq.limit.return_value = modq
    modq.stream.return_value = [snap]
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_admin_app()).get("/api/admin/wellbeing?status=open")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["itemId"] == "flag-1"


def test_list_wellbeing_queue_invalid_status() -> None:
    with patch("app.routers.wellbeing.init_firebase_admin"):
        r = TestClient(_admin_app()).get("/api/admin/wellbeing?status=pending")
    assert r.status_code == 400


def test_list_wellbeing_queue_moderator_allowed() -> None:
    db = MagicMock()
    modq = MagicMock()
    modq.where.return_value = modq
    modq.order_by.return_value = modq
    modq.limit.return_value = modq
    modq.stream.return_value = []
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).get("/api/admin/wellbeing?status=open")
    assert r.status_code == 200


# ── status transition ─────────────────────────────────────────────────────────


def test_transition_open_to_in_progress() -> None:
    db = MagicMock()
    modq = MagicMock()
    item_snap = _make_queue_item(status="open")
    item_ref = MagicMock()
    item_ref.get.return_value = item_snap
    modq.document.return_value = item_ref

    history_col = MagicMock()
    history_doc = MagicMock()
    history_col.document.return_value = history_doc
    item_ref.collection.return_value = history_col

    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
        patch("app.routers.wellbeing.write_audit_log"),
    ):
        r = TestClient(_moderator_app()).post(
            "/api/admin/wellbeing/flag-1/status",
            json={"status": "in_progress", "note": "Reaching out this week"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "in_progress"
    item_ref.update.assert_called_once()


def test_transition_invalid_direction_returns_409() -> None:
    db = MagicMock()
    modq = MagicMock()
    item_snap = _make_queue_item(status="open")
    item_ref = MagicMock()
    item_ref.get.return_value = item_snap
    modq.document.return_value = item_ref
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).post(
            "/api/admin/wellbeing/flag-1/status",
            json={"status": "resolved", "note": "Skipping straight to resolved"},
        )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "invalid_transition"


def test_transition_item_not_found_returns_404() -> None:
    db = MagicMock()
    modq = MagicMock()
    missing = MagicMock()
    missing.exists = False
    modq.document.return_value.get.return_value = missing
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).post(
            "/api/admin/wellbeing/no-such/status",
            json={"status": "in_progress", "note": "Test note here"},
        )
    assert r.status_code == 404


def test_transition_wrong_reason_returns_400() -> None:
    db = MagicMock()
    modq = MagicMock()
    # Item exists but is a regular report, not a wellbeing_concern
    item_snap = _make_queue_item(status="pending", reason="harassment")
    item_ref = MagicMock()
    item_ref.get.return_value = item_snap
    modq.document.return_value = item_ref
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).post(
            "/api/admin/wellbeing/flag-1/status",
            json={"status": "in_progress", "note": "Trying to transition a regular report"},
        )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "wrong_reason"


# ── audit trail ───────────────────────────────────────────────────────────────


def test_get_audit_trail_happy_path() -> None:
    db = MagicMock()
    modq = MagicMock()
    item_snap = _make_queue_item(status="in_progress")
    item_ref = MagicMock()
    item_ref.get.return_value = item_snap

    entry = MagicMock()
    entry.to_dict.return_value = {
        "status": "open",
        "note": "(flag filed)",
        "actorUid": "reporter-uid",
        "createdAt": None,
    }
    history_col = MagicMock()
    history_col.order_by.return_value = history_col
    history_col.stream.return_value = [entry]
    item_ref.collection.return_value = history_col
    modq.document.return_value = item_ref
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).get("/api/admin/wellbeing/flag-1/audit")
    assert r.status_code == 200
    body = r.json()
    assert len(body["history"]) == 1
    assert body["history"][0]["status"] == "open"


def test_get_audit_trail_not_found() -> None:
    db = MagicMock()
    modq = MagicMock()
    missing = MagicMock()
    missing.exists = False
    modq.document.return_value.get.return_value = missing
    db.collection.return_value = modq

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing._db", return_value=db),
    ):
        r = TestClient(_moderator_app()).get("/api/admin/wellbeing/no-such/audit")
    assert r.status_code == 404


# ── moderator grant / revoke ──────────────────────────────────────────────────


def _make_fb_user(uid: str, claims: dict[str, Any] | None = None) -> MagicMock:
    fb_user = MagicMock()
    fb_user.uid = uid
    fb_user.email = f"{uid}@test.com"
    fb_user.display_name = uid.title()
    fb_user.custom_claims = claims or {}
    return fb_user


def test_grant_moderator_sets_claim() -> None:
    fb_user = _make_fb_user("target-uid")
    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing.firebase_auth.get_user", return_value=fb_user),
        patch("app.routers.wellbeing.firebase_auth.set_custom_user_claims") as mock_set,
        patch("app.routers.wellbeing.write_audit_log"),
    ):
        r = TestClient(_admin_app()).post(
            "/api/admin/users/target-uid/moderator",
            json={"grant": True},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["moderator"] is True
    mock_set.assert_called_once_with("target-uid", {"moderator": True})


def test_revoke_moderator_removes_claim() -> None:
    fb_user = _make_fb_user("target-uid", claims={"moderator": True})
    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing.firebase_auth.get_user", return_value=fb_user),
        patch("app.routers.wellbeing.firebase_auth.set_custom_user_claims") as mock_set,
        patch("app.routers.wellbeing.write_audit_log"),
    ):
        r = TestClient(_admin_app()).post(
            "/api/admin/users/target-uid/moderator",
            json={"grant": False},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["moderator"] is False
    mock_set.assert_called_once_with("target-uid", {})


def test_grant_moderator_user_not_found_returns_404() -> None:
    from firebase_admin.auth import UserNotFoundError

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch(
            "app.routers.wellbeing.firebase_auth.get_user",
            side_effect=UserNotFoundError("no such user"),
        ),
    ):
        r = TestClient(_admin_app()).post(
            "/api/admin/users/ghost-uid/moderator",
            json={"grant": True},
        )
    assert r.status_code == 404


def test_grant_moderator_requires_admin_not_moderator() -> None:
    r = TestClient(_moderator_app()).post(
        "/api/admin/users/target-uid/moderator",
        json={"grant": True},
    )
    assert r.status_code == 403


# ── list moderators ───────────────────────────────────────────────────────────


def test_list_moderators_happy_path() -> None:
    mod_user = _make_fb_user("mod-uid", claims={"moderator": True})
    plain_user = _make_fb_user("plain-uid", claims={})
    page = MagicMock()
    page.users = [mod_user, plain_user]

    with (
        patch("app.routers.wellbeing.init_firebase_admin"),
        patch("app.routers.wellbeing.firebase_auth.list_users", return_value=page),
    ):
        r = TestClient(_admin_app()).get("/api/admin/moderators")
    assert r.status_code == 200
    body = r.json()
    assert len(body["moderators"]) == 1
    assert body["moderators"][0]["uid"] == "mod-uid"
