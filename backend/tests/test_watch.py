"""Tests for the T50 Watch Together surface.

FEATURE PARKED 2026-05-17: Watch Together deferred by ministry owner.
All tests in this module are skipped. Re-enable when T50 is revived.
See docs/follow-ups/phase-3-parked.md § T50.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import (
    MembershipContext,
    require_member,
    require_member_not_banned,
)
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.routers.watch import router
from tests.test_orgs import FakeFirestore  # noqa: E402

# Feature parked 2026-05-17 — skip the whole module until T50 is revived.
_PARKED = "T50 Watch Together parked; see docs/follow-ups/phase-3-parked.md"
pytestmark = pytest.mark.skip(reason=_PARKED)


def _membership(
    *,
    uid: str = "alice",
    gid: str = "g1",
    role: str = "member",
    archived: bool = False,
) -> MembershipContext:
    group_data: dict[str, Any] = {"name": "Group"}
    if archived:
        group_data["archivedAt"] = datetime.now(UTC)
    return MembershipContext(gid=gid, uid=uid, role=role, group=group_data)


def _app(
    *,
    member: MembershipContext | None = None,
    banned: bool = False,
) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    if member is not None:
        app.dependency_overrides[require_member] = lambda: member
        if not banned:
            app.dependency_overrides[require_member_not_banned] = lambda: member
        else:

            def _banned() -> MembershipContext:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": {
                            "code": "user_banned",
                            "message": "User is banned",
                            "details": {},
                        }
                    },
                )

            app.dependency_overrides[require_member_not_banned] = _banned
    return app


# ── start ────────────────────────────────────────────────────────────────────


def test_start_extracts_youtube_video_id() -> None:
    fs = FakeFirestore()
    member = _membership()

    def fake_oembed(url: str, **_kw: Any) -> dict[str, Any] | None:
        return {"title": "Sermon", "thumbnail": "https://img.youtube/abc.jpg"}

    with (
        patch("app.routers.watch._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch("app.services.watch.fetch_oembed_metadata", side_effect=fake_oembed),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/start",
            json={"videoUrl": "https://www.youtube.com/watch?v=abc12345"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["videoId"] == "abc12345"
    assert body["title"] == "Sermon"


def test_start_rejects_non_youtube_url_with_400() -> None:
    fs = FakeFirestore()
    member = _membership()
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/start",
            json={"videoUrl": "https://vimeo.com/12345"},
        )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_youtube_url"


def test_start_in_archived_group_returns_409() -> None:
    fs = FakeFirestore()
    member = _membership(archived=True)
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/start",
            json={"videoUrl": "https://youtu.be/abc12345"},
        )
    assert res.status_code == 409


def test_start_blocked_for_banned_member() -> None:
    fs = FakeFirestore()
    member = _membership()
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member, banned=True)).post(
            "/api/groups/g1/watch/start",
            json={"videoUrl": "https://youtu.be/abc12345"},
        )
    assert res.status_code == 403


# ── join / end / transfer ────────────────────────────────────────────────────


def _seed_session(
    fs: FakeFirestore,
    *,
    sid: str = "s1",
    leader: str = "alice",
    attendees: list[str] | None = None,
    ended: bool = False,
) -> None:
    fs._doc_set(
        f"groups/g1/watch_sessions/{sid}",
        {
            "videoId": "abc12345",
            "sourceUrl": "https://youtu.be/abc12345",
            "title": "T",
            "thumbnailUrl": None,
            "leaderUid": leader,
            "createdBy": leader,
            "createdAt": datetime.now(UTC) - timedelta(minutes=5),
            "endedAt": datetime.now(UTC) if ended else None,
            "attendees": attendees or [leader],
            "durationSec": None,
        },
    )


def test_join_appends_to_attendees() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice"])
    member = _membership(uid="bob")
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post("/api/groups/g1/watch/s1/join")
    assert res.status_code == 200
    assert sorted(res.json()["attendees"]) == ["alice", "bob"]


def test_join_404_when_missing() -> None:
    fs = FakeFirestore()
    member = _membership()
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post("/api/groups/g1/watch/missing/join")
    assert res.status_code == 404


def test_join_409_when_session_ended() -> None:
    fs = FakeFirestore()
    _seed_session(fs, ended=True, attendees=["alice"])
    member = _membership(uid="bob")
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post("/api/groups/g1/watch/s1/join")
    assert res.status_code == 409


def test_end_writes_duration_and_audit() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice"])
    member = _membership(uid="alice")
    with (
        patch("app.routers.watch._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(member=member)).post("/api/groups/g1/watch/s1/end")
    assert res.status_code == 200
    assert res.json()["durationSec"] >= 0
    assert fs._doc_get("groups/g1/watch_sessions/s1")["endedAt"] is not None


def test_end_403_when_not_attendee() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice"])
    member = _membership(uid="stranger")
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post("/api/groups/g1/watch/s1/end")
    assert res.status_code == 403


def test_transfer_only_current_leader_can_transfer() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice", "bob"])
    member = _membership(uid="bob")  # bob isn't the leader
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/s1/transfer",
            json={"newLeaderUid": "alice"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "not_leader"


def test_transfer_succeeds_for_current_leader() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice", "bob"])
    member = _membership(uid="alice")  # current leader
    with (
        patch("app.routers.watch._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/s1/transfer",
            json={"newLeaderUid": "bob"},
        )
    assert res.status_code == 200
    assert res.json()["leaderUid"] == "bob"
    assert fs._doc_get("groups/g1/watch_sessions/s1")["leaderUid"] == "bob"


def test_transfer_409_when_new_leader_not_attendee() -> None:
    fs = FakeFirestore()
    _seed_session(fs, attendees=["alice"])
    member = _membership(uid="alice")
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).post(
            "/api/groups/g1/watch/s1/transfer",
            json={"newLeaderUid": "stranger"},
        )
    assert res.status_code == 409


def test_list_returns_only_active_sessions() -> None:
    fs = FakeFirestore()
    _seed_session(fs, sid="active")
    _seed_session(fs, sid="ended", ended=True)
    member = _membership(uid="alice")
    with patch("app.routers.watch._db", return_value=fs):
        res = TestClient(_app(member=member)).get("/api/groups/g1/watch")
    ids = [s["sessionId"] for s in res.json()["sessions"]]
    assert ids == ["active"]
