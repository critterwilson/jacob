"""Tests for `GET /api/users/me/orgs`."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.users import router as users_router


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
    app.include_router(users_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _admin_snap(*, org_id: str, uid: str) -> MagicMock:
    snap = MagicMock()
    snap.id = uid
    snap.to_dict.return_value = {"uid": uid, "addedBy": "system", "addedAt": None}
    parent_org = MagicMock()
    parent_org.id = org_id
    snap.reference.parent.parent = parent_org
    return snap


def _member_snap(*, gid: str, uid: str) -> MagicMock:
    snap = MagicMock()
    snap.id = uid
    snap.to_dict.return_value = {"uid": uid, "role": "member"}
    parent_group = MagicMock()
    parent_group.id = gid
    snap.reference.parent.parent = parent_group
    return snap


def _group_doc(gid: str, *, org_id: str | None = None) -> MagicMock:
    doc = MagicMock()
    doc.id = gid
    doc.exists = True
    doc.to_dict.return_value = {"name": f"Group {gid}", "orgId": org_id}
    return doc


def _org_doc(org_id: str, *, name: str = "Test Org", slug: str = "test") -> MagicMock:
    doc = MagicMock()
    doc.id = org_id
    doc.exists = True
    doc.to_dict.return_value = {
        "name": name,
        "slug": slug,
        "audience": "christian",
        "logoUrl": None,
    }
    return doc


def test_my_orgs_returns_admin_org() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    db.collection_group.return_value.where.return_value.stream.side_effect = [
        iter([_admin_snap(org_id="o1", uid="alice")]),  # admins query
        iter([]),  # members query
    ]
    db.get_all.return_value = [_org_doc("o1", name="Grace Church", slug="grace")]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/orgs")

    assert res.status_code == 200
    data = res.json()
    assert len(data["orgs"]) == 1
    assert data["orgs"][0]["orgId"] == "o1"
    assert data["orgs"][0]["role"] == "admin"
    assert data["orgs"][0]["slug"] == "grace"


def test_my_orgs_derives_member_from_group_orgid() -> None:
    user = CurrentUser(uid="bob", email=None, claims={})
    db = MagicMock()
    group_snap = _member_snap(gid="g1", uid="bob")
    group_doc = _group_doc("g1", org_id="o2")
    group_snap.reference.parent.parent.get.return_value = group_doc

    db.collection_group.return_value.where.return_value.stream.side_effect = [
        iter([]),  # admins query — no admin memberships
        iter([group_snap]),  # members query
    ]
    db.get_all.return_value = [_org_doc("o2", name="Hope Network", slug="hope")]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/orgs")

    assert res.status_code == 200
    orgs = res.json()["orgs"]
    assert len(orgs) == 1
    assert orgs[0]["role"] == "member"


def test_my_orgs_admin_role_takes_precedence_over_member() -> None:
    """If a user is both an org admin and a group member of the same org,
    the response should report 'admin', not 'member'."""
    user = CurrentUser(uid="carol", email=None, claims={})
    db = MagicMock()

    admin_snap = _admin_snap(org_id="o3", uid="carol")
    member_snap = _member_snap(gid="g3", uid="carol")
    group_doc = _group_doc("g3", org_id="o3")
    member_snap.reference.parent.parent.get.return_value = group_doc

    db.collection_group.return_value.where.return_value.stream.side_effect = [
        iter([admin_snap]),  # admins query
        iter([member_snap]),  # members query
    ]
    db.get_all.return_value = [_org_doc("o3")]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/orgs")

    assert res.status_code == 200
    orgs = res.json()["orgs"]
    assert len(orgs) == 1
    assert orgs[0]["role"] == "admin"


def test_my_orgs_empty_when_no_memberships() -> None:
    user = CurrentUser(uid="dave", email=None, claims={})
    db = MagicMock()
    db.collection_group.return_value.where.return_value.stream.side_effect = [
        iter([]),
        iter([]),
    ]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/orgs")

    assert res.status_code == 200
    assert res.json() == {"orgs": []}


def test_my_orgs_skips_groups_without_orgid() -> None:
    user = CurrentUser(uid="eve", email=None, claims={})
    db = MagicMock()

    # Group has no orgId set
    member_snap = _member_snap(gid="g99", uid="eve")
    group_doc = _group_doc("g99", org_id=None)
    member_snap.reference.parent.parent.get.return_value = group_doc

    db.collection_group.return_value.where.return_value.stream.side_effect = [
        iter([]),
        iter([member_snap]),
    ]

    with patch("app.routers.users.get_firestore", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/users/me/orgs")

    assert res.status_code == 200
    assert res.json() == {"orgs": []}


def test_my_orgs_requires_auth() -> None:
    client = TestClient(_app())  # no user override
    res = client.get("/api/users/me/orgs")
    assert res.status_code == 401
