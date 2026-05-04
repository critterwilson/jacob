"""Tests for the T22 leader-hierarchy endpoints.

POST /api/groups/{gid}/leaders/{uid}/promote
POST /api/groups/{gid}/leaders/{uid}/demote
POST /api/groups/{gid}/founder/transfer
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser


def _client(uid: str) -> TestClient:
    from app.routers.groups import router

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return TestClient(app, raise_server_exceptions=False)


def _build_db(
    *,
    group_data: dict | None = None,
    members: dict[str, dict] | None = None,
) -> MagicMock:
    """members keyed by uid → member doc data; absent uid means no member doc."""
    db = MagicMock()
    members = members or {}

    group_snap = MagicMock()
    if group_data is None:
        group_snap.exists = False
    else:
        group_snap.exists = True
        group_snap.to_dict.return_value = group_data

    def _members_doc(uid: str) -> MagicMock:
        ref = MagicMock()
        snap = MagicMock()
        if uid in members:
            snap.exists = True
            snap.to_dict.return_value = members[uid]
        else:
            snap.exists = False
        ref.get.return_value = snap
        return ref

    members_col = MagicMock()
    members_col.document.side_effect = _members_doc

    group_doc = MagicMock()
    group_doc.collection.return_value = members_col
    group_doc.get.return_value = group_snap

    groups_col = MagicMock()
    groups_col.document.return_value = group_doc

    audit_col = MagicMock()

    def _col(name: str) -> MagicMock:
        return {"groups": groups_col, "audit_log": audit_col}.get(name, MagicMock())

    db.collection.side_effect = _col
    # Transaction mock: delegate get() to the ref so the transactional
    # function sees the correct document state.
    txn = MagicMock()
    txn.get.side_effect = lambda ref: ref.get()
    db.transaction.return_value = txn
    return db


# ── promote ────────────────────────────────────────────────────────────────────


def test_leader_can_promote_member() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}, "bob": {"role": "member"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("alice").post("/api/groups/g1/leaders/bob/promote")
    assert r.status_code == 200
    body = r.json()
    assert body == {"gid": "g1", "uid": "bob", "role": "leader"}


def test_non_leader_cannot_promote() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}, "bob": {"role": "member"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("bob").post("/api/groups/g1/leaders/alice/promote")
    assert r.status_code == 403


def test_promote_already_leader_returns_409() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("alice").post("/api/groups/g1/leaders/bob/promote")
    assert r.status_code == 409


def test_promote_non_member_returns_404() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("alice").post("/api/groups/g1/leaders/eve/promote")
    assert r.status_code == 404


# ── demote ────────────────────────────────────────────────────────────────────


def test_leader_can_demote_other_leader() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("alice").post("/api/groups/g1/leaders/bob/demote")
    assert r.status_code == 200
    assert r.json()["role"] == "member"


def test_cannot_demote_founder() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("bob").post("/api/groups/g1/leaders/alice/demote")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "founder_immutable"


def test_self_demote_blocked_when_only_leader() -> None:
    # The leaderCount check matters when the self-demoter isn't the
    # founder (the founder gets the more specific founder_immutable
    # error first). Bob is the only leader but not the founder.
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("bob").post("/api/groups/g1/leaders/bob/demote")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "last_leader"


def test_self_demote_allowed_when_other_leaders_exist() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("bob").post("/api/groups/g1/leaders/bob/demote")
    assert r.status_code == 200


def test_demote_non_leader_returns_409() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}, "bob": {"role": "member"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.routers.groups.gcf.transactional", lambda f: f),
    ):
        r = _client("alice").post("/api/groups/g1/leaders/bob/demote")
    assert r.status_code == 409


# ── founder transfer ──────────────────────────────────────────────────────────


def test_founder_can_transfer_to_another_leader() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        r = _client("alice").post(
            "/api/groups/g1/founder/transfer",
            json={"targetUid": "bob"},
        )
    assert r.status_code == 200
    assert r.json() == {"gid": "g1", "founderUid": "bob"}


def test_non_founder_cannot_transfer() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 2},
        members={"alice": {"role": "leader"}, "bob": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("bob").post(
            "/api/groups/g1/founder/transfer",
            json={"targetUid": "alice"},
        )
    assert r.status_code == 403


def test_transfer_to_non_leader_returns_409() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}, "bob": {"role": "member"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("alice").post(
            "/api/groups/g1/founder/transfer",
            json={"targetUid": "bob"},
        )
    assert r.status_code == 409


def test_transfer_to_self_returns_400() -> None:
    db = _build_db(
        group_data={"founderUid": "alice", "leaderCount": 1},
        members={"alice": {"role": "leader"}},
    )
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db", return_value=db),
    ):
        r = _client("alice").post(
            "/api/groups/g1/founder/transfer",
            json={"targetUid": "alice"},
        )
    assert r.status_code == 400


# ── 403 banned coverage (PR1 sweep) ─────────────────────────────────────────


def test_promote_member_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        r = _client("alice").post("/api/groups/g1/leaders/bob/promote")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "banned"


def test_demote_member_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        r = _client("alice").post("/api/groups/g1/leaders/bob/demote")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "banned"


def test_transfer_founder_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        r = _client("alice").post("/api/groups/g1/founder/transfer", json={"targetUid": "bob"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "banned"
