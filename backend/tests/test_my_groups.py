"""Tests for `GET /api/users/me/groups` (M3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
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


def _member_snap(*, gid: str, uid: str, role: str, joined_at: datetime) -> MagicMock:
    """Build a member-doc snap whose `reference.parent.parent.id == gid`."""
    snap = MagicMock()
    snap.to_dict.return_value = {"role": role, "uid": uid, "joinedAt": joined_at}
    parent_group = MagicMock()
    parent_group.id = gid
    snap.reference.parent.parent = parent_group
    return snap


def _group_doc(
    gid: str,
    *,
    name: str,
    archived_at: datetime | None = None,
    member_count: int = 1,
    is_private: bool = False,
) -> MagicMock:
    doc = MagicMock()
    doc.id = gid
    doc.exists = True
    doc.to_dict.return_value = {
        "name": name,
        "description": "",
        "memberCount": member_count,
        "archivedAt": archived_at,
        "isPrivate": is_private,
    }
    return doc


def test_my_groups_returns_summaries_for_each_membership() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    joined = datetime(2026, 5, 1, tzinfo=UTC)
    db = MagicMock()
    member_snaps = [
        _member_snap(gid="g1", uid="alice", role="leader", joined_at=joined),
        _member_snap(gid="g2", uid="alice", role="member", joined_at=joined),
    ]
    db.collection_group.return_value.where.return_value.stream.return_value = iter(member_snaps)
    db.get_all.return_value = [
        _group_doc("g1", name="Alpha", member_count=3),
        _group_doc("g2", name="Beta", member_count=8),
    ]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/groups")
    assert res.status_code == 200
    body = res.json()
    by_gid = {g["gid"]: g for g in body["groups"]}
    assert by_gid["g1"]["role"] == "leader"
    assert by_gid["g1"]["name"] == "Alpha"
    assert by_gid["g1"]["memberCount"] == 3
    assert by_gid["g2"]["role"] == "member"


def test_my_groups_excludes_old_archives_by_default() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    joined = datetime(2026, 5, 1, tzinfo=UTC)
    long_ago = datetime.now(UTC) - timedelta(days=120)  # >60 days
    recent = datetime.now(UTC) - timedelta(days=10)  # <60 days
    db = MagicMock()
    member_snaps = [
        _member_snap(gid="old", uid="alice", role="member", joined_at=joined),
        _member_snap(gid="recent", uid="alice", role="member", joined_at=joined),
    ]
    db.collection_group.return_value.where.return_value.stream.return_value = iter(member_snaps)
    db.get_all.return_value = [
        _group_doc("old", name="Old", archived_at=long_ago),
        _group_doc("recent", name="Recent", archived_at=recent),
    ]
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/groups")
    assert res.status_code == 200
    gids = {g["gid"] for g in res.json()["groups"]}
    assert gids == {"recent"}


def test_my_groups_archived_include_returns_all() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    joined = datetime(2026, 5, 1, tzinfo=UTC)
    long_ago = datetime.now(UTC) - timedelta(days=120)
    db = MagicMock()
    db.collection_group.return_value.where.return_value.stream.return_value = iter(
        [_member_snap(gid="old", uid="alice", role="member", joined_at=joined)]
    )
    db.get_all.return_value = [_group_doc("old", name="Old", archived_at=long_ago)]
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/groups?archived=include")
    assert res.status_code == 200
    assert {g["gid"] for g in res.json()["groups"]} == {"old"}


def test_my_groups_returns_empty_when_no_memberships() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    db.collection_group.return_value.where.return_value.stream.return_value = iter([])
    db.get_all.return_value = []
    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/groups")
    assert res.status_code == 200
    assert res.json() == {"groups": []}


def test_my_groups_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/users/me/groups")
    assert res.status_code == 401


def test_my_groups_invalid_archived_value_is_422() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    client = TestClient(_app(user))
    res = client.get("/api/users/me/groups?archived=bogus")
    assert res.status_code == 422
