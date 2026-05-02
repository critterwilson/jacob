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
