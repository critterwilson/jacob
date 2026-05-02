"""T28 — backend search endpoint + helpers."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.deps import get_current_user
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.search import router as search_router
from app.services.search import (
    SearchClient,
    SearchUnavailableError,
    _reset_circuit_for_tests,
    enumerate_memberships,
    is_circuit_open,
    normalise,
    record_failure,
    record_success,
)

# ── helpers ────────────────────────────────────────────────────────────────────


def _make_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(search_router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _membership_db(gids: list[str]) -> MagicMock:
    """Mock a Firestore client whose collection_group("members") returns
    one snap per gid, each pointing at groups/{gid}/members/{uid}."""
    db = MagicMock()
    snaps = []
    for gid in gids:
        ref = MagicMock()
        ref.parent.parent.id = gid
        snap = MagicMock()
        snap.reference = ref
        snaps.append(snap)
    cg = MagicMock()
    cg.where.return_value.limit.return_value.stream.return_value = iter(snaps)
    db.collection_group.return_value = cg
    return db


def _enable_search() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    settings = get_settings()
    object.__setattr__(settings, "jacob_search_enabled", True)
    object.__setattr__(settings, "typesense_host", "http://typesense.local")
    object.__setattr__(settings, "typesense_api_key", "k")
    object.__setattr__(settings, "typesense_collection", "messages")


def _disable_search() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    settings = get_settings()
    object.__setattr__(settings, "jacob_search_enabled", False)


@pytest.fixture(autouse=True)
def _reset_state() -> Any:
    _reset_circuit_for_tests()
    yield
    _reset_circuit_for_tests()
    get_settings.cache_clear()  # type: ignore[attr-defined]


# ── enumerate_memberships ────────────────────────────────────────────────────


def test_enumerate_memberships_returns_each_groups_id() -> None:
    db = _membership_db(["g1", "g2", "g3"])
    assert enumerate_memberships(db, "alice") == ["g1", "g2", "g3"]
    db.collection_group.assert_called_once_with("members")


def test_enumerate_memberships_passes_cap() -> None:
    db = _membership_db([])
    enumerate_memberships(db, "alice", cap=42)
    db.collection_group.return_value.where.return_value.limit.assert_called_with(42)


# ── normalise ────────────────────────────────────────────────────────────────


def test_normalise_builds_message_refs_and_iso_dates() -> None:
    raw = {
        "found": 2,
        "hits": [
            {
                "document": {
                    "id": "m1",
                    "groupId": "g1",
                    "authorUid": "alice",
                    "authorDisplayName": "Alice",
                    "body": "hello world",
                    "createdAtUnix": 1_700_000_000,
                    "parentMessageId": None,
                },
                "highlight": {"body": {"snippet": "<mark>hello</mark> world"}},
            },
            {
                "document": {
                    "id": "m2",
                    "groupId": "g2",
                    "authorUid": "bob",
                    "body": "raw body",
                    "createdAtUnix": 1_700_000_500,
                },
            },
        ],
    }
    out = normalise(raw, page=1, per_page=10)
    assert out.total == 2
    assert out.page == 1
    assert out.perPage == 10
    assert out.hits[0].messageRef == "groups/g1/messages/m1"
    assert out.hits[0].body == "<mark>hello</mark> world"
    assert out.hits[0].createdAt.startswith("2023-")
    assert out.hits[1].body == "raw body"


def test_normalise_drops_hits_without_id_or_groupid() -> None:
    raw = {"found": 1, "hits": [{"document": {"body": "no ids"}}]}
    out = normalise(raw, page=1, per_page=10)
    assert out.hits == []


# ── SearchClient ─────────────────────────────────────────────────────────────


def test_searchclient_short_circuits_on_empty_gids() -> None:
    client = SearchClient(host="http://x", api_key="k", collection="messages")
    assert client.search(q="hi", gids=[], page=1, per_page=10) == {
        "hits": [],
        "found": 0,
    }


def test_searchclient_passes_filter_by_with_groupids_and_moderation() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json={"found": 0, "hits": []})

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = SearchClient(
        host="http://typesense.local",
        api_key="k",
        collection="messages",
        client=http_client,
    )

    client.search(q="hi", gids=["g1", "g2"], page=2, per_page=20)

    expected_filter = "filter_by=groupId%3A%5Bg1%2Cg2%5D+%26%26+moderationState%3A%21%3Dhidden"
    assert expected_filter in captured["url"]
    assert captured["headers"]["x-typesense-api-key"] == "k"


def test_searchclient_5xx_trips_circuit_breaker() -> None:
    transport = httpx.MockTransport(lambda _r: httpx.Response(500, text="boom"))
    http_client = httpx.Client(transport=transport)
    client = SearchClient(
        host="http://typesense.local",
        api_key="k",
        collection="messages",
        client=http_client,
    )

    with pytest.raises(SearchUnavailableError):
        client.search(q="hi", gids=["g1"], page=1, per_page=10)


def test_circuit_breaker_opens_after_5_failures() -> None:
    assert is_circuit_open() is False
    for _ in range(4):
        record_failure()
    assert is_circuit_open() is False
    record_failure()
    assert is_circuit_open() is True
    record_success()
    assert is_circuit_open() is False


# ── endpoint ─────────────────────────────────────────────────────────────────


def test_search_disabled_returns_503() -> None:
    _disable_search()
    res = TestClient(_make_app()).get("/api/search?q=hi")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "search_disabled"


def test_search_empty_query_returns_400() -> None:
    _enable_search()
    res = TestClient(_make_app()).get("/api/search?q=%20%20")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_query"


def test_search_filters_to_caller_memberships() -> None:
    _enable_search()
    db = _membership_db(["g1", "g2"])

    captured: dict[str, Any] = {}

    class _StubClient:
        def search(self, *, q: str, gids: list[str], page: int, per_page: int) -> dict[str, Any]:
            captured["gids"] = gids
            return {
                "found": 1,
                "hits": [
                    {
                        "document": {
                            "id": "m1",
                            "groupId": "g1",
                            "authorUid": "alice",
                            "body": "hi",
                            "createdAtUnix": 1_700_000_000,
                        },
                    }
                ],
            }

    with (
        patch("app.routers.search._db", return_value=db),
        patch("app.routers.search.get_client", return_value=_StubClient()),
    ):
        res = TestClient(_make_app()).get("/api/search?q=hi")

    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["hits"][0]["messageRef"] == "groups/g1/messages/m1"
    # The endpoint should not pass g3 (caller is not a member).
    assert captured["gids"] == ["g1", "g2"]


def test_search_returns_empty_when_caller_has_no_memberships() -> None:
    _enable_search()
    db = _membership_db([])
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get("/api/search?q=hi")
    assert res.status_code == 200
    assert res.json() == {"hits": [], "total": 0, "page": 1, "perPage": 20}


def test_search_typesense_unavailable_returns_503() -> None:
    _enable_search()
    db = _membership_db(["g1"])

    class _BoomClient:
        def search(self, **_: Any) -> dict[str, Any]:
            raise SearchUnavailableError("down")

    with (
        patch("app.routers.search._db", return_value=db),
        patch("app.routers.search.get_client", return_value=_BoomClient()),
    ):
        res = TestClient(_make_app()).get("/api/search?q=hi")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "search_unavailable"


def test_search_excludes_hidden_messages_via_filter_by() -> None:
    """The endpoint must wire `moderationState:!=hidden` into the
    filter; verifying via SearchClient confirms the parameter."""
    _enable_search()
    db = _membership_db(["g1"])

    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"found": 0, "hits": []})

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    real_client = SearchClient(
        host="http://typesense.local",
        api_key="k",
        collection="messages",
        client=http_client,
    )

    with (
        patch("app.routers.search._db", return_value=db),
        patch("app.routers.search.get_client", return_value=real_client),
    ):
        res = TestClient(_make_app()).get("/api/search?q=hi")

    assert res.status_code == 200
    assert "moderationState%3A%21%3Dhidden" in captured["url"]


def test_search_too_long_query_returns_422() -> None:
    """q is capped at 200 chars by Query(max_length=200) — pydantic
    rejects with 422."""
    _enable_search()
    db = _membership_db(["g1"])
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get(f"/api/search?q={'a' * 201}")
    assert res.status_code == 422
