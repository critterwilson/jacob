"""Tests for the discover and join-request router (T30)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.discover import router


def _make_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _mock_group_snap(
    gid: str = "g1",
    is_private: bool = False,
    join_mode: str = "open",
    exists: bool = True,
) -> MagicMock:
    snap = MagicMock()
    snap.id = gid
    snap.exists = exists
    snap.to_dict.return_value = {
        "name": f"Group {gid}",
        "description": "desc",
        "memberCount": 5,
        "isPrivate": is_private,
        "joinMode": join_mode,
        "audience": "christian",
        "createdAt": None,
    }
    return snap


def _make_db(
    *,
    group_exists: bool = True,
    is_private: bool = False,
    join_mode: str = "open",
    member_exists: bool = False,
    member_role: str = "member",
    jr_exists: bool = False,
    jr_status: str = "pending",
) -> MagicMock:
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.return_value = groups_col

    group_snap = _mock_group_snap(is_private=is_private, join_mode=join_mode, exists=group_exists)
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.id = "alice"
    member_snap.to_dict.return_value = {"role": member_role}

    jr_snap = MagicMock()
    jr_snap.exists = jr_exists
    jr_snap.to_dict.return_value = {"status": jr_status, "message": "", "requestedAt": None}

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    members_col.where.return_value.limit.return_value.stream.return_value = iter([member_snap])

    jr_col = MagicMock()
    jr_col.document.return_value.get.return_value = jr_snap
    (jr_col.where.return_value.order_by.return_value.limit.return_value.stream).return_value = iter(
        []
    )

    def _subcol(name: str) -> MagicMock:
        if name == "members":
            return members_col
        if name == "joinRequests":
            return jr_col
        return MagicMock()

    group_ref.collection.side_effect = _subcol

    list_snap = _mock_group_snap()
    list_snap_col = MagicMock()
    (
        list_snap_col.where.return_value.order_by.return_value.order_by.return_value.limit.return_value.stream
    ).return_value = iter([list_snap])

    db.collection.side_effect = lambda name: list_snap_col if name == "groups" else MagicMock()

    db.transaction.return_value = MagicMock()
    return db


# ── GET /api/discover/groups ─────────────────────────────────────────────────


def test_discover_lists_only_public() -> None:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value = col

    public_snap = _mock_group_snap("g1", is_private=False)
    (
        col.where.return_value.order_by.return_value.order_by.return_value.limit.return_value.stream
    ).return_value = iter([public_snap])
    col.document.return_value = MagicMock(get=MagicMock(return_value=public_snap))
    public_snap.id = "g1"

    leader_snap = MagicMock()
    leader_snap.id = "alice"
    members_col = MagicMock()
    members_col.where.return_value.limit.return_value.stream.return_value = iter([leader_snap])

    group_ref = MagicMock()
    group_ref.get.return_value = public_snap
    group_ref.collection.return_value = members_col
    col.document.return_value = group_ref

    with patch("app.routers.discover._db", return_value=db):
        client = TestClient(_make_app())
        res = client.get("/api/discover/groups", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    data = res.json()
    assert "groups" in data


def test_discover_audience_filter() -> None:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value = col
    (
        col.where.return_value.order_by.return_value.order_by.return_value.where.return_value.limit.return_value.stream
    ).return_value = iter([])

    with patch("app.routers.discover._db", return_value=db):
        client = TestClient(_make_app())
        res = client.get(
            "/api/discover/groups?audience=bjj",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200


def test_discover_pagination_cursor() -> None:
    db = MagicMock()
    col = MagicMock()
    db.collection.return_value = col
    cursor_snap = MagicMock()
    cursor_snap.exists = True
    col.document.return_value.get.return_value = cursor_snap
    (
        col.where.return_value.order_by.return_value.order_by.return_value.start_after.return_value.limit.return_value.stream
    ).return_value = iter([])

    with patch("app.routers.discover._db", return_value=db):
        client = TestClient(_make_app())
        res = client.get(
            "/api/discover/groups?cursor=g0",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200


# ── POST /api/groups/{gid}/join-requests ─────────────────────────────────────


def test_join_request_open_group_joins_directly() -> None:
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.return_value = groups_col

    group_snap = _mock_group_snap(join_mode="open")
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = False
    group_ref.collection.return_value.document.return_value.get.return_value = member_snap

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.post(
            "/api/groups/g1/join-requests",
            json={"message": ""},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["joined"] is True


def test_join_request_request_mode_writes_pending() -> None:
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.return_value = groups_col

    group_snap = _mock_group_snap(join_mode="request")
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = False

    jr_snap = MagicMock()
    jr_snap.exists = False

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "members":
            sub.document.return_value.get.return_value = member_snap
        elif name == "joinRequests":
            sub.document.return_value.get.return_value = jr_snap
        return sub

    group_ref.collection.side_effect = _subcol

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.post(
            "/api/groups/g1/join-requests",
            json={"message": "Let me in!"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["pending"] is True


# ── POST .../approve ──────────────────────────────────────────────────────────


def test_approve_join_request_adds_member() -> None:
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.return_value = groups_col

    group_snap = _mock_group_snap()
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "leader"}

    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {"status": "pending"}

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "members":
            sub.document.return_value.get.return_value = member_snap
        elif name == "joinRequests":
            sub.document.return_value.get.return_value = jr_snap
        return sub

    group_ref.collection.side_effect = _subcol
    db.transaction.return_value = MagicMock()

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
    ):
        client = TestClient(_make_app(uid="leader"))
        res = client.post(
            "/api/groups/g1/join-requests/bob/approve",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"


def test_approve_join_request_not_leader_returns_403() -> None:
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.return_value = groups_col

    group_snap = _mock_group_snap()
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "member"}
    group_ref.collection.return_value.document.return_value.get.return_value = member_snap

    with patch("app.routers.discover._db", return_value=db):
        client = TestClient(_make_app(uid="non-leader"))
        res = client.post(
            "/api/groups/g1/join-requests/bob/approve",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


# ── 403 banned coverage (PR1 sweep) ─────────────────────────────────────────


def test_create_join_request_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/join-requests", json={"message": ""})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_approve_join_request_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/join-requests/bob/approve")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_reject_join_request_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/join-requests/bob/reject")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"
