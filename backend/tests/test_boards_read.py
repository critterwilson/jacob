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
    posts_col = db.collection.return_value.document.return_value.collection.return_value
    snaps = [
        _post_snap(pid="p1", body="first"),
        _post_snap(pid="p2", body="second"),
    ]
    chain = posts_col.where.return_value.order_by.return_value.order_by.return_value
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
    posts_col = db.collection.return_value.document.return_value.collection.return_value
    snaps = [
        _post_snap(pid="p1", body="ok"),
        _post_snap(pid="hidden-other", author="bob", moderation="hidden"),
        _post_snap(pid="hidden-mine", author="alice", moderation="hidden"),
    ]
    chain = posts_col.where.return_value.order_by.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts")
    assert res.status_code == 200
    ids = {p["postId"] for p in res.json()["posts"]}
    assert ids == {"p1", "hidden-mine"}


def _post_doc_get_returns(db: MagicMock, snap: MagicMock) -> None:
    """Wire `db.collection("boards").document(b).collection("posts").document(p).get()` → snap."""
    boards = db.collection.return_value
    posts = boards.document.return_value.collection.return_value
    posts.document.return_value.get.return_value = snap


def test_get_board_post_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    snap = MagicMock()
    snap.exists = False
    _post_doc_get_returns(db, snap)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts/nope")
    assert res.status_code == 404


def test_get_board_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    snap = _post_snap(pid="p1", body="hi")
    _post_doc_get_returns(db, snap)
    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts/p1")
    assert res.status_code == 200
    assert res.json()["postId"] == "p1"


def test_list_board_replies_filters_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    replies_col = MagicMock()
    # Wire db.collection("boards").document(b).collection("posts")
    #     .document(p).collection("replies") → replies_col
    posts = db.collection.return_value.document.return_value.collection.return_value
    posts.document.return_value.collection.return_value = replies_col
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


# ── M-BACK-6: cursor tie-break (start_after on createdAt + __name__) ────


def test_list_board_posts_cursor_passes_doc_id_for_tie_break() -> None:
    """When a cursor is provided the query orders by __name__ in addition
    to pinnedAt/createdAt, and start_after gets all three fields — so
    posts with identical createdAt at the page boundary don't drop or
    duplicate on page 2."""
    import base64

    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    posts_col = db.collection.return_value.document.return_value.collection.return_value
    where_chain = posts_col.where.return_value.order_by.return_value.order_by.return_value
    name_order_chain = where_chain.order_by.return_value
    name_order_chain.start_after.return_value.limit.return_value.stream.return_value = iter([])

    base = datetime(2026, 5, 1, tzinfo=UTC)
    cursor_str = (
        base64.urlsafe_b64encode(f"{base.isoformat()}|p-cursor".encode())
        .decode("ascii")
        .rstrip("=")
    )

    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get(f"/api/boards/b1/posts?cursor={cursor_str}")
    assert res.status_code == 200

    # The query chain MUST include order_by("__name__", ...) before start_after.
    # And start_after MUST receive createdAt AND __name__ (plus the existing
    # pinnedAt anchor).
    name_order_calls = where_chain.order_by.call_args_list
    assert any(
        "__name__" in (call.args + tuple(call.kwargs.values())) for call in name_order_calls
    ), "expected order_by('__name__', ...) for cursor tie-break"
    sa_calls = name_order_chain.start_after.call_args_list
    assert sa_calls, "expected start_after call after the __name__ order_by"
    arg = sa_calls[0].args[0]
    assert "createdAt" in arg
    assert "__name__" in arg
    assert arg["__name__"] == "p-cursor"


# ── L1: page boundary inside the pinned bucket carries pinnedAt forward ───


def _post_snap_with_pinned(
    *, pid: str, pinned_at: datetime | None, created_at: datetime
) -> MagicMock:
    snap = MagicMock()
    snap.id = pid
    snap.exists = True
    snap.to_dict.return_value = {
        "authorUid": "bob",
        "body": "x",
        "createdAt": created_at,
        "pinnedAt": pinned_at,
    }
    return snap


def test_list_board_posts_next_cursor_encodes_pinned_at() -> None:
    """When a page boundary falls inside the pinned bucket (the last item
    on the page has a non-null pinnedAt), the emitted cursor must encode
    that pinnedAt so page 2's start_after can resume inside the bucket.
    Without this, page 2 would skip the rest of the pinned posts.
    """
    import base64

    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    posts_col = db.collection.return_value.document.return_value.collection.return_value

    pinned_a = datetime(2026, 5, 3, tzinfo=UTC)
    pinned_b = datetime(2026, 5, 2, tzinfo=UTC)
    created_a = datetime(2026, 5, 1, tzinfo=UTC)
    created_b = datetime(2026, 4, 30, tzinfo=UTC)
    # Three snaps: limit=2 ⇒ has_more, last returned is still pinned.
    snaps = [
        _post_snap_with_pinned(pid="p1", pinned_at=pinned_a, created_at=created_a),
        _post_snap_with_pinned(pid="p2", pinned_at=pinned_b, created_at=created_b),
        _post_snap_with_pinned(pid="p3", pinned_at=None, created_at=created_b),
    ]
    chain = posts_col.where.return_value.order_by.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)

    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/boards/b1/posts?limit=2")
    assert res.status_code == 200
    body = res.json()
    assert [p["postId"] for p in body["posts"]] == ["p1", "p2"]
    assert body["nextCursor"], "expected a next cursor with more pages"

    # The cursor must round-trip to (createdAt, doc_id, pinnedAt).
    padded = body["nextCursor"] + "=" * (-len(body["nextCursor"]) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    parts = raw.split("|", 2)
    assert len(parts) == 3, f"expected 3-field cursor, got {parts!r}"
    ts_str, doc_id, pinned_str = parts
    assert doc_id == "p2"
    assert datetime.fromisoformat(ts_str) == created_b
    assert pinned_str, "expected non-empty pinnedAt in cursor"
    assert datetime.fromisoformat(pinned_str) == pinned_b


def test_list_board_posts_cursor_with_pinned_passes_it_to_start_after() -> None:
    """A cursor that encodes pinnedAt must be decoded and passed to
    start_after — otherwise page 2 hardcodes pinnedAt=None and skips the
    rest of the pinned bucket."""
    import base64

    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    posts_col = db.collection.return_value.document.return_value.collection.return_value
    where_chain = posts_col.where.return_value.order_by.return_value.order_by.return_value
    name_order_chain = where_chain.order_by.return_value
    name_order_chain.start_after.return_value.limit.return_value.stream.return_value = iter([])

    base = datetime(2026, 5, 1, tzinfo=UTC)
    pinned = datetime(2026, 5, 4, tzinfo=UTC)
    cursor_str = (
        base64.urlsafe_b64encode(f"{base.isoformat()}|p-cursor|{pinned.isoformat()}".encode())
        .decode("ascii")
        .rstrip("=")
    )

    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get(f"/api/boards/b1/posts?cursor={cursor_str}")
    assert res.status_code == 200

    sa_calls = name_order_chain.start_after.call_args_list
    assert sa_calls, "expected start_after call"
    arg = sa_calls[0].args[0]
    assert (
        arg["pinnedAt"] == pinned
    ), f"start_after must receive the decoded pinnedAt, not None; got {arg!r}"
    assert arg["createdAt"] == base
    assert arg["__name__"] == "p-cursor"


def test_list_board_replies_cursor_passes_doc_id_for_tie_break() -> None:
    """Replies cursor pagination also tie-breaks on __name__."""
    import base64

    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    replies_col = MagicMock()
    posts = db.collection.return_value.document.return_value.collection.return_value
    posts.document.return_value.collection.return_value = replies_col
    created_chain = replies_col.order_by.return_value
    name_order_chain = created_chain.order_by.return_value
    name_order_chain.start_after.return_value.limit.return_value.stream.return_value = iter([])

    base = datetime(2026, 5, 1, tzinfo=UTC)
    cursor_str = (
        base64.urlsafe_b64encode(f"{base.isoformat()}|r-cursor".encode())
        .decode("ascii")
        .rstrip("=")
    )

    with patch("app.routers.boards._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get(f"/api/boards/b1/posts/p1/replies?cursor={cursor_str}")
    assert res.status_code == 200

    name_order_calls = created_chain.order_by.call_args_list
    assert any(
        "__name__" in (call.args + tuple(call.kwargs.values())) for call in name_order_calls
    ), "expected order_by('__name__', ...) for cursor tie-break"
    sa_calls = name_order_chain.start_after.call_args_list
    assert sa_calls, "expected start_after call after the __name__ order_by"
    arg = sa_calls[0].args[0]
    assert "createdAt" in arg
    assert "__name__" in arg
    assert arg["__name__"] == "r-cursor"
