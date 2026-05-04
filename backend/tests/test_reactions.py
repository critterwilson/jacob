"""Tests for `POST/DELETE /api/groups/{gid}/messages/{mid}/reactions/{slug}` (M4)."""

from __future__ import annotations

from datetime import UTC, datetime
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


def _make_db(
    *,
    sticker_exists: bool = True,
    msg_exists: bool = True,
    msg_deleted: bool = False,
    archived: bool = False,
    member: bool = True,
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
    bans_snap.exists = False

    msg_snap = MagicMock()
    msg_snap.id = "m1"
    msg_snap.exists = msg_exists
    msg_snap.to_dict.return_value = {
        "authorUid": "bob",
        "body": "hi",
        "deletedAt": datetime.now(UTC) if msg_deleted else None,
        "reactionCounts": {"check-in": 1},
    }
    msg_ref = MagicMock()
    msg_ref.get.return_value = msg_snap
    reaction_user_ref = MagicMock()
    reactions_col = msg_ref.collection.return_value
    users_under_reaction = reactions_col.document.return_value.collection.return_value
    users_under_reaction.document.return_value = reaction_user_ref

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    msgs_col = MagicMock()
    msgs_col.document.return_value = msg_ref

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.side_effect = lambda name: (members_col if name == "members" else msgs_col)

    sticker_snap = MagicMock()
    sticker_snap.exists = sticker_exists
    sticker_ref = MagicMock()
    sticker_ref.get.return_value = sticker_snap

    bans_ref = MagicMock()
    bans_ref.get.return_value = bans_snap

    def _coll(name: str):
        if name == "groups":
            return MagicMock(document=MagicMock(return_value=group_ref))
        if name == "stickers":
            return MagicMock(document=MagicMock(return_value=sticker_ref))
        if name == "bans":
            return MagicMock(document=MagicMock(return_value=bans_ref))
        return MagicMock()

    db.collection.side_effect = _coll
    return db


def test_react_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 201
    body = res.json()
    assert body["uid"] == "alice"
    assert body["slug"] == "check-in"
    assert body["reactionCounts"] == {"check-in": 1}


def test_react_404_sticker_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(sticker_exists=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/m1/reactions/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "sticker_not_found"


def test_react_404_message_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(msg_exists=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/missing/reactions/check-in")
    assert res.status_code == 404


def test_react_409_message_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(msg_deleted=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "message_deleted"


def test_react_409_archived_group() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(archived=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "archived"


def test_unreact_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 200
    body = res.json()
    assert "reactionCounts" in body


def test_react_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.post("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 401


def test_react_403_for_non_member() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(member=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 403


def test_unreact_403_for_non_member() -> None:
    """PR5: non-members get 403 from require_member rather than touching the
    reactions subcollection. Closes the leak where non-members could probe
    message existence via the reaction-count response."""
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _make_db(member=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1/reactions/check-in")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_member"
