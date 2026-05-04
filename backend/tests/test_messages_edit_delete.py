"""Tests for `PATCH /api/groups/{gid}/messages/{mid}` (edit) and
`DELETE /api/groups/{gid}/messages/{mid}` (soft-delete) — M4."""

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


def _msg_data(
    *,
    author: str = "alice",
    body: str = "original",
    deleted: bool = False,
    created_at: datetime | None = None,
) -> dict:
    return {
        "authorUid": author,
        "body": body,
        "stickerIds": [],
        "mediaRefs": [],
        "createdAt": created_at or datetime.now(UTC),
        "editedAt": None,
        "deletedAt": datetime.now(UTC) if deleted else None,
        "parentMessageId": None,
        "threadReplyCount": 0,
        "reactionCounts": {},
    }


def _make_db_with_msg(
    *, role: str = "member", msg: dict | None = None, exists: bool = True
) -> tuple[MagicMock, MagicMock]:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False, "name": "G", "archivedAt": None}
    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": role}
    bans_snap = MagicMock()
    bans_snap.exists = False

    msg_ref = MagicMock()
    msg_snap = MagicMock()
    msg_snap.id = "m1"
    msg_snap.exists = exists
    msg_snap.to_dict.return_value = msg or _msg_data()
    msg_ref.get.return_value = msg_snap

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    msgs_col = MagicMock()
    msgs_col.document.return_value = msg_ref

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
    db.transaction.return_value = MagicMock()
    return db, msg_ref


# ── edit ───────────────────────────────────────────────────────────────────


def test_edit_message_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, msg_ref = _make_db_with_msg()
    # The transactional decorator swallows the read so we patch read on .get()
    # to use the same snap.
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1/messages/m1", json={"body": "edited"})
    assert res.status_code == 200
    msg_ref.get.assert_called()


def test_edit_message_403_not_author() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(msg=_msg_data(author="bob"))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1/messages/m1", json={"body": "x"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_author"


def test_edit_message_409_window_expired() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    long_ago = datetime.now(UTC) - timedelta(minutes=20)
    db, _ = _make_db_with_msg(msg=_msg_data(created_at=long_ago))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1/messages/m1", json={"body": "x"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "edit_window_expired"


def test_edit_message_409_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(msg=_msg_data(deleted=True))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1/messages/m1", json={"body": "x"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "deleted"


def test_edit_message_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(exists=False)
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.patch("/api/groups/g1/messages/m1", json={"body": "x"})
    assert res.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────


def test_delete_message_author_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg()
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
        patch("app.routers.messages.write_audit_log") as audit,
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1")
    assert res.status_code == 200
    assert res.json()["body"] == ""  # redacted
    audit.assert_called_once()


def test_delete_message_leader_can_delete_others() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(role="leader", msg=_msg_data(author="bob"))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
        patch("app.routers.messages.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1")
    assert res.status_code == 200


def test_delete_message_403_for_non_author_non_leader() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(msg=_msg_data(author="bob"))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_author_or_leader"


def test_delete_message_idempotent_on_already_deleted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _make_db_with_msg(msg=_msg_data(deleted=True))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.messages.get_firestore", return_value=db),
        patch(
            "google.cloud.firestore.transactional",
            lambda fn: (lambda txn: fn(MagicMock(get=lambda r, transaction=None: r.get()))),
        ),
        patch("app.routers.messages.write_audit_log") as audit,
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/groups/g1/messages/m1")
    assert res.status_code == 200
    audit.assert_not_called()  # no audit on no-op
