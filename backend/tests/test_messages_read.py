"""Tests for `GET /api/groups/{gid}/messages` (M3)."""

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


def _msg_snap(
    *,
    mid: str,
    author: str = "bob",
    body: str = "hello",
    parent_id: str | None = None,
    deleted: bool = False,
    moderation_state: str | None = None,
    created_at: datetime | None = None,
) -> MagicMock:
    snap = MagicMock()
    snap.id = mid
    snap.exists = True
    data: dict = {
        "authorUid": author,
        "body": body,
        "parentMessageId": parent_id,
        "createdAt": created_at or datetime.now(UTC),
    }
    if deleted:
        data["deletedAt"] = datetime.now(UTC)
    if moderation_state:
        data["moderation"] = {"state": moderation_state, "reasons": []}
    snap.to_dict.return_value = data
    return snap


def _member_setup(*, group_exists: bool, member_exists: bool, role: str = "member"):
    """Return a db mock that yields the given group + member existence."""
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = group_exists
    group_snap.to_dict.return_value = {"isPrivate": False, "name": "g"}
    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.to_dict.return_value = {"role": role}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref
    db.collection.return_value.document.return_value = group_ref
    return db, group_ref


def test_list_messages_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    snaps = [
        _msg_snap(mid="m2", body="second"),
        _msg_snap(mid="m1", body="first"),
    ]
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages")
    assert res.status_code == 200
    body = res.json()
    assert [m["id"] for m in body["messages"]] == ["m2", "m1"]
    assert body["nextCursor"] is None


def test_list_messages_pagination_returns_cursor() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    # 3 results when limit=2 → has_more=True, only return 2.
    base = datetime(2026, 5, 1, tzinfo=UTC)
    snaps = [
        _msg_snap(mid="a", created_at=base + timedelta(seconds=3)),
        _msg_snap(mid="b", created_at=base + timedelta(seconds=2)),
        _msg_snap(mid="c", created_at=base + timedelta(seconds=1)),
    ]
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages?limit=2")
    assert res.status_code == 200
    body = res.json()
    assert [m["id"] for m in body["messages"]] == ["a", "b"]
    assert body["nextCursor"] is not None


def test_list_messages_invalid_cursor_is_400() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter([])
    chain.start_after.return_value.limit.return_value.stream.return_value = iter([])
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages?cursor=!!!notbase64!!!")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_cursor"


def test_list_messages_403_for_non_member_of_private_group() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": True}
    member_snap = MagicMock()
    member_snap.exists = False
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref
    db.collection.return_value.document.return_value = group_ref
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_member"


def test_list_messages_404_for_missing_group() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _member_setup(group_exists=False, member_exists=False)
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/groups/nope/messages")
    assert res.status_code == 404


def test_public_group_returns_top_level_only_to_non_member() -> None:
    user = CurrentUser(uid="anon", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False}
    member_snap = MagicMock()
    member_snap.exists = False
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref
    db.collection.return_value.document.return_value = group_ref
    snaps = [
        _msg_snap(mid="t1", body="top"),
        _msg_snap(mid="r1", body="reply", parent_id="t1"),
        _msg_snap(mid="d1", body="del", deleted=True),
        _msg_snap(mid="h1", body="hidden", moderation_state="hidden"),
    ]
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages")
    assert res.status_code == 200
    ids = {m["id"] for m in res.json()["messages"]}
    assert ids == {"t1"}


def test_member_sees_hidden_message_redacted_to_other_authors() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    snaps = [
        _msg_snap(mid="h-other", author="bob", body="rude", moderation_state="hidden"),
        _msg_snap(mid="h-mine", author="alice", body="mine", moderation_state="hidden"),
    ]
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter(snaps)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages")
    assert res.status_code == 200
    body = res.json()
    by_id = {m["id"]: m for m in body["messages"]}
    assert "h-other" not in by_id
    assert "h-mine" in by_id
    assert by_id["h-mine"]["body"] == ""


def test_get_message_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    snap = _msg_snap(mid="m1", body="hi")
    msg_ref = MagicMock()
    msg_ref.get.return_value = snap

    def _doc_side(arg=None):
        if arg == "g1":
            return group_ref
        return MagicMock()

    db.collection.return_value.document.side_effect = lambda arg=None: group_ref
    group_ref.collection.return_value.document.side_effect = lambda arg=None: (
        msg_ref if arg == "m1" else MagicMock()
    )
    # but we still need the membership read to work. The membership read goes
    # via `group_ref.collection("members").document(uid)` — same chain. Use
    # a side_effect on the .collection() of the group_ref:
    members_col = MagicMock()
    member_snap_local = MagicMock()
    member_snap_local.exists = True
    member_snap_local.to_dict.return_value = {"role": "member"}
    members_col.document.return_value.get.return_value = member_snap_local
    msgs_col = MagicMock()
    msgs_col.document.return_value = msg_ref
    group_ref.collection.side_effect = lambda name: (members_col if name == "members" else msgs_col)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages/m1")
    assert res.status_code == 200
    assert res.json()["id"] == "m1"


def test_get_message_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False}
    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "member"}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    msgs_col = MagicMock()
    missing = MagicMock()
    missing.exists = False
    msgs_col.document.return_value.get.return_value = missing
    group_ref.collection.side_effect = lambda name: (members_col if name == "members" else msgs_col)
    db.collection.return_value.document.return_value = group_ref
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "message_not_found"


def test_list_messages_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/groups/g1/messages")
    assert res.status_code == 401


# ── PR3: since= + ETag + 304 ────────────────────────────────────────────


def test_list_messages_since_filters_by_created_at() -> None:
    """`since=<iso>` adds where(createdAt >= ts) after the order_by."""
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    base = datetime(2026, 5, 1, tzinfo=UTC)
    snaps = [_msg_snap(mid="m2", created_at=base + timedelta(seconds=10))]
    messages_col = group_ref.collection.return_value
    # Chain: col.where(parentMessageId).order_by(createdAt).where(createdAt>=).limit().stream()
    parent_where = messages_col.where.return_value
    order = parent_where.order_by.return_value
    since_where = order.where.return_value
    since_where.limit.return_value.stream.return_value = iter(snaps)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get(
            "/api/groups/g1/messages",
            params={"since": base.isoformat()},
        )
    assert res.status_code == 200
    body = res.json()
    assert [m["id"] for m in body["messages"]] == ["m2"]
    where_calls = order.where.call_args_list
    assert any(call.args[0] == "createdAt" and call.args[1] == ">=" for call in where_calls)


def test_list_messages_since_invalid_format_400() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _member_setup(group_exists=True, member_exists=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages?since=not-a-date")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_since"


def test_list_messages_since_and_cursor_mutually_exclusive_400() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _member_setup(group_exists=True, member_exists=True)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages?since=2026-05-01T00:00:00Z&cursor=abc")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_query"


def test_list_messages_etag_header_emitted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, group_ref = _member_setup(group_exists=True, member_exists=True)
    messages_col = group_ref.collection.return_value
    chain = messages_col.where.return_value.order_by.return_value
    chain.limit.return_value.stream.return_value = iter([_msg_snap(mid="m1")])
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/messages")
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')


def test_list_messages_if_none_match_returns_304() -> None:
    """Two calls with identical content + If-None-Match → 304 + empty body."""
    user = CurrentUser(uid="alice", email=None, claims={})

    def _fresh_db():
        db, group_ref = _member_setup(group_exists=True, member_exists=True)
        messages_col = group_ref.collection.return_value
        chain = messages_col.where.return_value.order_by.return_value
        chain.limit.return_value.stream.return_value = iter(
            [_msg_snap(mid="m1", created_at=datetime(2026, 5, 1, tzinfo=UTC))]
        )
        return db

    db1 = _fresh_db()
    with (
        patch("app.deps.get_firestore", return_value=db1),
        patch("app.routers.messages.get_firestore", return_value=db1),
    ):
        client = TestClient(_app(user))
        first = client.get("/api/groups/g1/messages")
    etag = first.headers["etag"]

    db2 = _fresh_db()
    with (
        patch("app.deps.get_firestore", return_value=db2),
        patch("app.routers.messages.get_firestore", return_value=db2),
    ):
        client = TestClient(_app(user))
        second = client.get("/api/groups/g1/messages", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.content == b""
    assert second.headers["etag"] == etag


def test_list_messages_etag_changes_when_content_changes() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})

    def _build(mid: str):
        db, group_ref = _member_setup(group_exists=True, member_exists=True)
        messages_col = group_ref.collection.return_value
        chain = messages_col.where.return_value.order_by.return_value
        chain.limit.return_value.stream.return_value = iter(
            [_msg_snap(mid=mid, created_at=datetime(2026, 5, 1, tzinfo=UTC))]
        )
        return db

    db1 = _build("m1")
    with (
        patch("app.deps.get_firestore", return_value=db1),
        patch("app.routers.messages.get_firestore", return_value=db1),
    ):
        first = TestClient(_app(user)).get("/api/groups/g1/messages")
    db2 = _build("m2")
    with (
        patch("app.deps.get_firestore", return_value=db2),
        patch("app.routers.messages.get_firestore", return_value=db2),
    ):
        second = TestClient(_app(user)).get("/api/groups/g1/messages")
    assert first.headers["etag"] != second.headers["etag"]
