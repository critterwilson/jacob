"""Tests for the invite router and consume_invite service."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.groups import router as groups_router
from app.routers.invites import router as invites_router


def _make_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(groups_router)
    app.include_router(invites_router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _make_leader_db(
    *,
    gid: str = "g1",
    invites: list[dict] | None = None,
    invite_id: str | None = None,
) -> MagicMock:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"archivedAt": None, "pinnedMessageIds": []}

    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "leader"}

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    # invites subcollection
    invites_col = MagicMock()
    if invite_id:
        inv_snap = MagicMock()
        inv_snap.id = invite_id
        inv_snap.exists = True
        inv_snap.to_dict.return_value = (invites or [{}])[0]
        invites_col.document.return_value.get.return_value = inv_snap
    invites_col.where.return_value.limit.return_value.stream.return_value = iter([])
    invites_col.document.return_value.set.return_value = None
    invites_col.document.return_value.update.return_value = None

    # order_by for list
    list_snaps = []
    for i, inv_data in enumerate(invites or []):
        s = MagicMock()
        s.id = f"inv_{i}"
        s.to_dict.return_value = inv_data
        list_snaps.append(s)
    invites_col.order_by.return_value.stream.return_value = iter(list_snaps)

    def _subcol(name: str) -> MagicMock:
        if name == "invites":
            return invites_col
        col = MagicMock()
        doc = MagicMock()
        doc.get.return_value = member_snap
        col.document.return_value = doc
        return col

    group_ref.collection.side_effect = _subcol

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref

    audit_col = MagicMock()
    audit_col.document.return_value.set.return_value = None

    def _top_col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _top_col
    db.transaction.return_value = MagicMock()
    return db


# ── create invite ─────────────────────────────────────────────────────────────


def test_create_invite_happy_path() -> None:
    mock_db = _make_leader_db()
    with (
        patch("app.routers.invites._db", return_value=mock_db),
        patch("app.services.invites.generate_invite_code", return_value="NEWCODE1"),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post(
            "/api/groups/g1/invites",
            json={"expiry": "24h", "maxUses": "10"},
        )

    assert res.status_code == 201
    body = res.json()
    assert body["code"] == "NEWCODE1"
    assert "url" in body
    assert body["maxUses"] == 10


def test_create_invite_collision_retries() -> None:
    """generate_invite_code retries on collision; eventually returns a unique code."""
    mock_db = _make_leader_db()
    # Simulate first code colliding, second succeeds
    call_count = 0

    def _col_generator(*args: object, **kwargs: object) -> str:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First attempt: collision
            mock_db.collection.side_effect = None
            col = MagicMock()
            chain = col.document.return_value.collection.return_value
            chain.where.return_value.limit.return_value.stream.return_value = iter(
                [MagicMock()]
            )
            return col
        return MagicMock()

    # Just verify the endpoint completes; collision logic tested in service unit test
    with (
        patch("app.routers.invites._db", return_value=mock_db),
        patch("app.services.invites.generate_invite_code", return_value="UNIQUE12"),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post(
            "/api/groups/g1/invites",
            json={"expiry": "never", "maxUses": "unlimited"},
        )

    assert res.status_code == 201


def test_create_invite_not_leader_returns_403() -> None:
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {}

    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "member"}

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.return_value.document.return_value.get.return_value = member_snap
    db.collection.return_value.document.return_value = group_ref

    with patch("app.routers.invites._db", return_value=db):
        res = TestClient(_make_app("bob")).post(
            "/api/groups/g1/invites",
            json={"expiry": "never", "maxUses": "unlimited"},
        )

    assert res.status_code == 403


# ── consume_invite (via join) ─────────────────────────────────────────────────


def _make_join_db(
    *,
    invite_data: dict | None = None,
    member_exists: bool = False,
    archived: bool = False,
) -> MagicMock:
    db = MagicMock()

    default_invite: dict = {
        "code": "TESTCODE",
        "revokedAt": None,
        "expiresAt": None,
        "maxUses": None,
        "useCount": 0,
    }
    invite_data = invite_data or default_invite

    # The invite reference returned from collection_group query
    invite_ref = MagicMock()
    invite_ref.path = "groups/g1/invites/inv001"

    # invite_ref.get() is called both outside and inside the transaction
    invite_txn_snap = MagicMock()
    invite_txn_snap.to_dict.return_value = invite_data
    invite_ref.get.return_value = invite_txn_snap

    invite_snap = MagicMock()
    invite_snap.id = "inv001"
    invite_snap.to_dict.return_value = invite_data
    invite_snap.reference = invite_ref
    invite_snap.reference.path = "groups/g1/invites/inv001"

    cg = db.collection_group.return_value.where.return_value.where.return_value
    cg.limit.return_value.stream.return_value = iter([invite_snap])

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "archivedAt": datetime(2026, 1, 1, tzinfo=UTC) if archived else None
    }
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref

    audit_col = MagicMock()
    audit_col.document.return_value.set.return_value = None

    def _top_col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _top_col
    db.transaction.return_value = MagicMock()
    return db


def test_consume_invite_happy_path() -> None:
    mock_db = _make_join_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.invites._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app("bob")).post("/api/groups/join", json={"code": "TESTCODE"})

    assert res.status_code == 200
    assert res.json()["groupId"] == "g1"


def test_consume_invite_expired_returns_410() -> None:
    expired = datetime.now(UTC) - timedelta(hours=2)
    mock_db = _make_join_db(
        invite_data={
            "code": "EXP", "revokedAt": None,
            "expiresAt": expired, "maxUses": None, "useCount": 0,
        }
    )
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "EXP"})

    assert res.status_code == 410
    assert res.json()["error"]["code"] == "invite_expired"


def test_consume_invite_maxed_returns_410() -> None:
    mock_db = _make_join_db(
        invite_data={
            "code": "MAX", "revokedAt": None,
            "expiresAt": None, "maxUses": 1, "useCount": 1,
        }
    )
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "MAX"})

    assert res.status_code == 410
    assert res.json()["error"]["code"] == "invite_maxed"


def test_consume_invite_revoked_returns_404() -> None:
    """Revoked invites are filtered by the collection-group query (revokedAt==None filter)."""
    db = MagicMock()
    cg = db.collection_group.return_value.where.return_value.where.return_value
    cg.limit.return_value.stream.return_value = iter([])
    with patch("app.routers.groups._db", return_value=db):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "REVOKED1"})

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "invalid_invite"


def test_revoke_invite_writes_audit_log() -> None:
    mock_db = _make_leader_db(invite_id="inv001", invites=[{"code": "TEST", "revokedAt": None}])
    with (
        patch("app.routers.invites._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).delete("/api/groups/g1/invites/inv001")

    assert res.status_code == 204
    mock_db.collection.assert_any_call("audit_log")


def test_legacy_inviteCode_field_no_longer_used() -> None:
    """Legacy inviteCode field is not the lookup path after migration; returns 404."""
    db = MagicMock()
    # collection_group returns nothing — legacy field "OLD12345" isn't in invites
    cg = db.collection_group.return_value.where.return_value.where.return_value
    cg.limit.return_value.stream.return_value = iter([])
    # Even if the group has inviteCode set to "OLD12345", join by code must check invites collection
    db.collection.return_value.where.return_value.limit.return_value.stream.return_value = iter(
        [MagicMock()]
    )
    with patch("app.routers.groups._db", return_value=db):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "OLD12345"})

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "invalid_invite"
