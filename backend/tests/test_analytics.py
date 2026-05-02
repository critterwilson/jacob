"""Tests for the analytics router (T29).

firebase_admin and BigQuery are mocked so tests never hit external services.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.analytics import AnalyticsResponse
from app.models.user import CurrentUser
from app.routers.analytics import router

_GENERATED_AT = "2026-05-02T04:00:00+00:00"

LEADER_ANALYTICS = AnalyticsResponse(
    gid="g1",
    range="7d",
    totalMessages=42,
    stickerMix=[
        {"slug": "check-in", "count": 30, "percent": 71.5},
        {"slug": "prayer-request", "count": 12, "percent": 28.5},
    ],
    topContributors=[
        {"uid": "alice", "displayName": "Alice", "count": 20},
    ],
    cadenceByDay=[
        {"day": "2026-04-25", "count": 6},
        {"day": "2026-04-26", "count": 8},
    ],
    generatedAt=_GENERATED_AT,
)


def _make_app(uid: str = "alice", is_admin: bool = False) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    claims = {"admin": True} if is_admin else {}
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims=claims
    )
    return app


def _make_db(
    *,
    group_exists: bool = True,
    member_exists: bool = True,
    member_role: str = "leader",
) -> MagicMock:
    db = MagicMock()
    groups_col = MagicMock()
    users_col = MagicMock()

    def _col(name: str) -> MagicMock:
        return groups_col if name == "groups" else users_col

    db.collection.side_effect = _col

    group_ref = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = group_exists
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.to_dict.return_value = {"role": member_role}
    group_ref.collection.return_value.document.return_value.get.return_value = member_snap

    user_snap = MagicMock()
    user_snap.exists = True
    user_snap.to_dict.return_value = {"displayName": "Alice"}
    users_col.document.return_value.get.return_value = user_snap

    return db


# ── GET /api/groups/{gid}/analytics ──────────────────────────────────────────


def test_analytics_leader_happy_path() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.analytics._db", return_value=mock_db),
        patch("app.routers.analytics.get_settings") as mock_settings,
        patch("app.routers.analytics.query_analytics", return_value=LEADER_ANALYTICS),
    ):
        mock_settings.return_value.jacob_analytics_enabled = True
        mock_settings.return_value.bq_analytics_dataset = "jacob_analytics"
        mock_settings.return_value.bq_project = "test-project"

        client = TestClient(_make_app(uid="alice"))
        res = client.get(
            "/api/groups/g1/analytics?range=7d",
            headers={"Authorization": "Bearer token"},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["gid"] == "g1"
    assert data["totalMessages"] == 42
    assert len(data["stickerMix"]) == 2


def test_analytics_admin_happy_path() -> None:
    mock_db = _make_db(member_exists=False)
    with (
        patch("app.routers.analytics._db", return_value=mock_db),
        patch("app.routers.analytics.get_settings") as mock_settings,
        patch("app.routers.analytics.query_analytics", return_value=LEADER_ANALYTICS),
    ):
        mock_settings.return_value.jacob_analytics_enabled = True
        mock_settings.return_value.bq_analytics_dataset = "jacob_analytics"
        mock_settings.return_value.bq_project = "test-project"

        client = TestClient(_make_app(uid="admin-uid", is_admin=True))
        res = client.get(
            "/api/groups/g1/analytics",
            headers={"Authorization": "Bearer token"},
        )

    assert res.status_code == 200


def test_analytics_non_leader_returns_403() -> None:
    mock_db = _make_db(member_exists=True, member_role="member")
    with (
        patch("app.routers.analytics._db", return_value=mock_db),
        patch("app.routers.analytics.get_settings") as mock_settings,
    ):
        mock_settings.return_value.jacob_analytics_enabled = True
        mock_settings.return_value.bq_analytics_dataset = "jacob_analytics"
        mock_settings.return_value.bq_project = "test-project"

        client = TestClient(_make_app(uid="bob"))
        res = client.get(
            "/api/groups/g1/analytics",
            headers={"Authorization": "Bearer token"},
        )

    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_analytics_unauthenticated_returns_401() -> None:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    # No dependency override — real get_current_user will reject the request
    client = TestClient(app, raise_server_exceptions=False)
    with patch("app.services.firebase.init_firebase_admin"):
        res = client.get("/api/groups/g1/analytics")
    assert res.status_code == 401


def test_analytics_caches_within_ttl() -> None:
    import app.services.analytics as analytics_svc

    analytics_svc._cache.clear()

    call_count = 0

    def _fake_run_queries(
        gid: str, range_str: str, dataset: str, bq_project: str | None
    ) -> AnalyticsResponse:
        nonlocal call_count
        call_count += 1
        return LEADER_ANALYTICS

    mock_db = _make_db()
    with (
        patch("app.routers.analytics._db", return_value=mock_db),
        patch("app.routers.analytics.get_settings") as mock_settings,
        patch("app.services.analytics._run_queries", side_effect=_fake_run_queries),
    ):
        mock_settings.return_value.jacob_analytics_enabled = True
        mock_settings.return_value.bq_analytics_dataset = "jacob_analytics"
        mock_settings.return_value.bq_project = "test-project"

        client = TestClient(_make_app(uid="alice"))
        client.get("/api/groups/g1/analytics?range=7d", headers={"Authorization": "Bearer t"})
        client.get("/api/groups/g1/analytics?range=7d", headers={"Authorization": "Bearer t"})

    assert call_count == 1, "second call should hit in-process cache"


def test_analytics_sticker_mix_sums_to_100() -> None:
    from app.services.analytics import _run_queries as orig_run

    mix_rows = [
        {"stickerSlug": "a", "count": 1},
        {"stickerSlug": "b", "count": 2},
        {"stickerSlug": "c", "count": 3},
        {"stickerSlug": "d", "count": 4},
    ]

    def _fake_run(client: object, sql: str, params: list, cfg: object) -> list:
        if "sticker_mix_weekly" in sql:
            return mix_rows
        if "messages_daily" in sql:
            return [{"day": "2026-04-25", "count": 10}]
        return []

    with (
        patch("app.services.analytics._get_bq_client", return_value=MagicMock()),
        patch("app.services.analytics._job_config", return_value=MagicMock()),
        patch("app.services.analytics._run", side_effect=_fake_run),
    ):
        result = orig_run("g1", "7d", "ds", "proj")

    total_pct = sum(s.percent for s in result.stickerMix)
    assert abs(total_pct - 100.0) < 0.01, f"percentages sum to {total_pct}"


def test_analytics_handles_zero_messages() -> None:
    def _fake_run(client: object, sql: str, params: list, cfg: object) -> list:
        return []

    with (
        patch("app.services.analytics._get_bq_client", return_value=MagicMock()),
        patch("app.services.analytics._job_config", return_value=MagicMock()),
        patch("app.services.analytics._run", side_effect=_fake_run),
    ):
        from app.services.analytics import _run_queries

        result = _run_queries("g1", "7d", "ds", "proj")

    assert result.totalMessages == 0
    assert result.stickerMix == []
    assert result.cadenceByDay == []
