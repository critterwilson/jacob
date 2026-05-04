"""Tests for `POST /api/groups/{gid}/messages` (M4)."""

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
from app.routers.messages import router as messages_router


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
    app.include_router(messages_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _build_db(
    *,
    member: bool = True,
    archived: bool = False,
    parent_exists: bool = True,
    parent_id: str | None = None,
    banned: bool = False,
) -> MagicMock:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "isPrivate": False,
        "name": "G",
        "archivedAt": datetime.now(UTC) if archived else None,
    }
    member_snap = MagicMock()
    member_snap.exists = member
    member_snap.to_dict.return_value = {"role": "member"}
    bans_snap = MagicMock()
    bans_snap.exists = banned
    bans_snap.to_dict.return_value = {
        "expiresAt": datetime.now(UTC) + timedelta(days=10) if banned else None
    }
    parent_snap = MagicMock()
    parent_snap.exists = parent_exists

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap

    new_msg_ref = MagicMock()
    fresh_snap = MagicMock()
    fresh_snap.id = "new-mid"
    fresh_snap.to_dict.return_value = {
        "authorUid": "alice",
        "body": "hi",
        "stickerIds": [],
        "mediaRefs": [],
        "createdAt": datetime.now(UTC),
        "editedAt": None,
        "deletedAt": None,
        "parentMessageId": parent_id,
        "threadReplyCount": 0,
        "reactionCounts": {},
    }
    new_msg_ref.get.return_value = fresh_snap

    msgs_col = MagicMock()
    msgs_col.document.return_value = new_msg_ref
    if parent_id is not None:
        msgs_col.document.side_effect = lambda *args: (
            MagicMock(get=MagicMock(return_value=parent_snap)) if args else new_msg_ref
        )

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.side_effect = lambda name: (members_col if name == "members" else msgs_col)

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


def test_create_message_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/groups/g1/messages",
            json={"body": "hi", "stickerIds": ["check-in"], "mediaRefs": []},
        )
    assert res.status_code == 201
    body = res.json()
    assert body["id"] == "new-mid"
    assert body["body"] == "hi"


def test_create_message_403_for_non_member() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db(member=False)
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages", json={"body": "hi"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_member"


def test_create_message_409_archived() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db(archived=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages", json={"body": "hi"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "archived"


def test_create_message_403_banned() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db(banned=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages", json={"body": "hi"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_create_message_422_body_too_long() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db()
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages", json={"body": "x" * 4001})
    assert res.status_code == 422


def test_create_message_422_too_many_stickers() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db()
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/groups/g1/messages",
            json={"body": "hi", "stickerIds": ["a", "b", "c", "d", "e", "f"]},
        )
    assert res.status_code == 422


def test_create_message_422_extra_keys() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db()
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/groups/g1/messages",
            json={"body": "hi", "rogueField": "no"},
        )
    assert res.status_code == 422


def test_create_message_422_bad_media_url() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _build_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/groups/g1/messages",
            json={"body": "hi", "mediaRefs": ["https://evil.example.com/bad.png"]},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_media_ref"


def test_create_message_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.post("/api/groups/g1/messages", json={"body": "hi"})
    assert res.status_code == 401
