"""Tests for the M3 board post + reply read endpoints."""

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
from app.routers.boards import router as boards_router


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
    app.include_router(boards_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _post_snap(
    *,
    pid: str,
    author: str = "bob",
    body: str = "post body",
    deleted: bool = False,
    moderation: str | None = None,
) -> MagicMock:
    snap = MagicMock()
    snap.id = pid
    snap.exists = True
    data: dict = {
        "authorUid": author,
        "body": body,
        "createdAt": datetime(2026, 5, 1, tzinfo=UTC),
    }
    if deleted:
        data["deletedAt"] = datetime(2026, 5, 2, tzinfo=UTC)
    if moderation:
        data["moderation"] = {"state": moderation, "reasons": []}
    snap.to_dict.return_value = data
    return snap


def test_list_board_posts_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    posts_col = (
        db.collection.return_value.document.return_value.collection.return_value
    )
    snaps = [
        _post_snap(pid="p1", body="first"),
        _post_snap(pid="p2", body="second"),
    ]
    chain = (
        posts_col.where.return_value.order_by.return_value.order_by.return_value
    )
    chain.limit.return_value.stream.return_value = iter(snaps)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts")
    assert res.status_code == 200
    body = res.json()
    assert [p["postId"] for p in body["posts"]] == ["p1", "p2"]
    assert body["nextCursor"] is None


def test_list_board_posts_filters_hidden_unless_author() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    posts_col = (
        db.collection.return_value.document.return_value.collection.return_value
    )
    snaps = [
        _post_snap(pid="p1", body="ok"),
        _post_snap(pid="hidden-other", author="bob", moderation="hidden"),
        _post_snap(pid="hidden-mine", author="alice", moderation="hidden"),
    ]
    chain = (
        posts_col.where.return_value.order_by.return_value.order_by.return_value
    )
    chain.limit.return_value.stream.return_value = iter(snaps)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts")
    assert res.status_code == 200
    ids = {p["postId"] for p in res.json()["posts"]}
    assert ids == {"p1", "hidden-mine"}


def test_get_board_post_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    snap = MagicMock()
    snap.exists = False
    db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = (
        snap
    )
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts/nope")
    assert res.status_code == 404


def test_get_board_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    snap = _post_snap(pid="p1", body="hi")
    db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = (
        snap
    )
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts/p1")
    assert res.status_code == 200
    assert res.json()["postId"] == "p1"


def test_list_board_replies_filters_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    replies_col = MagicMock()

    def _coll_chain(name: str = ""):  # noqa: ARG001
        return MagicMock(document=MagicMock(return_value=MagicMock(collection=MagicMock(
            return_value=replies_col
        ))))

    db.collection.return_value.document.return_value.collection.return_value.document.return_value.collection.return_value = (
        replies_col
    )
    snaps = [
        _post_snap(pid="r1", body="r1"),
        _post_snap(pid="r-deleted", deleted=True),
    ]
    chain = replies_col.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts/p1/replies")
    assert res.status_code == 200
    ids = {r["replyId"] for r in res.json()["replies"]}
    assert ids == {"r1"}


def test_list_board_posts_invalid_cursor_is_400() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts?cursor=!!!")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_cursor"


def test_list_board_posts_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/boards/b1/posts")
    assert res.status_code == 401
