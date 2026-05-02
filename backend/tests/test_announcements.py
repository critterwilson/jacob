"""Tests for POST /api/groups/{gid}/messages/{mid}/announce (T24)."""

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
    msg_deleted: bool = False,
    msg_announced: bool = False,
    group_archived: bool = False,
    pinned_ids: list[str] | None = None,
    blocked_by: list[str] | None = None,
) -> MagicMock:
    """Build a Firestore mock wired for the announce endpoint."""
    member_uids = member_uids or ["alice", "bob", "carol"]
    pinned_ids = pinned_ids or []
    blocked_by = blocked_by or []  # uids that have blocked the announcer

    db = MagicMock()

    groups_col = MagicMock()
    users_col = MagicMock()
    audit_col = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        if name == "users":
            return users_col
        return audit_col

    db.collection.side_effect = _col

    # group doc
    group_ref = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "archivedAt": "ts" if group_archived else None,
        "pinnedMessageIds": list(pinned_ids),
    }
    group_ref.get.return_value = group_snap

    # member doc (leader check)
    leader_snap = MagicMock()
    leader_snap.exists = True
    leader_snap.to_dict.return_value = {"role": "leader"}

    # message doc
    msg_snap = MagicMock()
    msg_snap.exists = True
    msg_snap.to_dict.return_value = {
        "body": "Hello world",
        "deletedAt": "ts" if msg_deleted else None,
        "announcedAt": "ts" if msg_announced else None,
    }

    def _members_col_document(uid: str) -> MagicMock:
        ref = MagicMock()
        ref.get.return_value = leader_snap
        return ref

    def _messages_col_document(mid: str) -> MagicMock:
        ref = MagicMock()
        ref.get.return_value = msg_snap
        return ref

    members_col = MagicMock()
    members_col.document.side_effect = _members_col_document

    # stream() yields member-like objects
    member_snaps = []
    for uid in member_uids:
        s = MagicMock()
        s.id = uid
        member_snaps.append(s)
    members_col.stream.return_value = iter(member_snaps)

    messages_col = MagicMock()
    messages_col.document.side_effect = _messages_col_document

    def _group_subcol(name: str) -> MagicMock:
        if name == "members":
            return members_col
        if name == "messages":
            return messages_col
        return MagicMock()

    group_ref.collection.side_effect = _group_subcol
    groups_col.document.return_value = group_ref

    # users subcollection (blocks check)
    def _user_document(uid: str) -> MagicMock:
        u_ref = MagicMock()

        def _user_subcol(name: str) -> MagicMock:
            sub = MagicMock()
            if name == "blocks":
                def _block_doc(blocker_uid: str) -> MagicMock:
                    bref = MagicMock()
                    bsnap = MagicMock()
                    bsnap.exists = uid in blocked_by
                    bref.get.return_value = bsnap
                    return bref

                sub.document.side_effect = _block_doc
            elif name == "notifications":
                n_ref = MagicMock()
                n_ref.set.return_value = None
                sub.document.return_value = n_ref
            return sub

        u_ref.collection.side_effect = _user_subcol
        return u_ref

    users_col.document.side_effect = _user_document

    db.batch.return_value = MagicMock()
    return db


# ── happy path ──────────────────────────────────────────────────────────────


def test_announce_writes_notifications_for_each_member() -> None:
    mock_db = _make_announce_db(member_uids=["alice", "bob", "carol"])

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
        patch(
            "app.routers.groups.bulk_write_notifications", return_value=3
        ) as mock_bulk,
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    body = res.json()
    assert body["gid"] == "g1"
    assert body["mid"] == "m1"
    assert body["notifiedCount"] == 3
    mock_bulk.assert_called_once()
    call_kwargs = mock_bulk.call_args.kwargs
    assert set(call_kwargs["recipient_uids"]) == {"alice", "bob", "carol"}
    assert call_kwargs["kind"] == "announcement"


def test_announce_skips_blocked_members() -> None:
    """Recipient 'carol' has blocked the announcer 'alice'; only 2 notified."""
    mock_db = _make_announce_db(
        member_uids=["alice", "bob", "carol"],
        blocked_by=["carol"],  # carol blocked the announcer
    )

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
        patch(
            "app.routers.groups.bulk_write_notifications", return_value=2
        ) as mock_bulk,
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    assert res.json()["notifiedCount"] == 2
    mock_bulk.assert_called_once()


def test_announce_pins_message() -> None:
    """The message id appears in the pinnedMessageIds batch update."""
    captured_updates: list[dict] = []

    mock_db = _make_announce_db(pinned_ids=[])
    original_batch = mock_db.batch.return_value

    def _capture_update(ref: object, data: dict) -> None:  # type: ignore[type-arg]
        captured_updates.append(data)

    original_batch.update.side_effect = _capture_update

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
        patch("app.routers.groups.bulk_write_notifications", return_value=3),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    pin_update = next(
        (u for u in captured_updates if "pinnedMessageIds" in u), None
    )
    assert pin_update is not None
    assert "m1" in pin_update["pinnedMessageIds"]


def test_announce_pin_dropoff() -> None:
    """Group already has 5 pins; announce a 6th — oldest is dropped."""
    existing = ["p1", "p2", "p3", "p4", "p5"]
    captured_updates: list[dict] = []

    mock_db = _make_announce_db(pinned_ids=existing)
    original_batch = mock_db.batch.return_value

    def _capture_update(ref: object, data: dict) -> None:  # type: ignore[type-arg]
        captured_updates.append(data)

    original_batch.update.side_effect = _capture_update

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
        patch("app.routers.groups.bulk_write_notifications", return_value=3),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/new-m/announce")

    assert res.status_code == 200
    pin_update = next(
        (u for u in captured_updates if "pinnedMessageIds" in u), None
    )
    assert pin_update is not None
    ids = pin_update["pinnedMessageIds"]
    assert len(ids) == 5
    assert "new-m" in ids
    assert "p5" not in ids  # oldest dropped


def test_announce_audit_log() -> None:
    mock_db = _make_announce_db()

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log") as mock_audit,
        patch("app.routers.groups.bulk_write_notifications", return_value=3),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 200
    mock_audit.assert_called_once()
    call_kwargs = mock_audit.call_args.kwargs
    assert call_kwargs["action"] == "announce_message"
    assert call_kwargs["payload"]["notifiedCount"] == 3


# ── error cases ─────────────────────────────────────────────────────────────


def test_announce_already_announced_returns_409() -> None:
    mock_db = _make_announce_db(msg_announced=True)

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
        patch("app.routers.groups.bulk_write_notifications", return_value=0),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_announced"


def test_announce_deleted_message_returns_409() -> None:
    mock_db = _make_announce_db(msg_deleted=True)

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.write_audit_log"),
    ):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "message_deleted"


def test_announce_archived_group_returns_409() -> None:
    mock_db = _make_announce_db(group_archived=True)

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/g1/messages/m1/announce")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "archived"
