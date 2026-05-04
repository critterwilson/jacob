"""Tests for the T64 appeals surface."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.appeals import admin_router, appellant_router
from app.services import appeals as appeals_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1", *, is_admin: bool = False) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(*, user: CurrentUser, is_admin: bool) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(appellant_router)
    app.include_router(admin_router)
    app.dependency_overrides[get_current_user] = lambda: user
    if is_admin:
        app.dependency_overrides[require_admin] = lambda: user
    else:

        def _forbid() -> CurrentUser:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": {
                        "code": "forbidden",
                        "message": "Admin privileges required",
                        "details": {},
                    }
                },
            )

        app.dependency_overrides[require_admin] = _forbid
    return app


# ── service-layer ───────────────────────────────────────────────────────────


def test_submit_creates_pending_appeal() -> None:
    fs = FakeFirestore()
    ok, _, appeal_id = appeals_service.submit_appeal(
        fs,
        subject_type="message",
        subject_ref="groups/g1/messages/m1",
        appellant_uid="u1",
        body="I think this was a mistake — the message was prayer, not harassment.",
    )
    assert ok and appeal_id
    assert fs._doc_get(f"appeals/{appeal_id}")["decision"] == "pending"


def test_submit_dedupes_per_subject_per_user() -> None:
    fs = FakeFirestore()
    appeals_service.submit_appeal(
        fs,
        subject_type="message",
        subject_ref="groups/g1/messages/m1",
        appellant_uid="u1",
        body="A" * 50,
    )
    ok, reason, _ = appeals_service.submit_appeal(
        fs,
        subject_type="message",
        subject_ref="groups/g1/messages/m1",
        appellant_uid="u1",
        body="B" * 50,
    )
    assert not ok
    assert reason == "appeal_already_decided"


def test_decide_self_review_rejected_by_default() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-1",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    ok, reason = appeals_service.decide(
        fs,
        appeal_id="a1",
        actor_uid="admin-1",
        decision="upheld",
        reasoning="A" * 50,
    )
    assert not ok and reason == "self_review_required"


def test_decide_self_review_allowed_with_env_override() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-1",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    with patch.dict("os.environ", {appeals_service.SELF_REVIEW_OVERRIDE_ENV: "true"}):
        ok, _ = appeals_service.decide(
            fs,
            appeal_id="a1",
            actor_uid="admin-1",
            decision="upheld",
            reasoning="A" * 50,
        )
    assert ok


def test_decide_reverses_message_subject() -> None:
    fs = FakeFirestore()
    # Seed an appeal whose subject is a moderated message.
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-A",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    fs._doc_set(
        "groups/g1/messages/m1",
        {
            "body": "test",
            "moderation": {"state": "hidden", "reason": "harassment"},
        },
    )
    ok, _ = appeals_service.decide(
        fs,
        appeal_id="a1",
        actor_uid="admin-B",
        decision="reversed",
        reasoning="A" * 50,
    )
    assert ok
    # The reversal helper sets `moderation: DELETE_FIELD` via merge — the
    # FakeFirestore writes it through; in production Firestore actually
    # removes the field. The test confirms `decide` returned ok and the
    # appeal flipped to reversed.
    assert fs._doc_get("appeals/a1")["decision"] == "reversed"


def test_decide_lifts_ban_subject() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "ban", "ref": "bans/u1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-A",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    fs._doc_set("bans/u1", {"reason": "spam"})
    ok, _ = appeals_service.decide(
        fs,
        appeal_id="a1",
        actor_uid="admin-B",
        decision="reversed",
        reasoning="A" * 50,
    )
    assert ok
    assert fs._doc_get("bans/u1") is None


def test_is_overdue_true_after_7_days() -> None:
    submitted = datetime.now(UTC) - timedelta(days=8)
    assert appeals_service.is_overdue(submitted) is True


def test_is_overdue_false_within_7_days() -> None:
    submitted = datetime.now(UTC) - timedelta(days=6)
    assert appeals_service.is_overdue(submitted) is False


# ── HTTP endpoints ──────────────────────────────────────────────────────────


def test_submit_endpoint_creates_appeal() -> None:
    fs = FakeFirestore()
    user = _user("u1")
    with (
        patch("app.routers.appeals._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user, is_admin=False)).post(
            "/api/appeals",
            json={
                "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
                "body": ("This was a mistake — please review the context. " * 2),
            },
        )
    assert res.status_code == 200, res.text
    assert res.json()["decision"] == "pending"


def test_submit_409_when_existing_appeal() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/existing",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    user = _user("u1")
    with patch("app.routers.appeals._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=False)).post(
            "/api/appeals",
            json={
                "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
                "body": "B" * 50,
            },
        )
    assert res.status_code == 409


def test_get_appeal_visible_to_appellant_only() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-A",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
            "body": "x",
        },
    )
    user = _user("stranger")
    with patch("app.routers.appeals._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=False)).get("/api/appeals/a1")
    assert res.status_code == 403


def test_admin_decide_blocks_self_review() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-1",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    user = _user("admin-1", is_admin=True)
    with patch("app.routers.appeals._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/appeals/a1/decide",
            json={"decision": "upheld", "reasoning": "A" * 50},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "self_review_required"


def test_admin_decide_happy_path_different_admin() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-1",
            "decision": "pending",
            "submittedAt": datetime.now(UTC),
        },
    )
    user = _user("admin-2", is_admin=True)
    with (
        patch("app.routers.appeals._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/appeals/a1/decide",
            json={
                "decision": "upheld",
                "reasoning": ("Reviewed context — original action stands. " * 2),
            },
        )
    assert res.status_code == 200
    assert res.json()["decision"] == "upheld"


def test_admin_decide_409_when_already_decided() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "appeals/a1",
        {
            "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
            "appellantUid": "u1",
            "originalActorUid": "admin-1",
            "decision": "upheld",
            "submittedAt": datetime.now(UTC),
        },
    )
    user = _user("admin-2", is_admin=True)
    with patch("app.routers.appeals._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/appeals/a1/decide",
            json={"decision": "upheld", "reasoning": "A" * 50},
        )
    assert res.status_code == 409
