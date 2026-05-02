"""Tests for the groups router.

firebase_admin and _db are mocked so tests never hit Firestore or
Google's auth endpoints. `get_current_user` is overridden via
FastAPI's dependency-override mechanism so the router sees a real
CurrentUser without touching firebase_admin.auth.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.groups import router


def _make_app(uid: str = "alice") -> FastAPI:
    """Return a minimal FastAPI app with the groups router and a mocked user."""
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _make_db(
    *,
    stream_results: list[object] | None = None,
    member_exists: bool = False,
    group_exists: bool = True,
    member_role: str = "leader",
) -> MagicMock:
    db = MagicMock()

    groups_col = MagicMock()
    users_col = MagicMock()

    def _col(name: str) -> MagicMock:
        return groups_col if name == "groups" else users_col

    db.collection.side_effect = _col

    groups_col.where.return_value.limit.return_value.stream.return_value = iter(
        stream_results or []
    )

    group_ref = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = group_exists
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.get.return_value = member_role
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref

    db.batch.return_value = MagicMock()
    return db


# ── POST /api/groups ─────────────────────────────────────────────────────────

def test_create_group_happy_path() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="TESTCODE1"),
    ):
        res = TestClient(_make_app()).post(
            "/api/groups",
            json={"name": "My Group", "description": "A test group", "isPrivate": False},
        )

    assert res.status_code == 201
    body = res.json()
    assert "groupId" in body
    assert body["inviteCode"] == "TESTCODE1"
    mock_db.batch.return_value.commit.assert_called_once()


def test_create_group_empty_name_returns_422() -> None:
    with patch("app.routers.groups._db", return_value=_make_db()):
        res = TestClient(_make_app()).post("/api/groups", json={"name": ""})

    assert res.status_code == 422


def test_create_group_strips_and_stores_name() -> None:
    mock_db = _make_db()
    captured: list[object] = []

    def _capture_batch() -> MagicMock:
        b = MagicMock()

        def _set(ref: object, data: object, **_kwargs: object) -> None:
            captured.append(data)

        b.set.side_effect = _set
        return b

    mock_db.batch.side_effect = _capture_batch

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="CODE1234"),
    ):
        res = TestClient(_make_app()).post("/api/groups", json={"name": "  Padded  "})

    assert res.status_code == 201
    group_doc = next(
        (d for d in captured if isinstance(d, dict) and "name" in d), None
    )
    assert group_doc is not None
    assert group_doc["name"] == "Padded"


# ── POST /api/groups/join ─────────────────────────────────────────────────────

def test_join_group_happy_path() -> None:
    mock_snap = MagicMock()
    mock_snap.id = "group-abc"
    mock_db = _make_db(stream_results=[mock_snap], member_exists=False)

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app("bob")).post(
            "/api/groups/join", json={"code": "TESTCODE1"}
        )

    assert res.status_code == 200
    assert res.json()["groupId"] == "group-abc"
    mock_db.batch.return_value.commit.assert_called_once()


def test_join_invalid_code_returns_404() -> None:
    mock_db = _make_db(stream_results=[])

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post(
            "/api/groups/join", json={"code": "BADCODE1"}
        )

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "invalid_invite"


def test_join_already_member_returns_409() -> None:
    mock_snap = MagicMock()
    mock_snap.id = "group-abc"
    mock_db = _make_db(stream_results=[mock_snap], member_exists=True)

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post(
            "/api/groups/join", json={"code": "TESTCODE1"}
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_member"


# ── POST /api/groups/{gid}/invite/rotate ─────────────────────────────────────

def test_rotate_invite_happy_path() -> None:
    mock_db = _make_db(group_exists=True, member_exists=True, member_role="leader")

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="NEWCODE12"),
    ):
        res = TestClient(_make_app()).post("/api/groups/gid-001/invite/rotate")

    assert res.status_code == 200
    assert res.json()["inviteCode"] == "NEWCODE12"


def test_rotate_invite_non_leader_returns_403() -> None:
    mock_db = _make_db(group_exists=True, member_exists=True, member_role="member")

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app("bob")).post("/api/groups/gid-001/invite/rotate")

    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_rotate_invite_group_not_found_returns_404() -> None:
    mock_db = _make_db(group_exists=False)

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/ghost-gid/invite/rotate")

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "group_not_found"
