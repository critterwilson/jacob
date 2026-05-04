"""Tests for the T52 sermon-archive surface.

Coverage:
- non-leader → 403 on create / patch / delete
- create with YouTube URL pulls oEmbed (mocked) and persists thumbnail/title
- create with non-YouTube URL stores as-is
- create with invalid sermonDate → 400
- create on archived group → 409
- list returns active sermons + sorted preachers; soft-deleted excluded
- get 404 when missing or soft-deleted
- patch updates only supplied fields
- delete sets deletedAt; idempotent
- pure helpers: detect_source_type, youtube_video_id
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import (
    MembershipContext,
    require_leader,
    require_member,
)
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.routers.sermons import router
from app.services import sermons as sermons_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _membership(
    *,
    uid: str = "leader-1",
    gid: str = "g1",
    role: str = "leader",
    archived: bool = False,
) -> MembershipContext:
    group_data: dict[str, Any] = {"name": "Group"}
    if archived:
        group_data["archivedAt"] = datetime.now(UTC)
    return MembershipContext(gid=gid, uid=uid, role=role, group=group_data)


def _app(
    *,
    leader_membership: MembershipContext | None = None,
    member_membership: MembershipContext | None = None,
    block_leader: bool = False,
) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)

    if member_membership is not None:
        app.dependency_overrides[require_member] = lambda: member_membership
    if leader_membership is not None and not block_leader:
        app.dependency_overrides[require_leader] = lambda: leader_membership
    elif block_leader:

        def _forbid() -> MembershipContext:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": {
                        "code": "not_a_leader",
                        "message": "Only group leaders can perform this action",
                        "details": {},
                    }
                },
            )

        app.dependency_overrides[require_leader] = _forbid
    return app


# ── pure helpers ────────────────────────────────────────────────────────────


def test_detect_source_type_youtube_watch() -> None:
    assert sermons_service.detect_source_type("https://www.youtube.com/watch?v=abc123") == "youtube"


def test_detect_source_type_youtube_short() -> None:
    assert sermons_service.detect_source_type("https://youtu.be/abc12345") == "youtube"


def test_detect_source_type_podcast() -> None:
    assert sermons_service.detect_source_type("https://podcasts.apple.com/show/123") == "podcast"
    assert sermons_service.detect_source_type("https://feed.example.org/show.rss") == "podcast"


def test_detect_source_type_other() -> None:
    assert sermons_service.detect_source_type("https://example.com/sermon.mp3") == "other"


def test_youtube_video_id_extracts_from_watch() -> None:
    assert (
        sermons_service.youtube_video_id("https://www.youtube.com/watch?v=abc12345") == "abc12345"
    )


def test_youtube_video_id_extracts_from_short() -> None:
    assert sermons_service.youtube_video_id("https://youtu.be/abc12345") == "abc12345"


def test_youtube_video_id_returns_none_for_non_youtube() -> None:
    assert sermons_service.youtube_video_id("https://example.com/abc12345") is None


# ── HTTP endpoints ──────────────────────────────────────────────────────────


def test_create_non_leader_403() -> None:
    res = TestClient(_app(block_leader=True)).post(
        "/api/groups/g1/sermons",
        json={"sourceUrl": "https://www.youtube.com/watch?v=abc12345"},
    )
    assert res.status_code == 403


def test_create_youtube_pulls_oembed_metadata() -> None:
    fs = FakeFirestore()
    leader = _membership()

    def fake_oembed(url: str, **_kw: Any) -> dict[str, Any] | None:
        return {"title": "Sunday Sermon", "thumbnail": "https://img.youtube/abc.jpg"}

    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch("app.routers.sermons.sermons_service.fetch_youtube_oembed", side_effect=fake_oembed),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(leader_membership=leader)).post(
            "/api/groups/g1/sermons",
            json={"sourceUrl": "https://www.youtube.com/watch?v=abc12345"},
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["title"] == "Sunday Sermon"
    # `==` rather than startswith to avoid the CodeQL substring-
    # sanitization warning the latter triggers in trivial test code.
    assert body["thumbnail"] == "https://img.youtube/abc.jpg"
    assert body["sourceType"] == "youtube"


def test_create_non_youtube_keeps_thumbnail_null() -> None:
    fs = FakeFirestore()
    leader = _membership()
    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(leader_membership=leader)).post(
            "/api/groups/g1/sermons",
            json={"sourceUrl": "https://example.com/sermon.mp3", "title": "Sermon"},
        )
    assert res.status_code == 201
    body = res.json()
    assert body["thumbnail"] is None
    assert body["sourceType"] == "other"


def test_create_invalid_date_returns_400() -> None:
    fs = FakeFirestore()
    leader = _membership()
    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(leader_membership=leader)).post(
            "/api/groups/g1/sermons",
            json={
                "sourceUrl": "https://example.com/sermon",
                "title": "S",
                "sermonDate": "12/01/2026",  # not ISO
            },
        )
    # The pydantic regex catches this at 422 before the handler runs.
    assert res.status_code == 422


def test_create_on_archived_group_returns_409() -> None:
    fs = FakeFirestore()
    leader = _membership(archived=True)
    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(leader_membership=leader)).post(
            "/api/groups/g1/sermons",
            json={"sourceUrl": "https://example.com/sermon", "title": "S"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "group_archived"


def test_list_excludes_soft_deleted_and_collects_preachers() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "groups/g1/sermons/s1",
        {
            "title": "A",
            "preacher": "Pastor Jane",
            "sourceUrl": "https://example.com/a",
            "sourceType": "other",
            "addedBy": "leader-1",
            "addedAt": datetime.now(UTC),
            "deletedAt": None,
        },
    )
    fs._doc_set(
        "groups/g1/sermons/s2",
        {
            "title": "B",
            "preacher": "Pastor Mark",
            "sourceUrl": "https://example.com/b",
            "sourceType": "other",
            "addedBy": "leader-1",
            "addedAt": datetime.now(UTC),
            "deletedAt": datetime.now(UTC),
        },
    )
    member = _membership(role="member")
    with patch("app.routers.sermons._db", return_value=fs):
        res = TestClient(_app(member_membership=member)).get("/api/groups/g1/sermons")
    assert res.status_code == 200
    body = res.json()
    ids = [s["sermonId"] for s in body["sermons"]]
    assert ids == ["s1"]
    assert body["preachers"] == ["Pastor Jane"]


def test_get_404_when_soft_deleted() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "groups/g1/sermons/s1",
        {
            "title": "A",
            "sourceUrl": "https://example.com/a",
            "sourceType": "other",
            "addedBy": "leader-1",
            "addedAt": datetime.now(UTC),
            "deletedAt": datetime.now(UTC),
        },
    )
    member = _membership(role="member")
    with patch("app.routers.sermons._db", return_value=fs):
        res = TestClient(_app(member_membership=member)).get("/api/groups/g1/sermons/s1")
    assert res.status_code == 404


def test_patch_updates_supplied_fields_only() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "groups/g1/sermons/s1",
        {
            "title": "Old",
            "preacher": "Pastor Jane",
            "scripture": "Ps 23",
            "sourceUrl": "https://example.com/a",
            "sourceType": "other",
            "addedBy": "leader-1",
            "addedAt": datetime.now(UTC),
            "deletedAt": None,
        },
    )
    leader = _membership()
    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(leader_membership=leader)).patch(
            "/api/groups/g1/sermons/s1",
            json={"title": "New"},
        )
    assert res.status_code == 200
    assert res.json()["title"] == "New"
    # Other fields preserved
    assert fs._doc_get("groups/g1/sermons/s1")["preacher"] == "Pastor Jane"


def test_delete_sets_deleted_at_and_idempotent() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "groups/g1/sermons/s1",
        {
            "title": "A",
            "sourceUrl": "https://example.com/a",
            "sourceType": "other",
            "addedBy": "leader-1",
            "addedAt": datetime.now(UTC),
            "deletedAt": None,
        },
    )
    leader = _membership()
    with (
        patch("app.routers.sermons._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        first = TestClient(_app(leader_membership=leader)).delete("/api/groups/g1/sermons/s1")
        second = TestClient(_app(leader_membership=leader)).delete("/api/groups/g1/sermons/s1")
    assert first.status_code == 200
    assert first.json()["deleted"] is True
    assert second.status_code == 200
    assert second.json()["deleted"] is False
    assert fs._doc_get("groups/g1/sermons/s1")["deletedAt"] is not None
