"""Tests for POST /api/groups/{gid}/moderation-policy (T20)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser


def _client(uid: str = "alice", admin_claim: bool = False) -> TestClient:
    from app.routers.groups import router

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={"admin": True} if admin_claim else {}
    )
    return TestClient(app, raise_server_exceptions=False)


def _build_db(*, role: str | None, group_exists: bool = True) -> MagicMock:
    db = MagicMock()
    member_snap = MagicMock()
    member_snap.exists = role is not None
    member_snap.to_dict.return_value = {"role": role} if role else {}

    group_snap = MagicMock()
    group_snap.exists = group_exists

    members_doc = MagicMock()
    members_doc.get.return_value = member_snap
    members_col = MagicMock()
    members_col.document.return_value = members_doc

    group_doc = MagicMock()
    group_doc.collection.return_value = members_col
    group_doc.get.return_value = group_snap

    groups_col = MagicMock()
    groups_col.document.return_value = group_doc

    audit_col = MagicMock()

    def _col(name: str) -> MagicMock:
        return {"groups": groups_col, "audit_log": audit_col}.get(name, MagicMock())

    db.collection.side_effect = _col
    return db


def test_leader_can_set_policy() -> None:
    db = _build_db(role="leader")
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        r = _client("alice").post(
            "/api/groups/g1/moderation-policy",
            json={"policy": "strict"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body == {"gid": "g1", "policy": "strict"}


def test_member_cannot_set_policy() -> None:
    db = _build_db(role="member")
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("bob").post(
            "/api/groups/g1/moderation-policy",
            json={"policy": "lenient"},
        )
    assert r.status_code == 403


def test_non_member_cannot_set_policy() -> None:
    db = _build_db(role=None)
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("eve").post(
            "/api/groups/g1/moderation-policy",
            json={"policy": "lenient"},
        )
    assert r.status_code == 403


def test_platform_admin_bypasses_membership_check() -> None:
    db = _build_db(role=None)
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        r = _client("god", admin_claim=True).post(
            "/api/groups/g1/moderation-policy",
            json={"policy": "lenient"},
        )
    assert r.status_code == 200


def test_invalid_policy_returns_422() -> None:
    r = _client("alice").post(
        "/api/groups/g1/moderation-policy",
        json={"policy": "extreme"},
    )
    assert r.status_code == 422


def test_missing_group_returns_404() -> None:
    db = _build_db(role="leader", group_exists=False)
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("alice").post(
            "/api/groups/g-missing/moderation-policy",
            json={"policy": "standard"},
        )
    assert r.status_code == 404


def test_set_policy_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        r = _client("alice").post("/api/groups/g1/moderation-policy", json={"policy": "standard"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "banned"
