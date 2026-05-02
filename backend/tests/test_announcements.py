"""Tests for the announce endpoint (POST /api/groups/{gid}/messages/{mid}/announce)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.groups import router


def _make_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _make_announce_db(
    *,
    member_uids: list[str] | None = None,
    archived_at: object = None,
    msg_exists: bool = True,
    msg_deleted: bool = False,
    msg_announced: bool = False,
    pinned_ids: list[str] | None = None,
    blocker_uid: str | None = None,
) -> MagicMock:
    """Build a mock DB for announce tests."""
    db = MagicMock()

    group_data: dict[str, object] = {
        "archivedAt": archived_at,
        "pinnedMessageIds": pinned_ids or [],
    }
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = group_data

    msg_data: dict[str, object] = {
        "body": "Hello world",
        "deletedAt": "ts" if msg_deleted else None,
        "announcedAt": "ts" if msg_announced else None,
    }
    msg_snap = MagicMock()
    msg_snap.exists = msg_exists
    msg_snap.to_dict.return_value = msg_data

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    msg_ref = MagicMock()
    msg_ref.get.return_value = msg_snap

    def _members_doc(uid: str) -> MagicMock:
        snap = MagicMock()
        snap.exists = True
        snap.to_dict.return_value = {"role": "leader" if uid == "alice" else "member"}
        snap.get.return_value = "leader" if uid == "alice" else "member"
        ref = MagicMock()
        ref.get.return_value = snap
        return ref

    members_col = MagicMock()
    members_col.document.side_effect = _members_doc

    # members().stream() → list of member snaps
    uids = member_uids if member_uids is not None else ["alice"]
    member_stream = []
    for uid in uids:
        s = MagicMock()
        s.id = uid
        member_stream.append(s)
    members_col.stream.return_value = iter(member_stream)

    def _messages_doc(mid: str) -> MagicMock:
        return msg_ref

    messages_col = MagicMock()
    messages_col.document.side_effect = _messages_doc

    def _group_subcol(name: str) -> MagicMock:
        if name == "members":
            return members_col
        if name == "messages":
            return messages_col
        return MagicMock()

    group_ref.collection.side_effect = _group_subcol

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref

    # blocks subcollection for block-check
    def _users_doc(uid: str) -> MagicMock:
        user_ref = MagicMock()

        def _user_subcol(name: str) -> MagicMock:
            col = MagicMock()
            if name == "blocks" and blocker_uid == uid:
                block_snap = MagicMock()
                block_snap.exists = True
                col.document.return_value.get.return_value = block_snap
            else:
                block_snap = MagicMock()
                block_snap.exists = False
                col.document.return_value.get.return_value = block_snap
            return col

        user_ref.collection.side_effect = _user_subcol
        return user_ref

    users_col = MagicMock()
    users_col.document.side_effect = _users_doc

    def _top_col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        if name == "users":
            return users_col
        if name == "audit_log":
            audit = MagicMock()
            audit.document.return_value = MagicMock()
            return audit
        return MagicMock()

    db.collection.side_effect = _top_col
    db.batch.return_value = MagicMock()
    db.transaction.return_value = MagicMock()
    return db


# ── announce happy path ───────────────────────────────────────────────────────


def test_announce_writes_notifications_for_each_member() -> None:
    """3 members → 3 notification rows (1 per member, none blocked)."""
    mock_db = _make_announce_db(member_uids=["alice", "bob", "carol"])
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
        patch("app.services.notifications._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    body = res.json()
    assert body["gid"] == "g1"
    assert body["mid"] == "m1"
    assert body["notifiedCount"] == 3


def test_announce_skips_blocked_members() -> None:
    """Recipient 'bob' has blocked alice → only 2 notifications for a 3-member group."""
    mock_db = _make_announce_db(member_uids=["alice", "bob", "carol"], blocker_uid="bob")
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
        patch("app.services.notifications._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    assert res.json()["notifiedCount"] == 2


def test_announce_already_announced_returns_409() -> None:
    mock_db = _make_announce_db(msg_announced=True)
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_announced"


def test_announce_pins_message() -> None:
    """After announce, mid is in pinnedMessageIds."""
    captured: list[dict[str, object]] = []

    mock_db = _make_announce_db(member_uids=["alice"])

    # Intercept the transaction update to capture the pinned IDs
    txn = MagicMock()

    def _capture_update(ref: object, data: dict[str, object]) -> None:
        captured.append(data)

    txn.update.side_effect = _capture_update
    mock_db.transaction.return_value = txn

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
        patch("app.services.notifications._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    pinned_update = next((d for d in captured if "pinnedMessageIds" in d), None)
    assert pinned_update is not None
    assert "m1" in pinned_update["pinnedMessageIds"]


def test_announce_pin_dropoff() -> None:
    """Already has 5 pins → oldest dropped, new mid appended."""
    existing = ["p1", "p2", "p3", "p4", "p5"]
    captured: list[dict[str, object]] = []

    mock_db = _make_announce_db(member_uids=["alice"], pinned_ids=existing)
    txn = MagicMock()

    def _capture_update(ref: object, data: dict[str, object]) -> None:
        captured.append(data)

    txn.update.side_effect = _capture_update
    mock_db.transaction.return_value = txn

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
        patch("app.services.notifications._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    pinned_update = next((d for d in captured if "pinnedMessageIds" in d), None)
    assert pinned_update is not None
    ids = pinned_update["pinnedMessageIds"]
    assert len(ids) == 5
    assert "p1" not in ids  # oldest dropped
    assert "m1" in ids


def test_announce_archived_group_returns_409() -> None:
    from datetime import UTC, datetime

    mock_db = _make_announce_db(archived_at=datetime(2026, 1, 1, tzinfo=UTC))
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "archived"


def test_announce_deleted_message_returns_409() -> None:
    mock_db = _make_announce_db(msg_deleted=True)
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "message_deleted"


def test_announce_audit_log() -> None:
    mock_db = _make_announce_db(member_uids=["alice", "bob"])
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
        patch("app.services.notifications._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    # Verify audit_log collection was written to
    mock_db.collection.assert_any_call("audit_log")
