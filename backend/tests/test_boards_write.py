"""Tests for the M4 board post / reply / reaction write endpoints."""

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


def _post_data(*, body: str = "post", deleted: bool = False) -> dict:
    return {
        "authorUid": "alice",
        "body": body,
        "stickerIds": ["pray"],
        "mediaRefs": [],
        "createdAt": datetime.now(UTC),
        "editedAt": None,
        "deletedAt": datetime.now(UTC) if deleted else None,
        "pinnedAt": None,
        "pinnedBy": None,
        "replyCount": 0,
    }


def _make_db(
    *,
    archived: bool = False,
    post_exists: bool = True,
    post_data: dict | None = None,
    sticker_exists: bool = True,
    banned: bool = False,
) -> tuple[MagicMock, MagicMock]:
    db = MagicMock()
    board_snap = MagicMock()
    board_snap.exists = True
    board_snap.to_dict.return_value = {
        "name": "B",
        "archivedAt": datetime.now(UTC) if archived else None,
    }
    bans_snap = MagicMock()
    bans_snap.exists = banned

    new_post_ref = MagicMock()
    new_post_snap = MagicMock()
    new_post_snap.id = "new-pid"
    new_post_snap.to_dict.return_value = _post_data(body="hi")
    new_post_ref.get.return_value = new_post_snap

    existing_post_ref = MagicMock()
    existing_post_snap = MagicMock()
    existing_post_snap.id = "p1"
    existing_post_snap.exists = post_exists
    existing_post_snap.to_dict.return_value = post_data or _post_data()
    existing_post_ref.get.return_value = existing_post_snap

    posts_col = MagicMock()
    posts_col.document.side_effect = lambda *args: (existing_post_ref if args else new_post_ref)

    board_ref = MagicMock()
    board_ref.get.return_value = board_snap
    board_ref.collection.return_value = posts_col

    sticker_snap = MagicMock()
    sticker_snap.exists = sticker_exists
    sticker_ref = MagicMock()
    sticker_ref.get.return_value = sticker_snap

    bans_ref = MagicMock()
    bans_ref.get.return_value = bans_snap

    def _coll(name: str):
        if name == "boards":
            return MagicMock(document=MagicMock(return_value=board_ref))
        if name == "stickers":
            return MagicMock(document=MagicMock(return_value=sticker_ref))
        if name == "bans":
            return MagicMock(document=MagicMock(return_value=bans_ref))
        return MagicMock()

    db.collection.side_effect = _coll
    db.transaction.return_value = MagicMock()
    return db, existing_post_ref


# ── posts ────────────────────────────────────────────────────────────────


def test_create_board_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/boards/b1/posts",
            json={"body": "hi", "stickerIds": ["pray"], "mediaRefs": []},
        )
    assert res.status_code == 201
    body = res.json()
    assert body["postId"] == "new-pid"


def test_create_board_post_409_archived() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db(archived=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/boards/b1/posts", json={"body": "hi", "stickerIds": ["pray"]})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "archived"


def test_create_board_post_422_no_stickers() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/boards/b1/posts", json={"body": "hi", "stickerIds": []})
    assert res.status_code == 422


def test_create_board_post_403_banned() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    bans_snap = MagicMock()
    bans_snap.exists = True
    bans_snap.to_dict.return_value = {
        "expiresAt": datetime(9999, 1, 1, tzinfo=UTC),
    }
    bans_ref = MagicMock()
    bans_ref.get.return_value = bans_snap

    def _coll(name: str):
        if name == "bans":
            return MagicMock(document=MagicMock(return_value=bans_ref))
        return MagicMock()

    db.collection.side_effect = _coll
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.post("/api/boards/b1/posts", json={"body": "hi", "stickerIds": ["pray"]})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_create_board_post_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.post("/api/boards/b1/posts", json={"body": "hi", "stickerIds": ["pray"]})
    assert res.status_code == 401


# ── post edit / delete ────────────────────────────────────────────────────


def test_edit_board_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/boards/b1/posts/p1", json={"body": "edited"})
    assert res.status_code == 200


def test_delete_board_post_idempotent() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db(post_data=_post_data(deleted=True))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
        patch("app.routers.boards.write_audit_log") as audit,
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/boards/b1/posts/p1")
    assert res.status_code == 200
    audit.assert_not_called()


def test_delete_board_post_writes_audit_log() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
        patch("app.routers.boards.write_audit_log") as audit,
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/boards/b1/posts/p1")
    assert res.status_code == 200
    assert res.json()["body"] == ""  # redacted
    audit.assert_called_once()


# ── replies ───────────────────────────────────────────────────────────────


def test_create_reply_404_when_post_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db(post_exists=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/boards/b1/posts/p1/replies",
            json={"body": "hi"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "post_not_found"


def test_create_reply_409_when_post_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db(post_data=_post_data(deleted=True))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/boards/b1/posts/p1/replies",
            json={"body": "hi"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "post_deleted"


# ── reactions ─────────────────────────────────────────────────────────────


def test_react_to_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/boards/b1/posts/p1/reactions/pray")
    assert res.status_code == 201
    body = res.json()
    assert body["uid"] == "alice"
    assert body["slug"] == "pray"


def test_react_to_post_404_sticker_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db(sticker_exists=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/boards/b1/posts/p1/reactions/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "sticker_not_found"


def test_unreact_to_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.boards._db", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/boards/b1/posts/p1/reactions/pray")
    assert res.status_code == 200
