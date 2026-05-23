"""Native Firestore search (ADR 0016)."""

from __future__ import annotations

import datetime as _dt
from typing import Any
from unittest.mock import MagicMock, patch

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
    enumerate_memberships,
    search_messages,
    tokenize,
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


def _enable_search() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    settings = get_settings()
    object.__setattr__(settings, "jacob_search_enabled", True)


def _disable_search() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    settings = get_settings()
    object.__setattr__(settings, "jacob_search_enabled", False)


@pytest.fixture(autouse=True)
def _reset_state() -> Any:
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


class _FakeSnap:
    def __init__(self, mid: str, data: dict[str, Any]) -> None:
        self.id = mid
        self._data = data

    def to_dict(self) -> dict[str, Any]:
        return self._data


def _membership_db(gids_to_messages: dict[str, list[dict[str, Any]]]) -> MagicMock:
    """Build a Firestore mock that:
    - returns one members CG snap per gid
    - returns the configured messages for each per-group search query
    """
    db = MagicMock()

    member_snaps = []
    for gid in gids_to_messages:
        ref = MagicMock()
        ref.parent.parent.id = gid
        snap = MagicMock()
        snap.reference = ref
        member_snaps.append(snap)
    cg = MagicMock()
    cg.where.return_value.limit.return_value.stream.return_value = iter(member_snaps)
    db.collection_group.return_value = cg

    def make_msgs_query(message_dicts: list[dict[str, Any]]) -> MagicMock:
        snaps = [_FakeSnap(m["id"], m) for m in message_dicts]
        query = MagicMock()
        query.where.return_value.limit.return_value.stream.return_value = iter(snaps)
        return query

    group_docs: dict[str, MagicMock] = {}
    for gid, messages in gids_to_messages.items():
        doc = MagicMock()
        doc.collection.return_value = make_msgs_query(messages)
        group_docs[gid] = doc

    groups_coll = MagicMock()
    groups_coll.doc.side_effect = lambda gid: group_docs[gid]
    db.collection.return_value = groups_coll
    return db


# ── tokenize ────────────────────────────────────────────────────────────────


def test_tokenize_lowercases_and_dedupes() -> None:
    assert tokenize("Hello, HELLO world!") == ["hello", "world"]


def test_tokenize_skips_punctuation_only() -> None:
    assert tokenize("...!?") == []


def test_tokenize_handles_empty() -> None:
    assert tokenize("") == []
    assert tokenize("   ") == []


# ── enumerate_memberships ────────────────────────────────────────────────────


def test_enumerate_memberships_returns_each_groups_id() -> None:
    db = _membership_db({"g1": [], "g2": [], "g3": []})
    assert enumerate_memberships(db, "alice") == ["g1", "g2", "g3"]
    db.collection_group.assert_called_once_with("members")


def test_enumerate_memberships_passes_cap() -> None:
    db = _membership_db({})
    enumerate_memberships(db, "alice", cap=42)
    db.collection_group.return_value.where.return_value.limit.assert_called_with(42)


# ── search_messages ──────────────────────────────────────────────────────────


def _msg(
    mid: str,
    body: str,
    *,
    tokens: list[str] | None = None,
    created_at: _dt.datetime | None = None,
    deleted_at: Any = None,
    moderation_state: str | None = None,
    author_uid: str = "alice",
    parent: str | None = None,
) -> dict[str, Any]:
    return {
        "id": mid,
        "body": body,
        "authorUid": author_uid,
        "searchTokens": tokens if tokens is not None else tokenize(body),
        "createdAt": created_at or _dt.datetime(2026, 1, 1, tzinfo=_dt.UTC),
        "deletedAt": deleted_at,
        "moderation": {"state": moderation_state} if moderation_state else None,
        "parentMessageId": parent,
    }


def test_search_returns_hits_from_each_group() -> None:
    db = _membership_db(
        {
            "g1": [_msg("m1", "hello world")],
            "g2": [_msg("m2", "hello there")],
        }
    )
    res = search_messages(db, uid="alice", q="hello", page=1, limit=10)
    assert res.total == 2
    ids = {h.messageRef for h in res.hits}
    assert ids == {"groups/g1/messages/m1", "groups/g2/messages/m2"}


def test_search_excludes_hidden_messages() -> None:
    db = _membership_db(
        {
            "g1": [
                _msg("m1", "hello world"),
                _msg("m2", "hello secret", moderation_state="hidden"),
            ]
        }
    )
    res = search_messages(db, uid="alice", q="hello", page=1, limit=10)
    assert [h.messageRef for h in res.hits] == ["groups/g1/messages/m1"]


def test_search_excludes_soft_deleted_messages() -> None:
    db = _membership_db(
        {
            "g1": [
                _msg("m1", "hello world"),
                _msg("m2", "hello deleted", deleted_at=_dt.datetime(2026, 5, 1)),
            ]
        }
    )
    res = search_messages(db, uid="alice", q="hello", page=1, limit=10)
    assert [h.messageRef for h in res.hits] == ["groups/g1/messages/m1"]


def test_search_multi_word_requires_all_tokens() -> None:
    db = _membership_db(
        {
            "g1": [
                _msg("m1", "hello world fellowship"),
                _msg("m2", "hello goodbye"),
            ]
        }
    )
    res = search_messages(db, uid="alice", q="hello world", page=1, limit=10)
    assert [h.messageRef for h in res.hits] == ["groups/g1/messages/m1"]


def test_search_sorts_by_created_at_desc() -> None:
    db = _membership_db(
        {
            "g1": [
                _msg("old", "hello", created_at=_dt.datetime(2026, 1, 1, tzinfo=_dt.UTC)),
                _msg("new", "hello", created_at=_dt.datetime(2026, 5, 1, tzinfo=_dt.UTC)),
            ]
        }
    )
    res = search_messages(db, uid="alice", q="hello", page=1, limit=10)
    assert [h.messageRef for h in res.hits] == [
        "groups/g1/messages/new",
        "groups/g1/messages/old",
    ]


def test_search_paginates_merged_results() -> None:
    db = _membership_db(
        {
            "g1": [
                _msg(
                    f"m{i}",
                    "hello",
                    created_at=_dt.datetime(2026, 1, 1) + _dt.timedelta(seconds=i),
                )
                for i in range(5)
            ]
        }
    )
    page1 = search_messages(db, uid="alice", q="hello", page=1, limit=2)
    assert [h.messageRef for h in page1.hits] == [
        "groups/g1/messages/m4",
        "groups/g1/messages/m3",
    ]
    assert page1.total == 5

    # Re-build the mock — the streams in the previous call were consumed.
    db = _membership_db(
        {
            "g1": [
                _msg(
                    f"m{i}",
                    "hello",
                    created_at=_dt.datetime(2026, 1, 1) + _dt.timedelta(seconds=i),
                )
                for i in range(5)
            ]
        }
    )
    page2 = search_messages(db, uid="alice", q="hello", page=2, limit=2)
    assert [h.messageRef for h in page2.hits] == [
        "groups/g1/messages/m2",
        "groups/g1/messages/m1",
    ]


def test_search_empty_query_returns_empty() -> None:
    db = _membership_db({"g1": [_msg("m1", "hello")]})
    res = search_messages(db, uid="alice", q="   ", page=1, limit=10)
    assert res.total == 0
    assert res.hits == []


def test_search_no_memberships_returns_empty() -> None:
    db = _membership_db({})
    res = search_messages(db, uid="alice", q="hello", page=1, limit=10)
    assert res.total == 0
    assert res.hits == []


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


def test_search_returns_hits_via_endpoint() -> None:
    _enable_search()
    db = _membership_db(
        {
            "g1": [_msg("m1", "hello world")],
            "g2": [_msg("m2", "hello again")],
        }
    )
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get("/api/search?q=hello")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2
    refs = {h["messageRef"] for h in body["hits"]}
    assert refs == {"groups/g1/messages/m1", "groups/g2/messages/m2"}


def test_search_returns_empty_when_caller_has_no_memberships() -> None:
    _enable_search()
    db = _membership_db({})
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get("/api/search?q=hi")
    assert res.status_code == 200
    assert res.json() == {"hits": [], "total": 0, "page": 1, "limit": 20}


def test_search_too_long_query_returns_422() -> None:
    _enable_search()
    db = _membership_db({"g1": []})
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get(f"/api/search?q={'a' * 201}")
    assert res.status_code == 422


def test_search_response_uses_limit_field_not_per_page() -> None:
    _enable_search()
    db = _membership_db({})
    with patch("app.routers.search._db", return_value=db):
        res = TestClient(_make_app()).get("/api/search?q=x&limit=7")
    assert res.status_code == 200
    body = res.json()
    assert "limit" in body
    assert "perPage" not in body
    assert body["limit"] == 7
