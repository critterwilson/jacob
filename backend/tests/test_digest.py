"""Tests for T35: digest assembly and unsubscribe token/endpoint."""

from __future__ import annotations

import time as _time
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.errors import http_exception_handler
from app.routers.account import router
from app.services.unsubscribe import mint_unsubscribe_token, verify_unsubscribe_token

# ── helpers ────────────────────────────────────────────────────────────────────


def _app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    return app


def _make_db(*, gids: list[str] | None = None) -> MagicMock:
    """Build a Firestore mock for assemble_user_payload."""
    gids = gids or []

    db = MagicMock()

    # users/{uid} and users/{uid}/private/profile
    user_snap = MagicMock()
    user_snap.to_dict.return_value = {"displayName": "Alice"}
    private_snap = MagicMock()
    private_snap.to_dict.return_value = {"email": "alice@example.com"}

    private_doc = MagicMock()
    private_doc.get.return_value = private_snap
    private_col = MagicMock()
    private_col.document.return_value = private_doc

    members_in_user = MagicMock()
    members_in_user.document.return_value.get.return_value = MagicMock(exists=True)

    def _user_subcol(name: str) -> MagicMock:
        if name == "private":
            return private_col
        if name == "members":
            return members_in_user
        return MagicMock()

    user_doc = MagicMock()
    user_doc.get.return_value = user_snap
    user_doc.collection.side_effect = _user_subcol

    users_col = MagicMock()
    users_col.document.return_value = user_doc

    # groups collection
    group_snaps = []
    for gid in gids:
        s = MagicMock()
        s.id = gid
        s.to_dict.return_value = {"name": gid}
        group_snaps.append(s)

    def _groups_doc(gid: str) -> MagicMock:
        d = MagicMock()
        g_snap = MagicMock()
        g_snap.to_dict.return_value = {"name": gid}
        d.get.return_value = g_snap

        mem_col = MagicMock()
        mem_snap = MagicMock()
        mem_snap.exists = True
        mem_col.document.return_value.get.return_value = mem_snap

        msg_col = MagicMock()
        msg_col.where.return_value.stream.return_value = iter([])

        def _group_subcol(name: str) -> MagicMock:
            if name == "members":
                return mem_col
            if name == "messages":
                return msg_col
            return MagicMock()

        d.collection.side_effect = _group_subcol
        return d

    groups_col = MagicMock()
    groups_col.stream.return_value = iter(group_snaps)
    groups_col.document.side_effect = _groups_doc

    def _collection(name: str) -> MagicMock:
        if name == "users":
            return users_col
        if name == "groups":
            return groups_col
        return MagicMock()

    db.collection.side_effect = _collection

    # CG members query: return one member snap per gid with reference.parent.parent.id == gid.
    member_cg_snaps = []
    for gid in gids:
        snap = MagicMock()
        snap.reference.parent.parent.id = gid
        member_cg_snaps.append(snap)
    db.collection_group.return_value.where.return_value.stream.return_value = iter(member_cg_snaps)

    return db


# ── tests ──────────────────────────────────────────────────────────────────────


def test_assemble_payload_user_with_groups() -> None:
    from app.services.digest import assemble_user_payload

    settings_mock = MagicMock()
    settings_mock.jacob_digest_enabled = True

    nm_mock = MagicMock()
    nm_mock.__iter__ = lambda s: iter([type("R", (), {"__getitem__": lambda self, k: 2})()])
    sticker_mock = MagicMock()
    sticker_mock.__iter__ = lambda s: iter(
        [type("R", (), {"__getitem__": lambda self, k: "fire" if k == "sticker_slug" else 4})()]
    )
    bq = MagicMock()
    bq.query.return_value.result.side_effect = [nm_mock, sticker_mock, nm_mock, sticker_mock]

    db = _make_db(gids=["g1"])
    with patch("app.services.digest.get_settings", return_value=settings_mock):
        payload = assemble_user_payload("uid1", db=db, bq_client=bq, dataset="ds")

    assert payload.display_name == "Alice"
    assert payload.email == "alice@example.com"
    assert len(payload.groups) == 1
    assert payload.groups[0].gid == "g1"
    assert not payload.quiet_week


def test_assemble_payload_user_with_zero_activity() -> None:
    from app.services.digest import assemble_user_payload

    settings_mock = MagicMock()
    settings_mock.jacob_digest_enabled = True

    db = _make_db(gids=["g1"])
    with patch("app.services.digest.get_settings", return_value=settings_mock):
        payload = assemble_user_payload("uid1", db=db, bq_client=None, dataset="ds")

    assert payload.quiet_week is True
    assert payload.missed_replies == 0
    assert payload.new_members == 0


def test_unsubscribe_token_round_trip() -> None:
    cfg = MagicMock(jwt_unsubscribe_secret="test-secret-key")
    with patch("app.services.unsubscribe.get_settings", return_value=cfg):
        token = mint_unsubscribe_token("uid42", "digest")
        uid, kind = verify_unsubscribe_token(token)

    assert uid == "uid42"
    assert kind == "digest"


def test_unsubscribe_token_expired_returns_400() -> None:
    cfg = MagicMock(jwt_unsubscribe_secret="test-secret", app_url="https://jacob.app")

    with patch("app.services.unsubscribe.get_settings", return_value=cfg):
        token = mint_unsubscribe_token("uid99", "digest")

    future_ts = _time.time() + 91 * 24 * 60 * 60 + 1
    client = TestClient(_app())
    with (
        patch("app.services.unsubscribe.get_settings", return_value=cfg),
        patch("app.routers.account.get_settings", return_value=cfg),
        patch("app.services.unsubscribe.time") as mock_time,
    ):
        mock_time.time.return_value = future_ts
        resp = client.get(f"/api/account/unsubscribe?token={token}")

    assert resp.status_code == 400
    assert "invalid" in resp.text.lower() or "expired" in resp.text.lower()


def test_unsubscribe_idempotent() -> None:
    db = MagicMock()
    prefs_ref = MagicMock()
    (
        db.collection.return_value.document.return_value.collection.return_value.document.return_value
    ) = prefs_ref
    cfg = MagicMock(jwt_unsubscribe_secret="test-secret", app_url="https://jacob.app")

    with patch("app.services.unsubscribe.get_settings", return_value=cfg):
        token = mint_unsubscribe_token("uid1", "digest")

    client = TestClient(_app())
    with (
        patch("app.services.unsubscribe.get_settings", return_value=cfg),
        patch("app.routers.account.get_firestore", return_value=db),
        patch("app.routers.account.get_settings", return_value=cfg),
    ):
        resp1 = client.get(f"/api/account/unsubscribe?token={token}")
        resp2 = client.get(f"/api/account/unsubscribe?token={token}")

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert prefs_ref.set.call_count == 2
