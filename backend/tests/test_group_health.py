"""Tests for the T60 group-health dashboard helpers + org endpoint."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.analytics import org_router
from app.services import group_health
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1", *, is_admin: bool = False) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(*, user: CurrentUser) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(org_router)
    app.dependency_overrides[get_current_user] = lambda: user
    return app


def _seed_event(
    fs: FakeFirestore,
    *,
    gid: str,
    event_id: str,
    title: str = "Prayer",
    days_offset: int = 0,
    rsvp_going_uids: list[str] | None = None,
    attended_uids: list[str] | None = None,
) -> None:
    starts_at = datetime.now(UTC) + timedelta(days=days_offset)
    fs._doc_set(
        f"groups/{gid}/events/{event_id}",
        {
            "title": title,
            "startsAt": starts_at,
            "endsAt": starts_at + timedelta(hours=1),
            "deletedAt": None,
        },
    )
    for uid in rsvp_going_uids or []:
        fs._doc_set(
            f"groups/{gid}/events/{event_id}/rsvps/{uid}",
            {
                "status": "going",
                "respondedAt": datetime.now(UTC),
                "attended": uid in (attended_uids or []),
                "checkedInAt": (datetime.now(UTC) if uid in (attended_uids or []) else None),
            },
        )


def _seed_mod_event(
    fs: FakeFirestore,
    *,
    gid: str,
    item_id: str,
    severity: float,
    days_ago: int = 0,
) -> None:
    fs._doc_set(
        f"moderation_queue/{item_id}",
        {
            "groupId": gid,
            "severity": severity,
            "createdAt": datetime.now(UTC) - timedelta(days=days_ago),
        },
    )


def test_event_attendance_returns_per_event_counts() -> None:
    fs = FakeFirestore()
    _seed_event(
        fs,
        gid="g1",
        event_id="e1",
        rsvp_going_uids=["a", "b", "c"],
        attended_uids=["a", "b"],
    )
    rows = group_health.event_attendance(fs, gid="g1")
    assert len(rows) == 1
    assert rows[0]["rsvpGoing"] == 3
    assert rows[0]["attended"] == 2


def test_event_attendance_excludes_old_events_outside_window() -> None:
    fs = FakeFirestore()
    _seed_event(fs, gid="g1", event_id="recent", days_offset=0)
    _seed_event(fs, gid="g1", event_id="ancient", days_offset=-365)
    rows = group_health.event_attendance(fs, gid="g1", days=30)
    ids = [r["eventId"] for r in rows]
    assert "recent" in ids
    assert "ancient" not in ids


def test_sentiment_trend_buckets_by_day_no_per_uid_leak() -> None:
    fs = FakeFirestore()
    _seed_mod_event(fs, gid="g1", item_id="m1", severity=2.0, days_ago=0)
    _seed_mod_event(fs, gid="g1", item_id="m2", severity=4.0, days_ago=0)
    _seed_mod_event(fs, gid="g1", item_id="m3", severity=1.0, days_ago=1)
    rows = group_health.sentiment_trend(fs, gid="g1")
    today = datetime.now(UTC).date().isoformat()
    today_row = next(r for r in rows if r["day"] == today)
    assert today_row["count"] == 2
    assert abs(today_row["avgSeverity"] - 3.0) < 1e-6
    # No per-uid field anywhere in the output.
    for row in rows:
        for key in row.keys():
            assert key not in {"uid", "actorUid"}


def test_org_aggregate_rolls_up_attached_groups() -> None:
    fs = FakeFirestore()
    fs._doc_set("groups/g1", {"orgId": "o1", "name": "G1", "memberCount": 5})
    fs._doc_set("groups/g2", {"orgId": "o1", "name": "G2", "memberCount": 3})
    fs._doc_set("orgs/o1/members/m1", {"joinedAt": datetime.now(UTC), "groupIds": ["g1"]})
    fs._doc_set("orgs/o1/members/m2", {"joinedAt": datetime.now(UTC), "groupIds": ["g2"]})
    _seed_event(
        fs,
        gid="g1",
        event_id="e1",
        rsvp_going_uids=["m1"],
        attended_uids=["m1"],
    )
    payload = group_health.org_aggregate(fs, org_id="o1")
    assert payload["groupCount"] == 2
    assert payload["activeMembers"] == 2
    assert len(payload["eventAttendance"]) == 1


def test_org_endpoint_403_for_non_admin() -> None:
    fs = FakeFirestore()
    fs._doc_set("orgs/o1", {"name": "Pilot"})
    user = _user("stranger")
    with patch("app.routers.analytics._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/o1/analytics")
    assert res.status_code == 403


def test_org_endpoint_returns_payload_for_org_admin() -> None:
    fs = FakeFirestore()
    fs._doc_set("orgs/o1", {"name": "Pilot"})
    fs._doc_set(
        "orgs/o1/admins/admin-1",
        {"addedBy": "system", "addedAt": datetime.now(UTC)},
    )
    fs._doc_set("groups/g1", {"orgId": "o1", "name": "G1", "memberCount": 5})
    user = _user("admin-1")
    with patch("app.routers.analytics._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/o1/analytics")
    assert res.status_code == 200
    body = res.json()
    assert body["orgId"] == "o1"
    assert body["groupCount"] == 1


def test_org_endpoint_404_when_org_missing() -> None:
    fs = FakeFirestore()
    user = _user("admin-1")
    with patch("app.routers.analytics._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/missing/analytics")
    assert res.status_code == 404
