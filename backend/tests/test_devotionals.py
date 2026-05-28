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

from app.deps import (
    MembershipContext,
    get_current_user,
    require_admin,
    require_member,
    require_not_banned,
)
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.devotionals import router
from app.services import devotionals as devotionals_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1") -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})


def _ministry_owner(uid: str = "mo") -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={"ministry_owner": True})


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


def _admin_app(*, admin_uid: str = "admin1") -> FastAPI:
    """App where require_admin is satisfied."""
    user = CurrentUser(uid=admin_uid, email=f"{admin_uid}@example.com", claims={"admin": True})
    app = _app(user=user)
    app.dependency_overrides[require_admin] = lambda: user
    return app


def _non_admin_app() -> FastAPI:
    """App where require_admin raises 403."""
    user = CurrentUser(uid="regular", email="regular@example.com", claims={})

    def _forbid() -> None:
        from app.errors import APIError

        raise APIError(status_code=403, code="forbidden", message="forbidden")

    app = _app(user=user)
    app.dependency_overrides[require_admin] = _forbid
    return app


def _seed_devotional(
    fs: FakeFirestore,
    *,
    slug: str,
    audience: str = "christian",
    title: str = "T",
    published: datetime | None = None,
    group_id: str | None = None,
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
            "groupId": group_id,
            "schemaVersion": 1,
        },
    )


def _seed_group(
    fs: FakeFirestore,
    *,
    gid: str,
    name: str = "Group",
    leaders: tuple[str, ...] = (),
    members: tuple[str, ...] = (),
) -> None:
    """Seed a group + its `members/{uid}` rows. Each leader uid is also
    recorded as a member with role=leader; member uids get role=member."""
    fs._doc_set(f"groups/{gid}", {"name": name, "isPrivate": False})
    for uid in leaders:
        fs._doc_set(
            f"groups/{gid}/members/{uid}",
            {"uid": uid, "role": "leader", "joinedAt": datetime.now(UTC)},
        )
    for uid in members:
        fs._doc_set(
            f"groups/{gid}/members/{uid}",
            {"uid": uid, "role": "member", "joinedAt": datetime.now(UTC)},
        )


def _leader(uid: str) -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})


def _admin(uid: str = "admin1") -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={"admin": True})


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


# ── reading-plan-today (home surface aggregator) ────────────────────────────


def test_reading_plan_today_returns_null_when_no_progress() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    user = _user("u-today")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    assert res.status_code == 200
    body = res.json()
    assert body["plan"] is None
    assert body["nextDay"] is None
    assert body["completedDays"] == []
    assert body["streak"] == 0
    assert body["allDaysComplete"] is False


def test_reading_plan_today_returns_next_uncompleted_day() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=5)
    yesterday = datetime.now(UTC) - timedelta(days=1)
    fs._doc_set(
        "users/u-today/plan_progress/psalms",
        {
            "planSlug": "psalms",
            "startedAt": yesterday,
            "completedDays": [1, 2],
            "streak": 2,
            "lastCompletedAt": yesterday,
        },
    )
    user = _user("u-today")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    assert res.status_code == 200
    body = res.json()
    assert body["plan"]["slug"] == "psalms"
    assert body["nextDay"]["dayNumber"] == 3
    assert body["completedDays"] == [1, 2]
    assert body["streak"] == 2
    assert body["allDaysComplete"] is False


def test_reading_plan_today_picks_most_recently_engaged_plan() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="older", duration=3)
    _seed_plan(fs, slug="newer", duration=3)
    older_day = datetime.now(UTC) - timedelta(days=10)
    newer_day = datetime.now(UTC) - timedelta(hours=2)
    fs._doc_set(
        "users/u-multi/plan_progress/older",
        {
            "planSlug": "older",
            "startedAt": older_day,
            "completedDays": [1],
            "streak": 1,
            "lastCompletedAt": older_day,
        },
    )
    fs._doc_set(
        "users/u-multi/plan_progress/newer",
        {
            "planSlug": "newer",
            "startedAt": newer_day,
            "completedDays": [1],
            "streak": 1,
            "lastCompletedAt": newer_day,
        },
    )
    user = _user("u-multi")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    body = res.json()
    assert body["plan"]["slug"] == "newer"


def test_reading_plan_today_uses_started_at_when_no_completions() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="just-started", duration=3)
    started = datetime.now(UTC) - timedelta(minutes=5)
    fs._doc_set(
        "users/u-fresh/plan_progress/just-started",
        {
            "planSlug": "just-started",
            "startedAt": started,
            "completedDays": [],
            "streak": 0,
            "lastCompletedAt": None,
        },
    )
    user = _user("u-fresh")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    body = res.json()
    assert body["plan"]["slug"] == "just-started"
    # No completions → next day is day 1.
    assert body["nextDay"]["dayNumber"] == 1


# ── admin CRUD: reading plans ─────────────────────────────────────────────────

_VALID_CREATE_BODY = {
    "title": "New Plan",
    "description": "A test plan.",
    "days": [
        {"scriptureRef": "John 1:1", "prompt": "Day one prompt."},
        {"scriptureRef": "John 1:2", "prompt": "Day two prompt."},
    ],
    "audience": "christian",
}


def test_create_reading_plan_returns_201() -> None:
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_admin_app()).post("/api/reading-plans", json=_VALID_CREATE_BODY)
    assert res.status_code == 201, res.text
    body = res.json()
    # Slug is derived from the title — no manual `slug` field on the request.
    assert body["slug"] == "new-plan"
    assert body["title"] == "New Plan"
    assert len(body["days"]) == 2
    assert body["days"][0]["dayNumber"] == 1
    assert body["days"][0]["scriptureRef"] == "John 1:1"
    assert body["duration"] == 2


def test_create_reading_plan_assigns_day_numbers_sequentially() -> None:
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_admin_app()).post(
            "/api/reading-plans",
            json={**_VALID_CREATE_BODY, "title": "Seq Plan"},
        )
    assert res.status_code == 201
    days = res.json()["days"]
    assert [d["dayNumber"] for d in days] == [1, 2]


def test_create_reading_plan_auto_slug_collision_appends_suffix() -> None:
    """Same-title re-creation gets `-2`, `-3`, … rather than 409. The
    author no longer types a slug, so 409 would be unrecoverable."""
    fs = FakeFirestore()
    _seed_plan(fs, slug="new-plan", duration=3)
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_admin_app()).post("/api/reading-plans", json=_VALID_CREATE_BODY)
    assert res.status_code == 201, res.text
    assert res.json()["slug"] == "new-plan-2"


def test_create_reading_plan_rejects_slug_in_body() -> None:
    """`slug` is no longer a request field — extra='forbid' rejects it."""
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).post(
            "/api/reading-plans",
            json={**_VALID_CREATE_BODY, "slug": "manual-slug"},
        )
    assert res.status_code == 422


def test_create_reading_plan_403_for_non_admin() -> None:
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_non_admin_app()).post("/api/reading-plans", json=_VALID_CREATE_BODY)
    assert res.status_code == 403


def test_create_reading_plan_422_when_days_empty() -> None:
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).post(
            "/api/reading-plans",
            json={**_VALID_CREATE_BODY, "days": []},
        )
    assert res.status_code == 422


def test_update_reading_plan_changes_title() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).patch(
            "/api/reading-plans/psalms",
            json={"title": "Updated Title"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "Updated Title"


def test_update_reading_plan_replaces_days() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    new_days = [
        {"scriptureRef": "Rev 1:1", "prompt": "New day one."},
        {"scriptureRef": "Rev 1:2", "prompt": "New day two."},
        {"scriptureRef": "Rev 1:3", "prompt": "New day three."},
        {"scriptureRef": "Rev 1:4", "prompt": "New day four."},
    ]
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).patch(
            "/api/reading-plans/psalms",
            json={"days": new_days},
        )
    assert res.status_code == 200
    body = res.json()
    assert len(body["days"]) == 4
    assert body["duration"] == 4
    assert body["days"][-1]["dayNumber"] == 4


def test_update_reading_plan_404_when_missing() -> None:
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).patch(
            "/api/reading-plans/missing",
            json={"title": "x"},
        )
    assert res.status_code == 404


def test_update_reading_plan_400_when_no_fields() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).patch("/api/reading-plans/psalms", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "empty_update"


def test_update_reading_plan_403_for_non_admin() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_non_admin_app()).patch(
            "/api/reading-plans/psalms",
            json={"title": "x"},
        )
    assert res.status_code == 403


def test_delete_reading_plan_returns_204() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).delete("/api/reading-plans/psalms")
    assert res.status_code == 204
    assert fs._doc_get("reading_plans/psalms") is None


def test_delete_reading_plan_404_when_missing() -> None:
    fs = FakeFirestore()
    with (
        patch("app.routers.devotionals._db", return_value=fs),
        patch("app.routers.devotionals.write_audit_log"),
    ):
        res = TestClient(_admin_app()).delete("/api/reading-plans/missing")
    assert res.status_code == 404


def test_delete_reading_plan_403_for_non_admin() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="psalms", duration=3)
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_non_admin_app()).delete("/api/reading-plans/psalms")
    assert res.status_code == 403


def test_reading_plan_today_flags_all_days_complete() -> None:
    fs = FakeFirestore()
    _seed_plan(fs, slug="short", duration=2)
    fs._doc_set(
        "users/u-done/plan_progress/short",
        {
            "planSlug": "short",
            "startedAt": datetime.now(UTC),
            "completedDays": [1, 2],
            "streak": 2,
            "lastCompletedAt": datetime.now(UTC),
        },
    )
    user = _user("u-done")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    body = res.json()
    assert body["plan"]["slug"] == "short"
    assert body["nextDay"] is None
    assert body["allDaysComplete"] is True


def test_reading_plan_today_handles_orphaned_progress() -> None:
    fs = FakeFirestore()
    # Plan was deleted but progress doc still exists.
    fs._doc_set(
        "users/u-orphan/plan_progress/deleted",
        {
            "planSlug": "deleted",
            "startedAt": datetime.now(UTC),
            "completedDays": [1],
            "streak": 1,
            "lastCompletedAt": datetime.now(UTC),
        },
    )
    user = _user("u-orphan")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/users/me/reading-plan-today")
    assert res.status_code == 200
    body = res.json()
    assert body["plan"] is None


# ── create / update / delete (ministry_owner only) ──────────────────────────

_CREATE_BODY = {
    "title": "God So Loved",
    "scriptureRef": "John 3:16",
    "body": "For God so loved the world…",
    "sourceAttribution": "Public domain",
    "audience": "christian",
}


def test_create_devotional_requires_ministry_owner() -> None:
    """A plain signed-in user gets 403 when attempting to create."""
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_user())).post("/api/devotionals", json=_CREATE_BODY)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_devotional_success() -> None:
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).post("/api/devotionals", json=_CREATE_BODY)
    assert res.status_code == 201, res.text
    body = res.json()
    # Slug is derived from the title — no `slug` field on the request.
    assert body["slug"] == "god-so-loved"
    assert body["path"] == "org/god-so-loved"
    assert body["title"] == "God So Loved"
    assert body["audience"] == "christian"
    assert body["schemaVersion"] == 2
    assert body["authorHash"] is None  # platform-wide: no author hash
    # Confirm doc was written under the new path-based ID.
    assert fs._doc_get("devotionals/org__god-so-loved") is not None


def test_create_devotional_auto_slug_collision_appends_suffix() -> None:
    """Two devotionals with the same title get -2, -3, … suffixes
    rather than 409. Authoring no longer asks for a slug, so 409 would
    be unrecoverable for the author."""
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_ministry_owner()))
        first = client.post("/api/devotionals", json=_CREATE_BODY)
        second = client.post("/api/devotionals", json=_CREATE_BODY)
        third = client.post("/api/devotionals", json=_CREATE_BODY)
    assert first.json()["slug"] == "god-so-loved"
    assert second.json()["slug"] == "god-so-loved-2"
    assert third.json()["slug"] == "god-so-loved-3"
    # All three got the 201 happy path — no 409.
    assert {first.status_code, second.status_code, third.status_code} == {201}


def test_create_devotional_blank_title_returns_422() -> None:
    """Empty title still rejected by the pydantic model. The slug
    fallback exists for *unusual but non-empty* titles like "!!!", not
    for "".
    """
    fs = FakeFirestore()
    bad_body = {**_CREATE_BODY, "title": ""}
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).post("/api/devotionals", json=bad_body)
    assert res.status_code == 422


def test_update_devotional_requires_ministry_owner() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="psalm-23")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_user())).patch(
            "/api/devotionals/psalm-23", json={"title": "New Title"}
        )
    assert res.status_code == 403


def test_update_devotional_success() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="psalm-23", title="Old Title")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).patch(
            "/api/devotionals/psalm-23",
            json={"title": "Updated Title", "scriptureRef": "Ps 23"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "Updated Title"
    assert fs._doc_get("devotionals/psalm-23")["title"] == "Updated Title"


def test_update_devotional_404() -> None:
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).patch(
            "/api/devotionals/missing", json={"title": "X"}
        )
    assert res.status_code == 404


def test_delete_devotional_requires_ministry_owner() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="to-delete")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_user())).delete("/api/devotionals/to-delete")
    assert res.status_code == 403


def test_delete_devotional_success() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="to-delete")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).delete("/api/devotionals/to-delete")
    assert res.status_code == 204
    assert fs._doc_get("devotionals/to-delete") is None


def test_delete_devotional_404() -> None:
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).delete("/api/devotionals/missing")
    assert res.status_code == 404


# ── group-scoped devotionals (leader-authored, member-visible) ──────────────

_GROUP_CREATE_BODY = {
    "title": "Group Week One",
    "scriptureRef": "Phil 4:6",
    "body": "Rejoice always.",
    "audience": "christian",
    "groupId": "g1",
}


def test_leader_creates_devotional_for_own_group() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", leaders=("lead-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).post(
            "/api/devotionals", json=_GROUP_CREATE_BODY
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["groupId"] == "g1"
    assert body["groupName"] == "Crossroads"
    assert body["slug"] == "group-week-one"
    # Group-scoped: path includes the 8-char author hash segment.
    assert body["authorHash"] is not None
    assert len(body["authorHash"]) == 8
    assert body["path"] == f"group/{body['authorHash']}/group-week-one"
    # Persisted under the new doc-ID scheme: group__<hash>__<slug>.
    persisted = fs._doc_get(f"devotionals/group__{body['authorHash']}__group-week-one")
    assert persisted is not None
    assert persisted["groupId"] == "g1"
    assert persisted["createdBy"] == "lead-1"
    assert persisted["authorHash"] == body["authorHash"]


def test_non_leader_cannot_create_for_group() -> None:
    """A regular member (or non-member) cannot author a devotional in a
    group they don't lead. This is the load-bearing test — group-scoping
    is the whole point of the feature."""
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", members=("mem-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("mem-1"))).post(
            "/api/devotionals", json=_GROUP_CREATE_BODY
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_a_leader"
    # Confirm nothing got persisted under either old or new scheme.
    assert fs._doc_get("devotionals/g1-week-1") is None
    matching = [p for p in fs.docs if p.startswith("devotionals/group__")]
    assert matching == []


def test_leader_of_other_group_cannot_create_here() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", leaders=("other-leader",))
    _seed_group(fs, gid="g2", name="Other", leaders=("g2-leader",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("g2-leader"))).post(
            "/api/devotionals", json=_GROUP_CREATE_BODY
        )
    assert res.status_code == 403


def test_ministry_owner_cannot_create_for_group_they_dont_lead() -> None:
    """Ministry-owner role does not implicitly grant leadership of every
    group. They must be a leader of `g1` to author a g1-scoped devotional.
    Admins are the only role that bypasses this."""
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", leaders=("other-leader",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).post(
            "/api/devotionals", json=_GROUP_CREATE_BODY
        )
    assert res.status_code == 403


def test_admin_can_create_group_scoped_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", leaders=("other",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_admin())).post("/api/devotionals", json=_GROUP_CREATE_BODY)
    assert res.status_code == 201


def test_create_platform_wide_when_groupid_omitted() -> None:
    """Without groupId, the existing ministry-owner gate still applies."""
    fs = FakeFirestore()
    body = {**_CREATE_BODY, "title": "Platform Week One"}
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).post("/api/devotionals", json=body)
    assert res.status_code == 201
    # Doc lives at the new path-based ID; groupId field stays null.
    persisted = fs._doc_get("devotionals/org__platform-week-one")
    assert persisted is not None
    assert persisted["groupId"] is None


def test_create_platform_wide_rejected_for_group_leader_without_owner_claim() -> None:
    """A group leader who is not a ministry_owner can't create platform-wide
    devotionals."""
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).post(
            "/api/devotionals",
            json=_CREATE_BODY,  # no groupId
        )
    assert res.status_code == 403


# ── merged list ─────────────────────────────────────────────────────────────


def test_list_devotionals_merges_platform_and_my_groups() -> None:
    """Returns platform-wide entries plus entries scoped to groups the
    caller belongs to. Other groups' devotionals are excluded."""
    fs = FakeFirestore()
    _seed_devotional(fs, slug="platform-1", group_id=None, title="Platform 1")
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="G1 entry")
    _seed_devotional(fs, slug="g2-1", group_id="g2", title="G2 entry")
    _seed_devotional(fs, slug="g3-1", group_id="g3", title="G3 entry")
    _seed_group(fs, gid="g1", name="Crossroads", members=("u-feed",))
    _seed_group(fs, gid="g2", name="Other", members=("not-u",))
    _seed_group(fs, gid="g3", name="Third", leaders=("u-feed",))

    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("u-feed"))).get("/api/devotionals")

    assert res.status_code == 200, res.text
    slugs = sorted(d["slug"] for d in res.json()["devotionals"])
    # platform-1 (always); g1-1 (member); g3-1 (leader); g2-1 excluded.
    assert slugs == ["g1-1", "g3-1", "platform-1"]


def test_list_devotionals_labels_group_entries_with_group_name() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="G1 entry")
    _seed_devotional(fs, slug="platform-1", group_id=None, title="Platform")
    _seed_group(fs, gid="g1", name="Crossroads", members=("u-feed",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("u-feed"))).get("/api/devotionals")
    by_slug = {d["slug"]: d for d in res.json()["devotionals"]}
    assert by_slug["g1-1"]["groupName"] == "Crossroads"
    assert by_slug["g1-1"]["groupId"] == "g1"
    assert by_slug["platform-1"]["groupName"] is None
    assert by_slug["platform-1"]["groupId"] is None


def test_list_devotionals_excludes_groups_user_left() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="g1-1", group_id="g1")
    _seed_group(fs, gid="g1", name="X", leaders=("other-leader",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("u-not-member"))).get("/api/devotionals")
    assert res.json()["devotionals"] == []


def test_list_devotionals_audience_filter_applies_to_both_scopes() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="platform-c", group_id=None, audience="christian", title="Pc")
    _seed_devotional(fs, slug="platform-g", group_id=None, audience="general", title="Pg")
    _seed_devotional(fs, slug="g1-c", group_id="g1", audience="christian", title="G1c")
    _seed_devotional(fs, slug="g1-g", group_id="g1", audience="general", title="G1g")
    _seed_group(fs, gid="g1", name="X", members=("u-feed",))
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("u-feed"))).get("/api/devotionals?audience=general")
    slugs = sorted(d["slug"] for d in res.json()["devotionals"])
    assert slugs == ["g1-g", "platform-g"]


# ── group-scoped list endpoint ──────────────────────────────────────────────


def _membership(
    *, uid: str = "mem-1", gid: str = "g1", role: str = "member", name: str = "Crossroads"
) -> MembershipContext:
    return MembershipContext(gid=gid, uid=uid, role=role, group={"name": name})


def test_group_devotional_list_requires_membership() -> None:
    """When `require_member` rejects (403), the list endpoint never runs."""
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="X", leaders=("lead-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1")

    user = _leader("stranger")
    app = _app(user=user)

    def _forbid() -> MembershipContext:
        from app.errors import APIError

        raise APIError(
            status_code=403,
            code="not_a_member",
            message="Not a member of this group",
        )

    app.dependency_overrides[require_member] = _forbid
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(app).get("/api/groups/g1/devotionals")
    assert res.status_code == 403


def test_group_devotional_list_returns_group_entries_only() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", members=("mem-1",))
    _seed_devotional(fs, slug="platform-1", group_id=None)
    _seed_devotional(fs, slug="g1-a", group_id="g1")
    _seed_devotional(fs, slug="g1-b", group_id="g1")
    _seed_devotional(fs, slug="g2-1", group_id="g2")

    app = _app(user=_leader("mem-1"))
    app.dependency_overrides[require_member] = lambda: _membership(uid="mem-1")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(app).get("/api/groups/g1/devotionals")
    assert res.status_code == 200
    slugs = sorted(d["slug"] for d in res.json()["devotionals"])
    assert slugs == ["g1-a", "g1-b"]
    # Every row carries the group name for the UI.
    assert all(d["groupName"] == "Crossroads" for d in res.json()["devotionals"])


# ── detail GET ──────────────────────────────────────────────────────────────


def test_get_group_scoped_devotional_404s_for_non_members() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="X", leaders=("lead-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("stranger"))).get("/api/devotionals/g1-1")
    # 404 (not 403) so non-members can't probe slug existence.
    assert res.status_code == 404


def test_get_group_scoped_devotional_allows_members() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", members=("mem-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="Pinned")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("mem-1"))).get("/api/devotionals/g1-1")
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Pinned"
    assert body["groupId"] == "g1"
    assert body["groupName"] == "Crossroads"


def test_get_group_scoped_devotional_allows_admin() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="X", leaders=("lead-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_admin())).get("/api/devotionals/g1-1")
    assert res.status_code == 200


# ── mutation authorization on existing docs ─────────────────────────────────


def test_leader_can_edit_their_groups_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="Old")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).patch(
            "/api/devotionals/g1-1", json={"title": "New"}
        )
    assert res.status_code == 200, res.text
    assert fs._doc_get("devotionals/g1-1")["title"] == "New"


def test_leader_cannot_edit_other_groups_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    _seed_group(fs, gid="g2", leaders=("g2-leader",))
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="Old")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("g2-leader"))).patch(
            "/api/devotionals/g1-1", json={"title": "Hijack"}
        )
    assert res.status_code == 403
    assert fs._doc_get("devotionals/g1-1")["title"] == "Old"


def test_leader_cannot_edit_platform_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    _seed_devotional(fs, slug="platform-1", group_id=None, title="Old")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).patch(
            "/api/devotionals/platform-1", json={"title": "Hijack"}
        )
    assert res.status_code == 403


def test_ministry_owner_cannot_edit_group_devotional_they_dont_lead() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("other-leader",))
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="Old")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_ministry_owner())).patch(
            "/api/devotionals/g1-1", json={"title": "Hijack"}
        )
    assert res.status_code == 403


def test_admin_can_edit_any_devotional() -> None:
    fs = FakeFirestore()
    _seed_devotional(fs, slug="g1-1", group_id="g1", title="Old")
    _seed_devotional(fs, slug="platform-1", group_id=None, title="Old")
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_admin()))
        r1 = client.patch("/api/devotionals/g1-1", json={"title": "New"})
        r2 = client.patch("/api/devotionals/platform-1", json={"title": "New"})
    assert r1.status_code == 200
    assert r2.status_code == 200


def test_leader_can_delete_their_groups_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    _seed_devotional(fs, slug="g1-1", group_id="g1")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).delete("/api/devotionals/g1-1")
    assert res.status_code == 204
    assert fs._doc_get("devotionals/g1-1") is None


# ── new path-based routes (org/<slug>, group/<hash>/<slug>) ─────────────────


def test_get_org_devotional_via_new_path() -> None:
    """A devotional created under the new scheme is reachable at
    `/api/devotionals/org/<slug>` and the legacy single-segment URL
    also resolves it (fallback chain tries `org__<slug>` first)."""
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_ministry_owner()))
        created = client.post("/api/devotionals", json=_CREATE_BODY).json()
        # Canonical path: /api/devotionals/org/<auto-slug>
        new_path = client.get(f"/api/devotionals/org/{created['slug']}")
        # Legacy path resolves the same doc through the fallback chain.
        legacy_path = client.get(f"/api/devotionals/{created['slug']}")
    assert new_path.status_code == 200
    assert legacy_path.status_code == 200
    assert new_path.json()["path"] == f"org/{created['slug']}"
    assert legacy_path.json()["path"] == f"org/{created['slug']}"


def test_get_group_devotional_via_new_path() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="Crossroads", leaders=("lead-1",), members=("mem-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_leader("lead-1")))
        created = client.post("/api/devotionals", json=_GROUP_CREATE_BODY).json()
        # Member can fetch via the new path.
        member_client = TestClient(_app(user=_leader("mem-1")))
        with patch("app.routers.devotionals._db", return_value=fs):
            res = member_client.get(
                f"/api/devotionals/group/{created['authorHash']}/{created['slug']}"
            )
    assert res.status_code == 200
    assert res.json()["groupId"] == "g1"
    assert res.json()["groupName"] == "Crossroads"


def test_get_group_devotional_via_new_path_404s_for_non_members() -> None:
    """The path-based route must enforce the same membership gate as
    the legacy route, since the URL alone leaks no membership info."""
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="X", leaders=("lead-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_leader("lead-1")))
        created = client.post("/api/devotionals", json=_GROUP_CREATE_BODY).json()
        stranger = TestClient(_app(user=_leader("stranger")))
        with patch("app.routers.devotionals._db", return_value=fs):
            res = stranger.get(f"/api/devotionals/group/{created['authorHash']}/{created['slug']}")
    # 404, not 403 — the existence of the slug must not be probeable.
    assert res.status_code == 404


def test_patch_org_devotional_via_new_path() -> None:
    fs = FakeFirestore()
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_ministry_owner()))
        created = client.post("/api/devotionals", json=_CREATE_BODY).json()
        res = client.patch(
            f"/api/devotionals/org/{created['slug']}",
            json={"title": "Renamed"},
        )
    assert res.status_code == 200
    assert res.json()["title"] == "Renamed"


def test_delete_group_devotional_via_new_path() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", name="X", leaders=("lead-1",))
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_leader("lead-1")))
        created = client.post("/api/devotionals", json=_GROUP_CREATE_BODY).json()
        res = client.delete(f"/api/devotionals/group/{created['authorHash']}/{created['slug']}")
    assert res.status_code == 204
    assert fs._doc_get(f"devotionals/group__{created['authorHash']}__{created['slug']}") is None


def test_legacy_get_resolves_pre_rename_doc() -> None:
    """A doc with the legacy single-segment ID (schemaVersion=1) still
    resolves through the legacy URL — no migration required for pre-
    rename seed data."""
    fs = FakeFirestore()
    _seed_devotional(fs, slug="psalm-23-shepherd", title="The Lord is my shepherd")
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_user())).get("/api/devotionals/psalm-23-shepherd")
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "The Lord is my shepherd"
    # Path for legacy docs mirrors their single-segment URL — keeps
    # frontend link construction uniform.
    assert body["path"] == "psalm-23-shepherd"


def test_list_devotionals_returns_path_for_routing() -> None:
    """List response must include `path` so the frontend can build the
    correct link for both legacy and new-scheme entries."""
    fs = FakeFirestore()
    _seed_devotional(fs, slug="legacy-entry", title="Legacy")
    with patch("app.routers.devotionals._db", return_value=fs):
        client = TestClient(_app(user=_ministry_owner()))
        # Create one new-scheme entry alongside the legacy one.
        client.post("/api/devotionals", json={**_CREATE_BODY, "title": "New Entry"})
        res = client.get("/api/devotionals")
    by_slug = {d["slug"]: d for d in res.json()["devotionals"]}
    assert by_slug["legacy-entry"]["path"] == "legacy-entry"
    assert by_slug["new-entry"]["path"] == "org/new-entry"


def test_leader_cannot_delete_platform_devotional() -> None:
    fs = FakeFirestore()
    _seed_group(fs, gid="g1", leaders=("lead-1",))
    _seed_devotional(fs, slug="platform-1", group_id=None)
    with patch("app.routers.devotionals._db", return_value=fs):
        res = TestClient(_app(user=_leader("lead-1"))).delete("/api/devotionals/platform-1")
    assert res.status_code == 403
    # Devotional must still exist.
    assert fs._doc_get("devotionals/platform-1") is not None
