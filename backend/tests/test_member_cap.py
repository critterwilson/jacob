"""Tests for the member-cap soft limit feature.

Covers:
  - Cap enforcement in consume_invite (invite-code join)
  - Cap enforcement in create_join_request (open-mode direct join)
  - Cap enforcement in approve_join_request
  - PATCH /{gid}/cap endpoint (leader and platform-admin paths)
  - Cap validation (cap < memberCount rejected)
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.discover import router as discover_router
from app.routers.groups import router as groups_router


def _make_app(uid: str = "alice", is_admin: bool = False) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(groups_router)
    app.include_router(discover_router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )
    return app


# ── helpers ───────────────────────────────────────────────────────────────────


def _group_snap(*, member_count: int = 20, member_cap: int = 20, archived: bool = False) -> MagicMock:
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {
        "name": "Test",
        "description": "",
        "memberCount": member_count,
        "memberCap": member_cap,
        "archivedAt": "2024-01-01" if archived else None,
        "joinMode": "open",
        "isPrivate": False,
        "pinnedMessageIds": [],
        "leaderCount": 1,
        "founderUid": "leader",
        "inviteCode": "TESTCODE",
        "schemaVersion": 1,
    }
    return snap


# ── consume_invite cap enforcement ───────────────────────────────────────────


def test_consume_invite_group_at_cap_returns_409() -> None:
    """Joining via invite code when group is at cap returns group_at_cap."""
    from app.services.invites import consume_invite

    db = MagicMock()

    invite_data = {
        "code": "ABCD1234",
        "expiresAt": None,
        "maxUses": None,
        "useCount": 0,
        "revokedAt": None,
    }
    invite_snap = MagicMock()
    invite_snap.reference.path = "groups/g1/invites/inv1"
    invite_snap.id = "inv1"
    invite_snap.to_dict.return_value = invite_data

    db.collection_group.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = iter(
        [invite_snap]
    )

    # Group is at cap (20/20).
    group_snap = _group_snap(member_count=20, member_cap=20)
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.path = "groups/g1"

    member_snap = MagicMock()
    member_snap.exists = False

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap
    group_ref.collection.return_value = members_col

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    # Transaction: re-read invite + group + member atomically.
    txn = MagicMock()
    db.transaction.return_value = txn

    # Simulate transactional reads: invite → same data; group → at-cap; member → not exists.
    txn_invite_snap = MagicMock()
    txn_invite_snap.to_dict.return_value = invite_data
    txn_group_snap = MagicMock()
    txn_group_snap.to_dict.return_value = group_snap.to_dict()
    txn_member_snap = MagicMock()
    txn_member_snap.exists = False

    call_order: list[MagicMock] = [txn_invite_snap, txn_member_snap, txn_group_snap]

    def _txn_get(ref: MagicMock, transaction: MagicMock = None) -> MagicMock:
        return call_order.pop(0)

    invite_snap.reference.get = _txn_get
    members_col.document.return_value.get = _txn_get
    group_ref.get = lambda transaction=None: txn_group_snap

    # Patch the transactional decorator to execute the inner function directly.
    from google.cloud import firestore as gcf
    import functools

    def _run_immediately(fn):  # type: ignore[no-untyped-def]
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(txn, *args[1:], **kwargs)
        return wrapper

    with patch.object(gcf, "transactional", side_effect=_run_immediately):
        import importlib
        import app.services.invites as invites_mod
        importlib.reload(invites_mod)

    # The real test: call the service with a mocked db that simulates at-cap.
    from fastapi import HTTPException as FHE
    import pytest

    # Directly test that the error is raised — use a fresh mock that has the
    # transaction execute the _run body and hit the cap check.
    from app.errors import APIError

    # Simpler approach: build a db mock that forces the transactional function
    # to see memberCount >= memberCap.
    db2 = MagicMock()

    inv_snap2 = MagicMock()
    inv_snap2.reference.path = "groups/g1/invites/inv1"
    inv_snap2.id = "inv1"
    inv_snap2.to_dict.return_value = invite_data

    db2.collection_group.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = iter(
        [inv_snap2]
    )

    g_snap2 = _group_snap(member_count=20, member_cap=20)
    g_ref2 = MagicMock()
    g_ref2.get.return_value = g_snap2
    g_ref2.path = "groups/g1"

    mem_snap2 = MagicMock()
    mem_snap2.exists = False
    mem_col2 = MagicMock()
    mem_col2.document.return_value.get.return_value = mem_snap2
    g_ref2.collection.return_value = mem_col2

    grp_col2 = MagicMock()
    grp_col2.document.return_value = g_ref2
    db2.collection.return_value = grp_col2

    txn2 = MagicMock()
    db2.transaction.return_value = txn2

    # Patch @gcf.transactional to be a pass-through that calls with the transaction.
    inv_txn_snap = MagicMock()
    inv_txn_snap.to_dict.return_value = invite_data
    inv_snap2.reference.get = lambda transaction=None: inv_txn_snap
    mem_snap2_txn = MagicMock()
    mem_snap2_txn.exists = False
    mem_col2.document.return_value.get = lambda transaction=None: mem_snap2_txn
    g_ref2.get = lambda transaction=None: g_snap2

    called_with: list[dict] = []

    def fake_transactional(fn):  # type: ignore[no-untyped-def]
        @functools.wraps(fn)
        def wrapper(txn_arg):
            try:
                fn(txn_arg)
            except APIError as e:
                called_with.append({"code": e.detail["error"]["code"]})
                raise
        return wrapper

    with patch("app.services.invites.gcf.transactional", side_effect=fake_transactional):
        from app.services.invites import consume_invite as _ci
        with pytest.raises(APIError) as exc_info:
            _ci(db2, "ABCD1234", "bob")

    assert exc_info.value.detail["error"]["code"] == "group_at_cap"
    assert exc_info.value.status_code == 409


# ── open-mode join cap enforcement ───────────────────────────────────────────


def test_open_join_at_cap_returns_409() -> None:
    """POST /api/groups/{gid}/join-requests on a full open group returns 409."""
    db = MagicMock()
    group_snap = _group_snap(member_count=20, member_cap=20)
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    member_snap = MagicMock()
    member_snap.exists = False

    def _subcol(name: str) -> MagicMock:
        col = MagicMock()
        col.document.return_value.get.return_value = member_snap
        return col

    group_ref.collection.side_effect = _subcol

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    # Transaction: _open_join_txn sees group at cap.
    txn = MagicMock()
    db.transaction.return_value = txn

    # Patch transactional so it executes immediately with our txn.
    import functools
    from app.errors import APIError

    def fake_transactional(fn):  # type: ignore[no-untyped-def]
        @functools.wraps(fn)
        def wrapper(txn_arg):
            # Simulate reads inside the txn.
            group_ref.get = lambda transaction=None: group_snap
            fn(txn_arg)
        return wrapper

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", side_effect=fake_transactional),
        patch("app.routers.discover.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.post(
            "/api/groups/g1/join-requests",
            json={"message": ""},
            headers={"Authorization": "Bearer t"},
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "group_at_cap"


def test_open_join_under_cap_succeeds() -> None:
    """POST /api/groups/{gid}/join-requests succeeds when group is under cap."""
    db = MagicMock()
    group_snap = _group_snap(member_count=5, member_cap=20)
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    member_snap = MagicMock()
    member_snap.exists = False

    def _subcol(name: str) -> MagicMock:
        col = MagicMock()
        col.document.return_value.get.return_value = member_snap
        return col

    group_ref.collection.side_effect = _subcol
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    txn = MagicMock()
    db.transaction.return_value = txn

    import functools

    def fake_transactional(fn):  # type: ignore[no-untyped-def]
        @functools.wraps(fn)
        def wrapper(txn_arg):
            group_ref.get = lambda transaction=None: group_snap
            member_snap_txn = MagicMock()
            member_snap_txn.exists = False
            # Patch the member_ref.get inside the txn.
            def _txn_member_get(transaction=None):  # type: ignore[no-untyped-def]
                return member_snap_txn
            group_ref.collection.return_value.document.return_value.get = _txn_member_get
            fn(txn_arg)
        return wrapper

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", side_effect=fake_transactional),
        patch("app.routers.discover.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.post(
            "/api/groups/g1/join-requests",
            json={"message": ""},
            headers={"Authorization": "Bearer t"},
        )

    assert res.status_code == 200
    assert res.json()["joined"] is True


# ── approve_join_request cap enforcement ─────────────────────────────────────


def _leader_membership_dep(gid: str, uid: str) -> MagicMock:
    from app.deps import MembershipContext
    ctx = MagicMock(spec=MembershipContext)
    ctx.uid = uid
    ctx.gid = gid
    ctx.role = "leader"
    ctx.group = {"memberCount": 20, "memberCap": 20, "archivedAt": None}
    return ctx


def test_approve_join_request_at_cap_returns_409() -> None:
    """Approving a join request when group is at cap returns group_at_cap."""
    from app.deps import MembershipContext, require_leader

    db = MagicMock()

    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {"status": "pending"}

    jr_ref = MagicMock()
    jr_ref.get = lambda transaction=None: jr_snap

    group_snap = _group_snap(member_count=20, member_cap=20)
    group_ref = MagicMock()
    group_ref.get = lambda transaction=None: group_snap

    groups_col = MagicMock()

    def _doc(gid: str) -> MagicMock:
        ref = MagicMock()
        ref.get.return_value = group_snap

        jr_col = MagicMock()
        jr_col.document.return_value = jr_ref

        members_col = MagicMock()
        members_col.document.return_value.get.return_value = MagicMock(exists=False)

        def _subcol(name: str) -> MagicMock:
            if name == "joinRequests":
                return jr_col
            return members_col

        ref.collection.side_effect = _subcol
        return ref

    groups_col.document.side_effect = _doc
    db.collection.return_value = groups_col

    txn = MagicMock()
    db.transaction.return_value = txn

    import functools
    from app.errors import APIError

    def fake_transactional(fn):  # type: ignore[no-untyped-def]
        @functools.wraps(fn)
        def wrapper(txn_arg):
            fn(txn_arg)
        return wrapper

    def _leader_dep() -> MagicMock:
        return _leader_membership_dep("g1", "alice")

    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(discover_router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid="alice", email="alice@example.com", claims={}
    )
    app.dependency_overrides[require_leader] = _leader_dep

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", side_effect=fake_transactional),
        patch("app.routers.discover.write_audit_log"),
    ):
        client = TestClient(app)
        res = client.post(
            "/api/groups/g1/join-requests/bob/approve",
            headers={"Authorization": "Bearer t"},
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "group_at_cap"


# ── PATCH /{gid}/cap endpoint ─────────────────────────────────────────────────


def _make_groups_cap_db(*, member_count: int = 5, member_cap: int = 20, uid_is_leader: bool = True) -> MagicMock:
    db = MagicMock()

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "memberCount": member_count,
        "memberCap": member_cap,
        "archivedAt": None,
        "name": "Test",
        "description": "",
        "isPrivate": False,
        "leaderCount": 1,
        "founderUid": "alice",
        "inviteCode": "CODE1",
        "pinnedMessageIds": [],
    }

    member_snap = MagicMock()
    member_snap.exists = uid_is_leader
    member_snap.to_dict.return_value = {"role": "leader" if uid_is_leader else "member"}

    members_col = MagicMock()
    members_col.document.return_value.get.return_value = member_snap

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.return_value = members_col

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    return db


def test_patch_cap_leader_can_raise() -> None:
    db = _make_groups_cap_db(member_count=5, member_cap=20)
    with (
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.patch(
            "/api/groups/g1/cap",
            json={"memberCap": 30},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["memberCap"] == 30


def test_patch_cap_admin_can_raise_without_membership() -> None:
    db = _make_groups_cap_db(member_count=5, member_cap=20, uid_is_leader=False)
    with (
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log"),
    ):
        client = TestClient(_make_app(is_admin=True))
        res = client.patch(
            "/api/groups/g1/cap",
            json={"memberCap": 50},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["memberCap"] == 50


def test_patch_cap_below_member_count_rejected() -> None:
    db = _make_groups_cap_db(member_count=25, member_cap=25)
    with (
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.patch(
            "/api/groups/g1/cap",
            json={"memberCap": 10},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "cap_below_count"


def test_patch_cap_non_leader_forbidden() -> None:
    db = _make_groups_cap_db(member_count=5, member_cap=20, uid_is_leader=False)
    with (
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.patch(
            "/api/groups/g1/cap",
            json={"memberCap": 30},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 403


def test_patch_cap_zero_rejected_by_validation() -> None:
    """memberCap=0 fails pydantic validation (ge=1)."""
    db = _make_groups_cap_db()
    with (
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.write_audit_log"),
    ):
        client = TestClient(_make_app())
        res = client.patch(
            "/api/groups/g1/cap",
            json={"memberCap": 0},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 422
