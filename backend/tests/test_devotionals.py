"""Tests for the T51 devotionals + reading-plans surface.

Coverage:
- streak math truth table (every gap branch + repeat-day no-op)
- list devotionals (audience filter + sort by publishedAt desc)
- get devotional 404
- list reading plans (summary shape — days dropped)
- get reading plan returns days
- mark complete: writes progress doc, updates streak
- mark complete on missing plan returns 404
- mark complete with day_number out of range returns 400
- get progress returns empty defaults when no progress yet
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.devotionals import router
from app.services import devotionals as devotionals_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1") -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})


def _app(*, user: CurrentUser) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    return app


def _seed_devotional(
    fs: FakeFirestore,
    *,
    slug: str,
    audience: str = "christian",
    title: str = "T",
    published: datetime | None = None,
) -> None:
    fs._doc_set(
        f"devotionals/{slug}",
        {
            "slug": slug,
            "title": title,
            "scriptureRef": "John 3:16",
            "body": "**bold** body",
            "audioUrl": None,
            "sourceAttribution": "Public domain.",
            "publishedAt": published or datetime.now(UTC),
            "audience": audience,
            "schemaVersion": 1,
        },
    )


def _seed_plan(
    fs: FakeFirestore,
    *,
    slug: str,
    duration: int = 3,
    audience: str = "christian",
) -> None:
    days = [
        {
            "dayNumber": i,
            "scriptureRef": f"John {i}",
            "prompt": f"Reflect on day {i}.",
        }
        for i in range(1, duration + 1)
    ]
    fs._doc_set(
        f"reading_plans/{slug}",
        {
            "slug": slug,
            "title": f"Plan {slug}",
            "description": "Test plan",
            "days": days,
            "duration": duration,
            "audience": audience,
            "publishedAt": datetime.now(UTC),
            "schemaVersion": 1,
        },
    )


# ── streak truth table ──────────────────────────────────────────────────────


def test_streak_first_completion_sets_to_1() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 4), last_completed_date=None, previous_streak=0
    )
    assert streak == 1
    assert inc is True


def test_streak_same_day_noop() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 4),
        last_completed_date=date(2026, 5, 4),
        previous_streak=4,
    )
    assert streak == 4
    assert inc is False


def test_streak_consecutive_day_increments() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 5),
        last_completed_date=date(2026, 5, 4),
        previous_streak=4,
    )
    assert streak == 5
    assert inc is True


def test_streak_one_day_grace_increments() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 6),
        last_completed_date=date(2026, 5, 4),
        previous_streak=4,
    )
    assert streak == 5
    assert inc is True


def test_streak_two_day_gap_resets_to_1() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 7),
        last_completed_date=date(2026, 5, 4),
        previous_streak=4,
    )
    assert streak == 1
    assert inc is True


def test_streak_clock_skew_backward_does_not_reset() -> None:
    streak, inc = devotionals_service.compute_streak_update(
        today=date(2026, 5, 3),
        last_completed_date=date(2026, 5, 4),
        previous_streak=4,
    )
    assert streak == 4
    assert inc is True


# ── list / get endpoints ────────────────────────────────────────────────────


def test_list_devotionals_filters_by_audience() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="a", audience="christian")
    _seed_devotional(fs, slug="b", audience="general")
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/devotionals?audience=general")
    assert res.status_code == 200
    slugs = [d["slug"] for d in res.json()["devotionals"]]
    assert slugs == ["b"]


def test_list_devotionals_sorts_published_desc() -> None:
    fs = FakeFirestore()
    _seed_devotional(
        fs,
        slug="newer",
        published=datetime.now(UTC),
    )
    _seed_devotional(
        fs,
        slug="older",
        published=datetime.now(UTC) - timedelta(days=1),
    )
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/devotionals")
    slugs = [d["slug"] for d in res.json()["devotionals"]]
    assert slugs == ["newer", "older"]


def test_get_devotional_404() -> None:
    fs = FakeFirestore()
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/devotionals/missing")
    assert res.status_code == 404


def test_list_reading_plans_drops_days() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="john", duration=21)
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/reading-plans")
    assert res.status_code == 200
    body = res.json()
    assert body["plans"][0]["slug"] == "john"
    assert "days" not in body["plans"][0]
    assert body["plans"][0]["duration"] == 21


def test_get_reading_plan_returns_days() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/reading-plans/psalms")
    body = res.json()
    assert body["slug"] == "psalms"
    assert len(body["days"]) == 3


# ── progress + mark-complete ────────────────────────────────────────────────


def test_get_progress_returns_zero_defaults_when_no_progress() -> None:
    fs = FakeFirestore()
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/reading-plans/john/progress")
    assert res.status_code == 200
    assert res.json() == {
        "planSlug": "john",
        "startedAt": None,
        "completedDays": [],
        "streak": 0,
        "lastCompletedAt": None,
    }


def test_mark_complete_writes_progress_doc() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="john", duration=21)
    user = _user("u-mc")

    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/reading-plans/john/progress/mark",
            json={"dayNumber": 1},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["completedDays"] == [1]
    assert body["streak"] == 1
    persisted = fs._doc_get("users/u-mc/plan_progress/john")
    assert persisted["completedDays"] == [1]
    assert persisted["streak"] == 1


def test_mark_complete_404_when_plan_missing() -> None:
    fs = FakeFirestore()
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/reading-plans/missing/progress/mark",
            json={"dayNumber": 1},
        )
    assert res.status_code == 404


def test_mark_complete_400_when_day_out_of_range() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/reading-plans/psalms/progress/mark",
            json={"dayNumber": 99},
        )
    assert res.status_code == 400


def test_mark_complete_422_when_day_below_one() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    user = _user()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/reading-plans/psalms/progress/mark",
            json={"dayNumber": 0},
        )
    assert res.status_code == 422


def test_mark_complete_consecutive_day_increments_streak() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=7)
    yesterday = datetime.now(UTC) - timedelta(days=1)
    fs._doc_set(
        "users/u-stk/plan_progress/psalms",
        {
            "planSlug": "psalms",
            "startedAt": yesterday,
            "completedDays": [1],
            "streak": 1,
            "lastCompletedAt": yesterday,
        },
    )
    user = _user("u-stk")
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/reading-plans/psalms/progress/mark",
            json={"dayNumber": 2},
        )
    body = res.json()
    assert body["streak"] == 2
    assert sorted(body["completedDays"]) == [1, 2]
