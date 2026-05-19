"""Tests for the M3 group-membership read endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.groups import router as groups_router


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
    app.include_router(groups_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _setup_member_db(*, members: list[tuple[str, str]], profiles: dict[str, dict]):
    """Mock harness: `members` = list of (uid, role); `profiles` = {uid: user-doc}."""
    db = MagicMock()
    # group + caller-membership read for require_member
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False, "name": "G"}
    caller_member_snap = MagicMock()
    caller_member_snap.exists = True
    caller_member_snap.to_dict.return_value = {"role": "member"}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    member_snaps = []
    for uid, role in members:
        m = MagicMock()
        m.id = uid
        m.exists = True
        m.to_dict.return_value = {"role": role, "joinedAt": datetime(2026, 5, 1, tzinfo=UTC)}
        member_snaps.append(m)

    def _members_doc(uid: str | None = None):
        if uid is None:
            return MagicMock()
        return MagicMock(get=MagicMock(return_value=caller_member_snap))

    members_col.document.side_effect = _members_doc
    members_col.stream.return_value = iter(member_snaps)
    group_ref.collection.return_value = members_col
    # The handler reads users via db.collection("users").document(uid)
    user_docs = []
    for uid, _ in members:
        d = MagicMock()
        d.id = uid
        d.exists = uid in profiles
        d.to_dict.return_value = profiles.get(uid, {})
        user_docs.append(d)
    db.get_all.return_value = user_docs

    # Distinguish db.collection("groups") vs db.collection("users").
    users_col = MagicMock()

    def _user_doc(uid: str | None = None):
        return MagicMock()

    users_col.document.side_effect = _user_doc

    def _coll(name: str):
        return group_ref.parent_groups if name == "groups" else users_col

    # The simplest harness: route every db.collection().document() to the
    # group_ref (since we only need the groups path for the dep + members
    # subcollection, and the users path for ref construction).
    db.collection.return_value.document.return_value = group_ref
    return db


def test_list_members_returns_joined_profiles() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _setup_member_db(
        members=[("alice", "leader"), ("bob", "member")],
        profiles={
            "alice": {"displayName": "Alice", "photoURL": "https://example.com/a.png"},
            "bob": {"displayName": "Bob", "photoURL": None},
        },
    )
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/members")
    assert res.status_code == 200
    members = res.json()["members"]
    by_uid = {m["uid"]: m for m in members}
    assert by_uid["alice"]["role"] == "leader"
    assert by_uid["alice"]["displayName"] == "Alice"
    assert by_uid["bob"]["displayName"] == "Bob"


def test_list_members_uses_uid_when_profile_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _setup_member_db(
        members=[("ghost", "member")],
        profiles={},  # no profile doc
    )
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/members")
    assert res.status_code == 200
    [member] = res.json()["members"]
    assert member["uid"] == "ghost"
    assert member["displayName"] == "ghost"


def test_list_members_403_for_non_member() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False}
    caller_member_snap = MagicMock()
    caller_member_snap.exists = False
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    group_ref.collection.return_value = members_col
    db.collection.return_value.document.return_value = group_ref
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/members")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_member"


def test_list_members_requires_auth() -> None:
    client = TestClient(_app(user=None))
    res = client.get("/api/groups/g1/members")
    assert res.status_code == 401


def test_my_membership_returns_role_for_caller() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False}
    caller_member_snap = MagicMock()
    caller_member_snap.exists = True
    caller_member_snap.to_dict.return_value = {
        "role": "leader",
        "joinedAt": datetime(2026, 4, 1, tzinfo=UTC),
    }
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    group_ref.collection.return_value = members_col
    db.collection.return_value.document.return_value = group_ref
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/me")
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "leader"
    assert body["uid"] == "alice"
    assert body["gid"] == "g1"


def test_get_group_returns_detail_with_invite_for_member() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "name": "Alpha",
        "description": "the first",
        "isPrivate": True,
        "memberCount": 4,
        "leaderCount": 1,
        "founderUid": "alice",
        "createdBy": "alice",
        "inviteCode": "SECRETCODE",
        "stickerSet": "christian",
        "pinnedMessageIds": [],
    }
    caller_member_snap = MagicMock()
    caller_member_snap.exists = True
    caller_member_snap.to_dict.return_value = {"role": "leader"}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    group_ref.collection.return_value = members_col
    db.collection.return_value.document.return_value = group_ref
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Alpha"
    assert body["inviteCode"] == "SECRETCODE"
    assert body["isPrivate"] is True


def test_get_group_redacts_invite_code_for_public_non_member() -> None:
    user = CurrentUser(uid="random", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "name": "Open",
        "isPrivate": False,
        "inviteCode": "PUBLICCODE",
    }
    caller_member_snap = MagicMock()
    caller_member_snap.exists = False
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    group_ref.collection.return_value = members_col
    db.collection.return_value.document.return_value = group_ref
    with patch("app.deps.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1")
    assert res.status_code == 200
    assert res.json()["inviteCode"] is None


def test_pinned_messages_resolves_ids_to_messages() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "isPrivate": False,
        "pinnedMessageIds": ["m1", "m2"],
    }
    caller_member_snap = MagicMock()
    caller_member_snap.exists = True
    caller_member_snap.to_dict.return_value = {"role": "member"}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    msgs_col = MagicMock()

    def _coll(name: str):
        return members_col if name == "members" else msgs_col

    group_ref.collection.side_effect = _coll
    db.collection.return_value.document.return_value = group_ref

    m1 = MagicMock(id="m1", exists=True)
    m1.to_dict.return_value = {"authorUid": "bob", "body": "first"}
    m2 = MagicMock(id="m2", exists=True)
    m2.to_dict.return_value = {"authorUid": "carol", "body": "second"}
    db.get_all.return_value = [m1, m2]

    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/pinned-messages")
    assert res.status_code == 200
    msgs = res.json()["messages"]
    assert [m["id"] for m in msgs] == ["m1", "m2"]


def test_pinned_messages_returns_empty_when_none_pinned() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"isPrivate": False, "pinnedMessageIds": []}
    caller_member_snap = MagicMock()
    caller_member_snap.exists = True
    caller_member_snap.to_dict.return_value = {"role": "member"}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    members_col = MagicMock()
    members_col.document.return_value.get.return_value = caller_member_snap
    group_ref.collection.return_value = members_col
    db.collection.return_value.document.return_value = group_ref
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        client = TestClient(_app(user))
        res = client.get("/api/groups/g1/pinned-messages")
    assert res.status_code == 200
    assert res.json() == {"messages": []}


# ── ETag / 304 ──────────────────────────────────────────────────────────


def test_list_members_etag_header_emitted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _setup_member_db(
        members=[("alice", "member")],
        profiles={"alice": {"displayName": "Alice", "photoURL": None}},
    )
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        res = TestClient(_app(user)).get("/api/groups/g1/members")
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')


def test_list_members_if_none_match_returns_304() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _setup_member_db(
        members=[("alice", "member")],
        profiles={"alice": {"displayName": "Alice", "photoURL": None}},
    )
    client = TestClient(_app(user))
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        first = client.get("/api/groups/g1/members")
    assert first.status_code == 200
    etag = first.headers["etag"]
    db2 = _setup_member_db(
        members=[("alice", "member")],
        profiles={"alice": {"displayName": "Alice", "photoURL": None}},
    )
    with (
        patch("app.deps.get_firestore", return_value=db2),
        patch("app.routers.groups.get_firestore", return_value=db2),
    ):
        second = client.get("/api/groups/g1/members", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.headers["etag"] == etag


def test_list_members_stale_etag_returns_200() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = _setup_member_db(
        members=[("alice", "member")],
        profiles={"alice": {"displayName": "Alice", "photoURL": None}},
    )
    with (
        patch("app.deps.get_firestore", return_value=db),
        patch("app.routers.groups.get_firestore", return_value=db),
    ):
        res = TestClient(_app(user)).get(
            "/api/groups/g1/members",
            headers={"If-None-Match": 'W/"stale-etag"'},
        )
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')
