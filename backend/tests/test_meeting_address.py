"""Tests for the group meeting-address router + discovery.

Geocoding is mocked at the module level (`app.routers.meeting_address.geocode`)
so no test touches the network. Firestore is mocked via the same `_db`
patch pattern used by `test_weekly_sermon.py`; auth/membership deps are
overridden with `dependency_overrides`.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import (
    MembershipContext,
    PublicReadContext,
    get_current_user,
    require_leader,
    require_member_or_public,
    require_ministry_owner,
    require_not_banned,
)
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.meeting_address import admin_router, haversine_km
from app.routers.meeting_address import router as ma_router
from app.services.geocoding import GeocodeResult


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


def _base_app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(  # type: ignore[arg-type]
        RequestValidationError, validation_exception_handler
    )
    app.state.limiter = limiter
    app.include_router(ma_router)
    app.include_router(admin_router)
    return app


def _group_doc(**overrides: Any) -> dict[str, Any]:
    g: dict[str, Any] = {
        "name": "Pleasant Grove Tuesday",
        "isPrivate": False,
        "archivedAt": None,
    }
    g.update(overrides)
    return g


def _address(**overrides: Any) -> dict[str, Any]:
    a: dict[str, Any] = {
        "street": "123 Main St",
        "city": "Provo",
        "state": "UT",
        "postalCode": "84601",
        "country": "USA",
        "lat": 40.2338,
        "lng": -111.6585,
        "geocodedAt": "2026-05-31T00:00:00+00:00",
    }
    a.update(overrides)
    return a


def _leader_ctx(gid: str = "g1", group: dict[str, Any] | None = None) -> MembershipContext:
    return MembershipContext(gid=gid, uid="leader", role="leader", group=group or _group_doc())


def _member_ctx(gid: str = "g1", group: dict[str, Any] | None = None) -> MembershipContext:
    return MembershipContext(gid=gid, uid="member", role="member", group=group or _group_doc())


def _public_ctx(gid: str = "g1", group: dict[str, Any] | None = None) -> PublicReadContext:
    return PublicReadContext(gid=gid, uid="stranger", group=group or _group_doc())


def _doc_db(group: dict[str, Any] | None = None) -> tuple[MagicMock, MagicMock]:
    """A db mock whose groups/{gid} doc resolves to `group`."""
    db = MagicMock()
    snap = MagicMock()
    snap.exists = group is not None
    snap.to_dict.return_value = group or {}
    snap.id = "g1"
    ref = MagicMock()
    ref.get.return_value = snap
    col = MagicMock()
    col.document.return_value = ref
    db.collection.side_effect = lambda name: col if name == "groups" else MagicMock()
    return db, ref


# ── haversine ────────────────────────────────────────────────────────────────


def test_haversine_zero_for_same_point() -> None:
    assert haversine_km(40.0, -111.0, 40.0, -111.0) == pytest.approx(0.0, abs=1e-6)


def test_haversine_known_distance() -> None:
    # Provo, UT → Salt Lake City, UT is roughly 70 km.
    d = haversine_km(40.2338, -111.6585, 40.7608, -111.8910)
    assert 55.0 < d < 75.0


# ── PUT: leader sets visibility ──────────────────────────────────────────────


def test_leader_set_private_applies_immediately() -> None:
    app = _base_app()
    app.dependency_overrides[require_leader] = lambda: _leader_ctx()
    db, ref = _doc_db(_group_doc())
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.geocode", return_value=GeocodeResult(1.0, 2.0)),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).put(
            "/api/groups/g1/meeting-address",
            json={"street": "1 A St", "city": "Provo", "visibility": "private"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["visibility"] == "private"
    assert body["pendingPublic"] is False
    written = ref.update.call_args[0][0]
    assert written["meetingAddressVisibility"] == "private"
    assert written["meetingAddressPendingPublic"] is False
    assert written["meetingAddress"]["lat"] == 1.0


def test_leader_set_members_only_applies_immediately() -> None:
    app = _base_app()
    app.dependency_overrides[require_leader] = lambda: _leader_ctx()
    db, ref = _doc_db(_group_doc())
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.geocode", return_value=GeocodeResult(1.0, 2.0)),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).put(
            "/api/groups/g1/meeting-address",
            json={"street": "1 A St", "city": "Provo", "visibility": "members_only"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["visibility"] == "members_only"
    assert res.json()["pendingPublic"] is False


def test_leader_request_public_goes_pending_not_published() -> None:
    app = _base_app()
    app.dependency_overrides[require_leader] = lambda: _leader_ctx()
    db, ref = _doc_db(_group_doc())
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.geocode", return_value=GeocodeResult(1.0, 2.0)),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).put(
            "/api/groups/g1/meeting-address",
            json={"street": "1 A St", "city": "Provo", "visibility": "public"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    # NOT published yet — held at members_only with pending flag.
    assert body["visibility"] == "members_only"
    assert body["pendingPublic"] is True
    written = ref.update.call_args[0][0]
    assert written["meetingAddressVisibility"] == "members_only"
    assert written["meetingAddressPendingPublic"] is True


def test_geocode_failure_stores_null_coords_no_500() -> None:
    app = _base_app()
    app.dependency_overrides[require_leader] = lambda: _leader_ctx()
    db, ref = _doc_db(_group_doc())
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.geocode", return_value=None),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).put(
            "/api/groups/g1/meeting-address",
            json={"street": "nowhere", "city": "void", "visibility": "private"},
        )
    assert res.status_code == 200, res.text
    written = ref.update.call_args[0][0]
    assert written["meetingAddress"]["lat"] is None
    assert written["meetingAddress"]["lng"] is None


def test_non_leader_cannot_set() -> None:
    # No require_leader override: a non-leader hits the real dep, which
    # reads membership via get_firestore (mocked by conftest to "member").
    app = _base_app()
    member = CurrentUser(uid="member", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: member
    app.dependency_overrides[require_not_banned] = lambda: member
    # Provide a group + member doc so require_member sees a *member* (not leader).
    db = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = _group_doc()
    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": "member"}
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    members_col = MagicMock()
    members_col.document.return_value = member_ref
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap
    group_ref.collection.return_value = members_col
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.side_effect = lambda name: groups_col if name == "groups" else MagicMock()
    with patch("app.deps.get_firestore", return_value=db):
        res = TestClient(app).put(
            "/api/groups/g1/meeting-address",
            json={"street": "1 A St", "city": "Provo", "visibility": "private"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_leader"


# ── GET: visibility enforcement ──────────────────────────────────────────────


def _get(access_ctx: Any, group: dict[str, Any]) -> dict[str, Any]:
    app = _base_app()
    app.dependency_overrides[require_member_or_public] = lambda: access_ctx
    db, _ = _doc_db(group)
    with patch("app.routers.meeting_address._db", return_value=db):
        res = TestClient(app).get("/api/groups/g1/meeting-address")
    assert res.status_code == 200, res.text
    return res.json()


def test_get_private_hidden_from_member_visible_to_leader() -> None:
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="private",
    )
    # member sees nothing
    member_body = _get(_member_ctx(group=group), group)
    assert member_body["address"] is None
    assert member_body["canManage"] is False
    # leader always sees it
    leader_body = _get(_leader_ctx(group=group), group)
    assert leader_body["address"] is not None
    assert leader_body["canManage"] is True


def test_get_members_only_visible_to_member_hidden_from_stranger() -> None:
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="members_only",
    )
    member_body = _get(_member_ctx(group=group), group)
    assert member_body["address"] is not None
    stranger_body = _get(_public_ctx(group=group), group)
    assert stranger_body["address"] is None


def test_get_public_visible_to_stranger() -> None:
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="public",
    )
    stranger_body = _get(_public_ctx(group=group), group)
    assert stranger_body["address"] is not None
    assert stranger_body["visibility"] == "public"


def test_get_pending_flag_only_for_leader() -> None:
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="members_only",
        meetingAddressPendingPublic=True,
    )
    leader_body = _get(_leader_ctx(group=group), group)
    assert leader_body["pendingPublic"] is True
    member_body = _get(_member_ctx(group=group), group)
    assert member_body["pendingPublic"] is False


def test_get_legacy_group_without_fields_is_private_empty() -> None:
    group = _group_doc()  # no meetingAddress* fields
    member_body = _get(_member_ctx(group=group), group)
    assert member_body["address"] is None
    assert member_body["visibility"] == "private"


# ── owner approve / reject ───────────────────────────────────────────────────


def test_owner_approve_flips_to_public() -> None:
    app = _base_app()
    owner = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    app.dependency_overrides[require_ministry_owner] = lambda: owner
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="members_only",
        meetingAddressPendingPublic=True,
    )
    db, ref = _doc_db(group)
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).post("/api/admin/meeting-address/g1/approve")
    assert res.status_code == 200, res.text
    assert res.json()["visibility"] == "public"
    assert res.json()["pendingPublic"] is False
    written = ref.update.call_args[0][0]
    assert written["meetingAddressVisibility"] == "public"
    assert written["meetingAddressPendingPublic"] is False


def test_owner_approve_409_when_nothing_pending() -> None:
    app = _base_app()
    owner = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    app.dependency_overrides[require_ministry_owner] = lambda: owner
    group = _group_doc(meetingAddress=_address(), meetingAddressVisibility="members_only")
    db, _ = _doc_db(group)
    with patch("app.routers.meeting_address._db", return_value=db):
        res = TestClient(app).post("/api/admin/meeting-address/g1/approve")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "no_pending_request"


def test_owner_reject_clears_pending_keeps_members_only() -> None:
    app = _base_app()
    owner = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    app.dependency_overrides[require_ministry_owner] = lambda: owner
    group = _group_doc(
        meetingAddress=_address(),
        meetingAddressVisibility="members_only",
        meetingAddressPendingPublic=True,
    )
    db, ref = _doc_db(group)
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch("app.routers.meeting_address.write_audit_log"),
    ):
        res = TestClient(app).post("/api/admin/meeting-address/g1/reject")
    assert res.status_code == 200, res.text
    assert res.json()["visibility"] == "members_only"
    assert res.json()["pendingPublic"] is False
    written = ref.update.call_args[0][0]
    assert written["meetingAddressPendingPublic"] is False


def test_pending_list_returns_only_flagged_groups() -> None:
    app = _base_app()
    owner = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    app.dependency_overrides[require_ministry_owner] = lambda: owner

    g1 = _group_doc(meetingAddress=_address(), meetingAddressPendingPublic=True)
    snap = MagicMock()
    snap.id = "g1"
    snap.to_dict.return_value = g1

    query = MagicMock()
    query.where.return_value = query
    query.limit.return_value = query
    query.stream.return_value = iter([snap])
    col = MagicMock()
    col.where.return_value = query
    db = MagicMock()
    db.collection.side_effect = lambda name: col if name == "groups" else MagicMock()

    with patch("app.routers.meeting_address._db", return_value=db):
        res = TestClient(app).get("/api/admin/meeting-address/pending")
    assert res.status_code == 200, res.text
    reqs = res.json()["requests"]
    assert len(reqs) == 1
    assert reqs[0]["gid"] == "g1"


# ── discover nearby ──────────────────────────────────────────────────────────


def _nearby_db(groups: list[tuple[str, dict[str, Any]]]) -> MagicMock:
    snaps = []
    for gid, data in groups:
        s = MagicMock()
        s.id = gid
        s.to_dict.return_value = data
        snaps.append(s)
    query = MagicMock()
    query.where.return_value = query
    query.stream.return_value = iter(snaps)
    col = MagicMock()
    col.where.return_value = query
    db = MagicMock()
    db.collection.side_effect = lambda name: col if name == "groups" else MagicMock()
    return db


def test_discover_returns_public_sorted_by_distance() -> None:
    app = _base_app()
    user = CurrentUser(uid="visitor", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: user

    far = _group_doc(
        name="Far",
        meetingAddressVisibility="public",
        meetingAddress=_address(lat=41.0, lng=-111.0),
    )
    near = _group_doc(
        name="Near",
        meetingAddressVisibility="public",
        meetingAddress=_address(lat=40.01, lng=-111.0),
    )
    db = _nearby_db([("far", far), ("near", near)])
    with patch("app.routers.meeting_address._db", return_value=db):
        res = TestClient(app).get("/api/groups/discover/nearby?lat=40.0&lng=-111.0")
    assert res.status_code == 200, res.text
    groups = res.json()["groups"]
    assert [g["gid"] for g in groups] == ["near", "far"]
    assert groups[0]["distanceKm"] <= groups[1]["distanceKm"]


def test_discover_skips_groups_without_coords() -> None:
    app = _base_app()
    user = CurrentUser(uid="visitor", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    no_coords = _group_doc(
        name="NoCoords",
        meetingAddressVisibility="public",
        meetingAddress=_address(lat=None, lng=None),
    )
    db = _nearby_db([("nc", no_coords)])
    with patch("app.routers.meeting_address._db", return_value=db):
        res = TestClient(app).get("/api/groups/discover/nearby?lat=40.0&lng=-111.0")
    assert res.status_code == 200, res.text
    assert res.json()["groups"] == []


def test_discover_geocodes_postal_origin() -> None:
    app = _base_app()
    user = CurrentUser(uid="visitor", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    near = _group_doc(
        name="Near",
        meetingAddressVisibility="public",
        meetingAddress=_address(lat=40.01, lng=-111.0),
    )
    db = _nearby_db([("near", near)])
    with (
        patch("app.routers.meeting_address._db", return_value=db),
        patch(
            "app.routers.meeting_address.geocode",
            return_value=GeocodeResult(40.0, -111.0),
        ) as mock_geo,
    ):
        res = TestClient(app).get("/api/groups/discover/nearby?postalCode=84601")
    assert res.status_code == 200, res.text
    assert mock_geo.called
    assert res.json()["origin"] == {"lat": 40.0, "lng": -111.0}


def test_discover_400_without_origin() -> None:
    app = _base_app()
    user = CurrentUser(uid="visitor", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    with patch("app.routers.meeting_address._db", return_value=MagicMock()):
        res = TestClient(app).get("/api/groups/discover/nearby")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "origin_required"


def test_discover_404_when_origin_geocode_fails() -> None:
    app = _base_app()
    user = CurrentUser(uid="visitor", email=None, claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    with (
        patch("app.routers.meeting_address._db", return_value=MagicMock()),
        patch("app.routers.meeting_address.geocode", return_value=None),
    ):
        res = TestClient(app).get("/api/groups/discover/nearby?q=nowhere")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "origin_not_found"
