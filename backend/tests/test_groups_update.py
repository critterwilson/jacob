"""Tests for `PATCH /api/groups/{gid}` (M4 group metadata update)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.groups import router as groups_router


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
    app.include_router(groups_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _make_db(*, role: str = "leader") -> MagicMock:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "name": "Old",
        "description": "",
        "isPrivate": False,
        "memberCount": 1,
        "leaderCount": 1,
        "founderUid": "alice",
        "createdBy": "alice",
        "inviteCode": "X",
        "stickerSet": "christian",
        "pinnedMessageIds": [],
        "archivedAt": None,
    }
    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": role}
    bans_snap = MagicMock()
    bans_snap.exists = False

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.return_value = members_col
    bans_ref = MagicMock()
    bans_ref.get.return_value = bans_snap

    def _coll(name: str):
        if name == "groups":
            return MagicMock(document=MagicMock(return_value=group_ref))
        if name == "bans":
            return MagicMock(document=MagicMock(return_value=bans_ref))
        return MagicMock()

    db.collection.side_effect = _coll
    return db


def test_update_group_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log") as audit,
    ):
        client = TestClient(_app(user))
        res = client.patch(
            "/api/groups/g1",
            json={"name": "New Name", "description": "Updated"},
        )
    assert res.status_code == 200
    audit.assert_called_once()
    payload = audit.call_args.kwargs.get("payload") or audit.call_args.args[3]
    assert "changedKeys" in payload
    assert set(payload["changedKeys"]) == {"name", "description"}


def test_update_group_403_non_leader() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(role="member")
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1", json={"name": "x"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_leader"


def test_update_group_422_empty_body() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1", json={})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "empty_update"


def test_update_group_422_extra_keys() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1", json={"archivedAt": "2026-05-01"})
    assert res.status_code == 422


def test_update_group_422_bad_avatar_url() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.patch(
            "/api/groups/g1",
            json={"avatarUrl": "https://malicious.example.com/x.png"},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_avatar_url"


def test_update_group_422_pinned_message_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    # All passed pinnedMessageIds resolve to docs that don't exist.
    missing_doc = MagicMock(id="m-missing", exists=False)
    db.get_all.return_value = [missing_doc]
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.patch(
            "/api/groups/g1",
            json={"pinnedMessageIds": ["m-missing"]},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "pinned_message_missing"


def test_update_group_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.patch("/api/groups/g1", json={"name": "x"})
    assert res.status_code == 401
