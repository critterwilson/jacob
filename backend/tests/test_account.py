"""Tests for the account router and deletion service (T14).

firebase_admin is mocked at the module level so no real auth/firestore
calls occur. `get_current_user` is overridden via FastAPI dependency
injection.

Coverage:
- request: stamps fields, revokes refresh tokens, audit log written
- cancel: clears fields when within window
- cancel: no-op (409) when no pending request
- cancel: no-op (409) when past the window (finalize-too-early-no-op)
- status: reports none / pending shapes
- finalize-too-early: service returns no UIDs when nothing is due
- finalize-on-time: service hard-deletes, tombstones, audit-logs
- finalize: keepBody=False clears message body
- finalize: idempotent when user already gone
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.account import router
from app.services import deletion


def _app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _make_user_db(
    *,
    user_exists: bool = True,
    user_data: dict | None = None,
) -> MagicMock:
    db = MagicMock()
    user_ref = MagicMock()
    user_snap = MagicMock()
    user_snap.exists = user_exists
    user_snap.to_dict.return_value = user_data or {
        "displayName": "Alice",
        "schemaVersion": 1,
    }
    user_ref.get.return_value = user_snap

    users_col = MagicMock()
    users_col.document.return_value = user_ref

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "users":
            return users_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _col
    db._user_ref = user_ref  # type: ignore[attr-defined]
    db._audit_col = audit_col  # type: ignore[attr-defined]
    return db


# ── request ───────────────────────────────────────────────────────────────────


def test_request_delete_happy_path() -> None:
    db = _make_user_db()
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.revoke_refresh_tokens") as revoke,
    ):
        res = TestClient(_app("alice")).post(
            "/api/account/delete",
            json={"keepBody": True},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["keepBody"] is True
    assert body["deletionRequestedAt"]
    assert body["finalizeAt"] > body["deletionRequestedAt"]
    db._user_ref.update.assert_called_once()
    update_args = db._user_ref.update.call_args[0][0]
    assert "deletionRequestedAt" in update_args
    assert update_args["deletionKeepBody"] is True
    revoke.assert_called_once_with("alice")


def test_request_delete_writes_audit_log() -> None:
    db = _make_user_db()
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.revoke_refresh_tokens"),
    ):
        TestClient(_app("alice")).post(
            "/api/account/delete",
            json={"keepBody": False},
        )
    audit_set = db._audit_col.document().set.call_args[0][0]
    assert audit_set["action"] == "account_delete_requested"
    assert audit_set["actorUid"] == "alice"
    assert audit_set["targetRef"] == "users/alice"
    assert audit_set["payload"]["keepBody"] is False


def test_request_delete_404_when_user_missing() -> None:
    db = _make_user_db(user_exists=False)
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.revoke_refresh_tokens"),
    ):
        res = TestClient(_app("ghost")).post(
            "/api/account/delete",
            json={"keepBody": True},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "user_not_found"


# ── cancel ────────────────────────────────────────────────────────────────────


def test_cancel_within_window() -> None:
    requested_at = datetime.now(UTC) - timedelta(days=3)
    db = _make_user_db(
        user_data={
            "displayName": "Alice",
            "deletionRequestedAt": requested_at,
            "deletionKeepBody": True,
        }
    )
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_app("alice")).post("/api/account/delete/cancel")
    assert res.status_code == 200
    assert res.json()["cancelled"] is True
    db._user_ref.update.assert_called_once()


def test_cancel_no_pending_request() -> None:
    db = _make_user_db(user_data={"displayName": "Alice"})
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_app("alice")).post("/api/account/delete/cancel")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_pending"


def test_cancel_past_window_is_409() -> None:
    """Past the 14-day window cancellation is a no-op (finalize-too-early-no-op)."""
    requested_at = datetime.now(UTC) - timedelta(days=20)
    db = _make_user_db(
        user_data={
            "displayName": "Alice",
            "deletionRequestedAt": requested_at,
            "deletionKeepBody": True,
        }
    )
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_app("alice")).post("/api/account/delete/cancel")
    assert res.status_code == 409


# ── status ────────────────────────────────────────────────────────────────────


def test_status_none_when_no_request() -> None:
    db = _make_user_db(user_data={"displayName": "Alice"})
    with patch("app.services.deletion._db", return_value=db):
        res = TestClient(_app("alice")).get("/api/account/delete/status")
    assert res.status_code == 200
    assert res.json()["status"] == "none"


def test_status_pending_when_request_active() -> None:
    requested_at = datetime.now(UTC) - timedelta(days=2)
    db = _make_user_db(
        user_data={
            "displayName": "Alice",
            "deletionRequestedAt": requested_at,
            "deletionKeepBody": False,
        }
    )
    with patch("app.services.deletion._db", return_value=db):
        res = TestClient(_app("alice")).get("/api/account/delete/status")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert body["keepBody"] is False
    assert body["deletionRequestedAt"]
    assert body["finalizeAt"]


# ── finalize service ──────────────────────────────────────────────────────────


def _make_finalize_db(
    *,
    user_exists: bool = True,
    keep_body: bool = True,
    photo_url: str | None = None,
    messages: list[tuple[str, str, str]] | None = None,
    private_docs: list[str] | None = None,
) -> MagicMock:
    """Build a mock db for finalize_account.

    `messages` is a list of (gid, mid, body) tuples — each yields a snapshot
    whose `.reference.update()` call we can later inspect.
    """
    db = MagicMock()

    user_ref = MagicMock()
    user_snap = MagicMock()
    user_snap.exists = user_exists
    user_snap.to_dict.return_value = {
        "deletionKeepBody": keep_body,
        "photoURL": photo_url,
    }
    user_ref.get.return_value = user_snap

    private_col = MagicMock()
    private_snaps = []
    for did in private_docs or []:
        snap = MagicMock()
        snap.id = did
        snap.reference = MagicMock()
        private_snaps.append(snap)
    private_col.stream.return_value = iter(private_snaps)
    user_ref.collection.return_value = private_col

    users_col = MagicMock()
    users_col.document.return_value = user_ref

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()

    # collection_group("messages")
    cg_query = MagicMock()
    msg_snaps = []
    for gid, mid, body in messages or []:
        snap = MagicMock()
        snap.id = mid
        snap.reference = MagicMock()
        snap.reference._gid = gid  # type: ignore[attr-defined]
        snap.reference._body = body  # type: ignore[attr-defined]
        msg_snaps.append(snap)
    cg_query.where.return_value.stream.return_value = iter(msg_snaps)
    db.collection_group.return_value = cg_query

    def _col(name: str) -> MagicMock:
        if name == "users":
            return users_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _col
    db._user_ref = user_ref  # type: ignore[attr-defined]
    db._audit_col = audit_col  # type: ignore[attr-defined]
    db._private_snaps = private_snaps  # type: ignore[attr-defined]
    db._msg_snaps = msg_snaps  # type: ignore[attr-defined]
    return db


def test_finalize_too_early_returns_no_due_users() -> None:
    """find_users_due returns nothing when the cutoff has nothing to match."""
    db = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = iter([])
    with patch("app.services.deletion._db", return_value=db):
        due = deletion.find_users_due(now=datetime.now(UTC))
    assert due == []


def test_finalize_on_time_full_pipeline() -> None:
    db = _make_finalize_db(
        keep_body=True,
        photo_url="https://storage.googleapis.com/jacob-media-public/avatars/alice.jpg",
        messages=[("g1", "m1", "hello"), ("g2", "m9", "world")],
        private_docs=["profile"],
    )
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.update_user") as upd,
        patch("app.services.deletion._end_watch_sessions", return_value=0),
        patch(
            "app.services.deletion._handle_founder_groups",
            return_value={"transferred": 0, "archived": 0},
        ),
        patch("app.services.deletion._delete_ban", return_value=False),
        patch(
            "app.services.deletion._delete_others_blocks_and_mutes",
            return_value={"blocks": 0, "mutes": 0},
        ),
        patch("importlib.import_module") as imp,
    ):
        gcs_mod = MagicMock()
        imp.return_value = gcs_mod
        result = deletion.finalize_account("alice")

    assert result["status"] == "finalized"
    assert result["messagesTombstoned"] == 2
    upd.assert_called_once_with("alice", disabled=True)

    for snap in db._msg_snaps:
        snap.reference.update.assert_called_once()
        update_args = snap.reference.update.call_args[0][0]
        assert update_args["authorUid"] == "[deleted]"
        assert "body" not in update_args  # keepBody=True

    for snap in db._private_snaps:
        snap.reference.delete.assert_called_once()

    db._user_ref.delete.assert_called_once()
    audit_set = db._audit_col.document().set.call_args[0][0]
    assert audit_set["action"] == "account_finalized"
    assert audit_set["actorUid"] == "system"


def test_finalize_with_keep_body_false_clears_body() -> None:
    db = _make_finalize_db(
        keep_body=False,
        messages=[("g1", "m1", "secret")],
    )
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.update_user"),
        patch("app.services.deletion._end_watch_sessions", return_value=0),
        patch(
            "app.services.deletion._handle_founder_groups",
            return_value={"transferred": 0, "archived": 0},
        ),
        patch("app.services.deletion._delete_ban", return_value=False),
        patch(
            "app.services.deletion._delete_others_blocks_and_mutes",
            return_value={"blocks": 0, "mutes": 0},
        ),
    ):
        deletion.finalize_account("alice")

    snap = db._msg_snaps[0]
    update_args = snap.reference.update.call_args[0][0]
    assert update_args["authorUid"] == "[deleted]"
    assert update_args["body"] == ""


def test_finalize_idempotent_when_user_already_gone() -> None:
    db = _make_finalize_db(user_exists=False)
    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        result = deletion.finalize_account("ghost")
    assert result["status"] == "already_gone"
    db._user_ref.delete.assert_not_called()


def test_finalize_calls_every_cleanup_helper(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """C1: confirm finalize_account routes through every new cleanup helper.

    Patches each helper to a sentinel return value; asserts each was
    invoked once and the resulting audit-log payload + return dict carry
    the expected fanout counters. Doesn't exercise Firestore semantics
    end-to-end (that's the emulator job).
    """
    db = _make_finalize_db(messages=[("g1", "m1", "hi")])
    calls: dict[str, int] = {}

    def _wrap(name: str, ret):  # type: ignore[no-untyped-def]
        def fn(*args, **kwargs):  # type: ignore[no-untyped-def]
            calls[name] = calls.get(name, 0) + 1
            return ret

        return fn

    with (
        patch("app.services.deletion._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.deletion.firebase_auth.update_user"),
        patch(
            "app.services.deletion._tombstone_board_content",
            _wrap("boards", {"posts": 2, "replies": 5}),
        ),
        patch("app.services.deletion._delete_reactions_by_user", _wrap("reactions", 0)),
        patch("app.services.deletion._delete_event_rsvps", _wrap("rsvps", 3)),
        patch("app.services.deletion._delete_reports_by_user", _wrap("reports", 1)),
        patch("app.services.deletion._end_watch_sessions", _wrap("watch", 2)),
        patch(
            "app.services.deletion._handle_founder_groups",
            _wrap("founder", {"transferred": 1, "archived": 1}),
        ),
        patch(
            "app.services.deletion._delete_group_memberships",
            _wrap("group_members", (4, ["g1", "g2"])),
        ),
        patch(
            "app.services.deletion._delete_org_memberships",
            _wrap("org_members", 1),
        ),
        patch(
            "app.services.deletion._delete_org_admins",
            _wrap("org_admins", 2),
        ),
        patch(
            "app.services.deletion._cleanup_rtdb_for_user",
            _wrap("rtdb", {"presence": 2, "typing": 2, "watch": 1}),
        ),
        patch("app.services.deletion._delete_ban", _wrap("ban", True)),
        patch(
            "app.services.deletion._delete_others_blocks_and_mutes",
            _wrap("others", {"blocks": 2, "mutes": 1}),
        ),
        patch(
            "app.services.deletion._delete_user_subcollections",
            _wrap("subcollections", {"notifications": 7, "devices": 2, "mutes": 0}),
        ),
        patch("app.services.deletion._delete_typesense_messages", _wrap("typesense", 0)),
    ):
        result = deletion.finalize_account("alice")

    # Every new cleanup helper was invoked exactly once.
    assert calls == {
        "boards": 1,
        "reactions": 1,
        "rsvps": 1,
        "reports": 1,
        "watch": 1,
        "founder": 1,
        "group_members": 1,
        "org_members": 1,
        "org_admins": 1,
        "rtdb": 1,
        "ban": 1,
        "others": 1,
        "subcollections": 1,
        "typesense": 1,
    }
    # Return shape carries the new counters.
    assert result["boardPostsTombstoned"] == 2
    assert result["boardRepliesTombstoned"] == 5
    assert result["rsvpsDeleted"] == 3
    assert result["reportsDeleted"] == 1
    assert result["groupMemberships"] == 4
    assert result["orgMemberships"] == 1
    assert result["orgAdmins"] == 2
    assert result["watchSessionsEnded"] == 2
    assert result["founderTransferred"] == 1
    assert result["founderArchived"] == 1
    assert result["banDropped"] is True
    assert result["othersBlocksDeleted"] == 2
    assert result["othersMutesDeleted"] == 1
    assert result["rtdbPresenceDeleted"] == 2
    assert result["rtdbTypingDeleted"] == 2
    assert result["rtdbWatchDeleted"] == 1
    # Audit payload mirrors the result fanout.
    audit_set = db._audit_col.document().set.call_args[0][0]
    assert audit_set["payload"]["boardPostsTombstoned"] == 2
    assert audit_set["payload"]["userSubcollections"]["notifications"] == 7
    assert audit_set["payload"]["watchSessionsEnded"] == 2
    assert audit_set["payload"]["banDropped"] is True
    assert audit_set["payload"]["othersBlocksDeleted"] == 2
    assert audit_set["payload"]["orgAdmins"] == 2
    assert audit_set["payload"]["rtdbWatchDeleted"] == 1


# ── M-BACK-14: cascade-gap helpers ───────────────────────────────────────


def test_delete_event_rsvps_uses_name_filter() -> None:
    """RSVP cleanup filters by `__name__` server-side instead of streaming
    every RSVP and filtering in Python."""
    db = MagicMock()
    cg_filtered = MagicMock()
    snap1 = MagicMock()
    snap1.reference = MagicMock()
    snap2 = MagicMock()
    snap2.reference = MagicMock()
    cg_filtered.stream.return_value = iter([snap1, snap2])
    cg_query = MagicMock()
    cg_query.where.return_value = cg_filtered
    db.collection_group.return_value = cg_query

    n = deletion._delete_event_rsvps(db, "alice")

    assert n == 2
    db.collection_group.assert_called_with("rsvps")
    where_args = cg_query.where.call_args[0]
    assert where_args[0] == "__name__"
    assert where_args[1] == "=="
    assert where_args[2] == "alice"
    snap1.reference.delete.assert_called_once()
    snap2.reference.delete.assert_called_once()


def test_delete_others_blocks_and_mutes() -> None:
    """Other users' blocks/mutes pointing at the deleted uid are removed
    via two CG queries — one per subcollection."""
    db = MagicMock()
    block_snap = MagicMock()
    block_snap.reference = MagicMock()
    mute_snap = MagicMock()
    mute_snap.reference = MagicMock()

    by_name: dict[str, MagicMock] = {}

    def _cg(name: str) -> MagicMock:
        cg = MagicMock()
        filtered = MagicMock()
        if name == "blocks":
            filtered.stream.return_value = iter([block_snap])
        elif name == "mutes":
            filtered.stream.return_value = iter([mute_snap])
        else:
            filtered.stream.return_value = iter([])
        cg.where.return_value = filtered
        by_name[name] = cg
        return cg

    db.collection_group.side_effect = _cg

    counts = deletion._delete_others_blocks_and_mutes(db, "alice")

    assert counts == {"blocks": 1, "mutes": 1}
    assert "blocks" in by_name
    assert "mutes" in by_name
    block_args = by_name["blocks"].where.call_args[0]
    assert block_args[0] == "__name__"
    assert block_args[2] == "alice"
    block_snap.reference.delete.assert_called_once()
    mute_snap.reference.delete.assert_called_once()


def test_delete_ban_returns_false_when_no_row() -> None:
    db = MagicMock()
    ref = MagicMock()
    snap = MagicMock()
    snap.exists = False
    ref.get.return_value = snap
    db.collection.return_value.document.return_value = ref

    assert deletion._delete_ban(db, "alice") is False
    ref.delete.assert_not_called()


def test_delete_ban_deletes_row_when_present() -> None:
    db = MagicMock()
    ref = MagicMock()
    snap = MagicMock()
    snap.exists = True
    ref.get.return_value = snap
    db.collection.return_value.document.return_value = ref

    assert deletion._delete_ban(db, "alice") is True
    ref.delete.assert_called_once()


def test_end_watch_sessions_skips_already_ended() -> None:
    db = MagicMock()
    active = MagicMock()
    active.to_dict.return_value = {"endedAt": None}
    active.reference = MagicMock()
    ended = MagicMock()
    ended.to_dict.return_value = {"endedAt": datetime(2026, 4, 1, tzinfo=UTC)}
    ended.reference = MagicMock()

    cg = MagicMock()
    cg.where.return_value.stream.return_value = iter([active, ended])
    db.collection_group.return_value = cg

    n = deletion._end_watch_sessions(db, "alice")

    assert n == 1
    db.collection_group.assert_called_with("watch_sessions")
    where_args = cg.where.call_args[0]
    assert where_args[0] == "leaderUid"
    assert where_args[2] == "alice"
    active.reference.update.assert_called_once()
    ended.reference.update.assert_not_called()


def test_handle_founder_groups_transfers_to_remaining_leader() -> None:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {"leaderUids": ["alice", "bob"]}
    group_snap.reference = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 1, "archived": 0}
    update_args = group_snap.reference.update.call_args[0][0]
    assert update_args == {"founderUid": "bob"}


def test_handle_founder_groups_archives_when_no_other_leader() -> None:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {"leaderUids": ["alice"], "archivedAt": None}
    group_snap.reference = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 0, "archived": 1}
    update_args = group_snap.reference.update.call_args[0][0]
    assert update_args["archivedBy"] == "system"
    assert update_args["archiveReason"] == "founder_deleted"
    assert "archivedAt" in update_args


def test_handle_founder_groups_skips_already_archived() -> None:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {
        "leaderUids": ["alice"],
        "archivedAt": datetime(2026, 4, 1, tzinfo=UTC),
    }
    group_snap.reference = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 0, "archived": 0}
    group_snap.reference.update.assert_not_called()


# ── H3 / M1 / M4: deletion-cascade follow-ups ───────────────────────────────


def test_handle_founder_groups_falls_back_to_members_when_leader_uids_empty() -> None:
    """H3: if `leaderUids` is empty or stale, scan the members
    subcollection for a surviving `role=="leader"` row before archiving.
    The backfill that populates leaderUids is parked, so older groups
    can have an empty denorm while still holding real leader rows."""
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {"leaderUids": [], "archivedAt": None}
    group_snap.reference = MagicMock()

    # `members where role==leader` yields one other leader (bob).
    bob = MagicMock()
    bob.id = "bob"
    bob.to_dict.return_value = {"role": "leader"}
    members_chain = MagicMock()
    members_chain.where.return_value.stream.return_value = iter([bob])
    group_snap.reference.collection.return_value = members_chain

    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 1, "archived": 0}
    update_args = group_snap.reference.update.call_args[0][0]
    assert update_args == {"founderUid": "bob"}
    group_snap.reference.collection.assert_called_with("members")
    where_args = members_chain.where.call_args[0]
    assert where_args[0] == "role"
    assert where_args[2] == "leader"


def test_handle_founder_groups_archives_when_fallback_also_empty() -> None:
    """H3: if neither `leaderUids` nor the members fallback yields any
    other leader, archive the group rather than silently leaving an
    orphaned `founderUid` pointing at a deleted account."""
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {"leaderUids": [], "archivedAt": None}
    group_snap.reference = MagicMock()

    # Members stream returns only the deleted user — should be filtered out.
    alice_only = MagicMock()
    alice_only.id = "alice"
    alice_only.to_dict.return_value = {"role": "leader"}
    members_chain = MagicMock()
    members_chain.where.return_value.stream.return_value = iter([alice_only])
    group_snap.reference.collection.return_value = members_chain

    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 0, "archived": 1}
    update_args = group_snap.reference.update.call_args[0][0]
    assert update_args["archiveReason"] == "founder_deleted"


def test_handle_founder_groups_skips_fallback_when_leader_uids_has_other_leader() -> None:
    """H3: the fallback CG-style scan is only paid when needed. If
    `leaderUids` already names a non-deleted leader, skip the
    members read entirely."""
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.to_dict.return_value = {"leaderUids": ["alice", "carol"]}
    group_snap.reference = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = iter([group_snap])

    counts = deletion._handle_founder_groups(db, "alice")

    assert counts == {"transferred": 1, "archived": 0}
    # Did NOT touch the members subcollection — that read is only paid
    # when the denorm is empty/stale.
    group_snap.reference.collection.assert_not_called()


def test_delete_org_admins_removes_admin_row() -> None:
    """M1: a deleted user who was an org admin must have their
    `orgs/{orgId}/admins/{uid}` row swept. Without this the row keeps
    surfacing in `/api/orgs/{orgId}/admins` and inflates the
    `last_admin` guard in `orgs_service.remove_admin`."""
    db = MagicMock()
    admin_snap = MagicMock()
    admin_snap.reference = MagicMock()
    # parent.parent.id == "orgs" so the row passes the schema-drift guard.
    admin_snap.reference.parent.parent.parent.id = "orgs"
    cg = MagicMock()
    cg.where.return_value.stream.return_value = iter([admin_snap])
    db.collection_group.return_value = cg

    n = deletion._delete_org_admins(db, "alice")

    assert n == 1
    db.collection_group.assert_called_with("admins")
    where_args = cg.where.call_args[0]
    assert where_args[0] == "__name__"
    assert where_args[2] == "alice"
    admin_snap.reference.delete.assert_called_once()


def test_delete_org_admins_skips_non_org_parents() -> None:
    """Defensive: if another collection ever names a subcollection
    `admins` (schema drift), only delete rows whose grand-parent
    collection is `orgs`."""
    db = MagicMock()
    other_snap = MagicMock()
    other_snap.reference = MagicMock()
    other_snap.reference.parent.parent.parent.id = "something_else"
    cg = MagicMock()
    cg.where.return_value.stream.return_value = iter([other_snap])
    db.collection_group.return_value = cg

    assert deletion._delete_org_admins(db, "alice") == 0
    other_snap.reference.delete.assert_not_called()


def test_delete_group_memberships_returns_gids_for_rtdb_sweep() -> None:
    """M4: `_delete_group_memberships` returns the gid list so
    `_cleanup_rtdb_for_user` can scope its RTDB reads to the groups the
    user was actually a member of."""
    db = MagicMock()
    m1 = MagicMock()
    m1.reference = MagicMock()
    m1.reference.parent.parent.parent.id = "groups"
    m1.reference.parent.parent.id = "g1"
    m2 = MagicMock()
    m2.reference = MagicMock()
    m2.reference.parent.parent.parent.id = "groups"
    m2.reference.parent.parent.id = "g2"
    org_row = MagicMock()  # filtered out — parent is orgs, not groups
    org_row.reference = MagicMock()
    org_row.reference.parent.parent.parent.id = "orgs"

    cg = MagicMock()
    cg.where.return_value.stream.return_value = iter([m1, org_row, m2])
    db.collection_group.return_value = cg

    count, gids = deletion._delete_group_memberships(db, "alice")

    assert count == 2
    assert sorted(gids) == ["g1", "g2"]
    m1.reference.delete.assert_called_once()
    m2.reference.delete.assert_called_once()
    org_row.reference.delete.assert_not_called()


def test_cleanup_rtdb_for_user_skips_when_no_url_configured() -> None:
    """M4: with FIREBASE_DATABASE_URL unset (the dev default), the RTDB
    sweep is a no-op log — every count returns 0 and no `firebase_db`
    reference is constructed. Lets the unit tests run without RTDB."""
    from app.config import Settings

    with (
        patch("app.services.deletion.get_settings", return_value=Settings()),
        patch("app.services.deletion.firebase_db.reference") as ref,
    ):
        counts = deletion._cleanup_rtdb_for_user("alice", ["g1", "g2"])

    assert counts == {"presence": 0, "typing": 0, "watch": 0}
    ref.assert_not_called()


def test_cleanup_rtdb_for_user_deletes_presence_typing_and_owned_watch() -> None:
    """M4: for each gid, delete `presence/{gid}/{uid}` and
    `typing/{gid}/{uid}`, then read `watch/{gid}` and delete sessions
    whose `leaderUid` matches the deleted user. Other leaders'
    sessions in the same group are left alone."""
    from app.config import Settings

    settings = Settings(firebase_database_url="https://demo-rtdb.firebaseio.com")

    paths_touched: list[tuple[str, str]] = []  # (path, op)

    def _ref(path: str, url: str | None = None) -> MagicMock:  # type: ignore[no-untyped-def]
        assert url == "https://demo-rtdb.firebaseio.com"
        mock = MagicMock()

        def _delete() -> None:
            paths_touched.append((path, "delete"))

        mock.delete.side_effect = _delete

        if path == "watch/g1":
            mock.get.return_value = {
                "sess-a": {"leaderUid": "alice"},
                "sess-b": {"leaderUid": "bob"},
            }
        elif path == "watch/g2":
            mock.get.return_value = {}
        else:
            mock.get.return_value = None
        return mock

    with (
        patch("app.services.deletion.get_settings", return_value=settings),
        patch("app.services.deletion.firebase_db.reference", side_effect=_ref),
    ):
        counts = deletion._cleanup_rtdb_for_user("alice", ["g1", "g2"])

    assert counts == {"presence": 2, "typing": 2, "watch": 1}
    deletes = {p for p, op in paths_touched if op == "delete"}
    assert "presence/g1/alice" in deletes
    assert "presence/g2/alice" in deletes
    assert "typing/g1/alice" in deletes
    assert "typing/g2/alice" in deletes
    assert "watch/g1/sess-a" in deletes
    # bob's session in g1 must NOT be deleted.
    assert "watch/g1/sess-b" not in deletes


def test_cleanup_rtdb_for_user_returns_zeros_when_no_gids() -> None:
    """No gids → nothing to clean; doesn't even consult settings or
    construct a database reference."""
    with patch("app.services.deletion.firebase_db.reference") as ref:
        counts = deletion._cleanup_rtdb_for_user("alice", [])
    assert counts == {"presence": 0, "typing": 0, "watch": 0}
    ref.assert_not_called()


def test_cleanup_rtdb_for_user_swallows_per_gid_errors() -> None:
    """An RTDB error on one gid should NOT abort cleanup for the
    others; finalize-account is best-effort on signal-channel data."""
    from app.config import Settings

    settings = Settings(firebase_database_url="https://demo-rtdb.firebaseio.com")

    def _ref(path: str, url: str | None = None) -> MagicMock:  # type: ignore[no-untyped-def]
        mock = MagicMock()
        if path == "presence/g1/alice":
            mock.delete.side_effect = RuntimeError("rtdb 503")
        if path.startswith("watch/"):
            mock.get.return_value = {}
        return mock

    with (
        patch("app.services.deletion.get_settings", return_value=settings),
        patch("app.services.deletion.firebase_db.reference", side_effect=_ref),
    ):
        counts = deletion._cleanup_rtdb_for_user("alice", ["g1", "g2"])

    # g1 presence failed; the other three succeeded.
    assert counts["presence"] == 1
    assert counts["typing"] == 2
    assert counts["watch"] == 0


def test_find_users_due_uses_cutoff() -> None:
    db = MagicMock()
    where_mock = MagicMock()
    db.collection.return_value.where.return_value = where_mock
    snap1 = MagicMock(id="alice")
    snap2 = MagicMock(id="bob")
    where_mock.stream.return_value = iter([snap1, snap2])

    fixed_now = datetime(2026, 5, 1, tzinfo=UTC)
    with patch("app.services.deletion._db", return_value=db):
        due = deletion.find_users_due(now=fixed_now)
    assert due == ["alice", "bob"]
    args = db.collection("users").where.call_args[0]
    assert args[0] == "deletionRequestedAt"
    assert args[1] == "<="
    cutoff = args[2]
    assert cutoff == fixed_now - timedelta(days=14)
