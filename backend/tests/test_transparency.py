"""Tests for the T65 transparency report surface."""

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
from app.routers.transparency import admin_router, org_router, public_router
from app.services import transparency as transparency_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1", *, is_admin: bool = False) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(*, user: CurrentUser | None = None, is_admin: bool = False) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(public_router)
    app.include_router(admin_router)
    app.include_router(org_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    if is_admin and user is not None:
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


def _q1_window() -> tuple[datetime, datetime]:
    return (
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 4, 1, tzinfo=UTC),
    )


# ── period helpers ──────────────────────────────────────────────────────────


def test_quarter_for() -> None:
    assert transparency_service.quarter_for(datetime(2026, 2, 14, tzinfo=UTC)) == "2026-Q1"
    assert transparency_service.quarter_for(datetime(2026, 11, 5, tzinfo=UTC)) == "2026-Q4"


def test_previous_quarter_wraps_year() -> None:
    label, start, end = transparency_service.previous_quarter(datetime(2026, 2, 14, tzinfo=UTC))
    assert label == "2025-Q4"
    assert start == datetime(2025, 10, 1, tzinfo=UTC)
    assert end == datetime(2026, 1, 1, tzinfo=UTC)


def test_previous_quarter_within_year() -> None:
    label, start, end = transparency_service.previous_quarter(datetime(2026, 5, 1, tzinfo=UTC))
    assert label == "2026-Q1"
    assert start == datetime(2026, 1, 1, tzinfo=UTC)
    assert end == datetime(2026, 4, 1, tzinfo=UTC)


# ── privacy guard ───────────────────────────────────────────────────────────


def test_payload_contains_pii_clean() -> None:
    payload = {
        "reports": {"received": 4, "byCategory": {"harassment": 2, "spam": 2}},
        "appeals": {"submitted": 1, "upheld": 0, "reversed": 1, "pending": 0},
    }
    assert transparency_service.payload_contains_pii(payload) is None


def test_payload_contains_pii_catches_uid() -> None:
    payload = {"note": "Reviewed by abcdefghijklmnopqrstuvwxyz12"}
    leak = transparency_service.payload_contains_pii(payload)
    assert leak == "abcdefghijklmnopqrstuvwxyz12"


def test_payload_contains_pii_catches_path() -> None:
    payload = {"deep": {"nested": ["something", "groups/g1/messages/m1"]}}
    leak = transparency_service.payload_contains_pii(payload)
    assert leak is not None
    assert "groups/g1" in leak


def test_payload_contains_pii_catches_email() -> None:
    payload = {"reporter": "alice@example.com"}
    leak = transparency_service.payload_contains_pii(payload)
    assert leak == "alice@example.com"


# ── aggregation ─────────────────────────────────────────────────────────────


def test_generate_report_buckets_reports_by_category() -> None:
    fs = FakeFirestore()
    start, end = _q1_window()
    inside = datetime(2026, 2, 1, tzinfo=UTC)
    outside = datetime(2025, 12, 1, tzinfo=UTC)
    fs._doc_set(
        "moderation_queue/r1",
        {"reason": "harassment", "groupId": "g1", "createdAt": inside, "status": "pending"},
    )
    fs._doc_set(
        "moderation_queue/r2",
        {"reason": "harassment", "groupId": "g1", "createdAt": inside, "status": "pending"},
    )
    fs._doc_set(
        "moderation_queue/r3",
        {"reason": "spam", "groupId": "g2", "createdAt": inside, "status": "pending"},
    )
    fs._doc_set(
        "moderation_queue/r4",
        {"reason": "spam", "groupId": "g2", "createdAt": outside, "status": "pending"},
    )
    payload = transparency_service.generate_report(
        fs, period="2026-Q1", start=start, end=end, scope="platform"
    )
    assert payload["reports"]["received"] == 3
    assert payload["reports"]["byCategory"]["harassment"] == 2
    assert payload["reports"]["byCategory"]["spam"] == 1


def test_generate_report_counts_audit_buckets() -> None:
    fs = FakeFirestore()
    start, end = _q1_window()
    inside = datetime(2026, 2, 14, tzinfo=UTC)
    actions = [
        "moderation_approved",
        "moderation_approved",
        "ban_user",
        "unban_user",
        "ncmec_submit",
        "appeal_submit",
        "account_delete_requested",
        "export_request",
    ]
    for i, a in enumerate(actions):
        fs._doc_set(
            f"audit_log/a{i}",
            {"action": a, "actorUid": "admin1", "createdAt": inside, "targetRef": "x"},
        )
    payload = transparency_service.generate_report(
        fs, period="2026-Q1", start=start, end=end, scope="platform"
    )
    assert payload["moderationActions"]["contentHidden"] == 2
    assert payload["moderationActions"]["accountsBanned"] == 1
    assert payload["moderationActions"]["accountsUnbanned"] == 1
    assert payload["ncmec"]["submitted"] == 1
    assert payload["appeals"]["submitted"] == 1
    assert payload["accountActions"]["deletionRequested"] == 1
    assert payload["accountActions"]["exportRequested"] == 1


def test_generate_report_counts_appeals_by_decision() -> None:
    fs = FakeFirestore()
    start, end = _q1_window()
    inside = datetime(2026, 2, 14, tzinfo=UTC)
    for i, decision in enumerate(["upheld", "reversed", "reversed", "pending"]):
        fs._doc_set(
            f"appeals/a{i}",
            {
                "subject": {"type": "message", "ref": "groups/g1/messages/m1"},
                "decision": decision,
                "submittedAt": inside,
            },
        )
    payload = transparency_service.generate_report(
        fs, period="2026-Q1", start=start, end=end, scope="platform"
    )
    assert payload["appeals"]["upheld"] == 1
    assert payload["appeals"]["reversed"] == 2
    assert payload["appeals"]["pending"] == 1


def test_generate_report_org_scope_filters_to_org_groups() -> None:
    fs = FakeFirestore()
    start, end = _q1_window()
    inside = datetime(2026, 2, 14, tzinfo=UTC)
    fs._doc_set("groups/g1", {"orgId": "myorg", "name": "G1"})
    fs._doc_set("groups/g2", {"orgId": "myorg", "name": "G2"})
    fs._doc_set("groups/g3", {"orgId": "other", "name": "G3"})
    fs._doc_set(
        "moderation_queue/r1",
        {"reason": "harassment", "groupId": "g1", "createdAt": inside, "status": "pending"},
    )
    fs._doc_set(
        "moderation_queue/r2",
        {"reason": "spam", "groupId": "g3", "createdAt": inside, "status": "pending"},
    )
    fs._doc_set(
        "audit_log/a1",
        {
            "action": "ban_user",
            "createdAt": inside,
            "targetRef": "groups/g1/messages/m1",
        },
    )
    fs._doc_set(
        "audit_log/a2",
        {
            "action": "ban_user",
            "createdAt": inside,
            "targetRef": "groups/g3/messages/m2",
        },
    )
    payload = transparency_service.generate_report(
        fs, period="2026-Q1", start=start, end=end, scope="myorg"
    )
    assert payload["reports"]["received"] == 1
    assert payload["reports"]["byCategory"] == {"harassment": 1}
    assert payload["moderationActions"]["accountsBanned"] == 1


def test_generated_payload_passes_privacy_guard() -> None:
    """The generated payload must NEVER contain identifiers (privacy contract)."""
    fs = FakeFirestore()
    start, end = _q1_window()
    inside = datetime(2026, 2, 14, tzinfo=UTC)
    fs._doc_set(
        "moderation_queue/r1",
        {
            "reason": "harassment",
            "groupId": "g1",
            "createdAt": inside,
            "context": ("Mean things to alice@example.com — by abcdefghijklmnopqrstuvwxyz12"),
            "reportedBy": "u-aaaaaaaaaaaaaaaaaaaaaaaaaa1",
        },
    )
    fs._doc_set(
        "audit_log/a1",
        {
            "action": "ban_user",
            "actorUid": "u-bbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "targetRef": "users/u-cccccccccccccccccccccccccc1",
            "createdAt": inside,
            "payload": {"reason": "spam"},
        },
    )
    payload = transparency_service.generate_report(
        fs, period="2026-Q1", start=start, end=end, scope="platform"
    )
    leak = transparency_service.payload_contains_pii(payload)
    assert leak is None, f"Payload leaked identifier: {leak!r}"


# ── persistence ─────────────────────────────────────────────────────────────


def test_write_draft_then_publish_roundtrip() -> None:
    fs = FakeFirestore()
    payload = {"reports": {"received": 5}}
    report_id = transparency_service.write_draft(
        fs, period="2026-Q1", scope="platform", payload=payload
    )
    assert fs._doc_get(f"transparency_reports/{report_id}")["publishedAt"] is None
    ok, reason = transparency_service.publish(fs, report_id=report_id)
    assert ok and reason is None
    assert fs._doc_get(f"transparency_reports/{report_id}")["publishedAt"] is not None


def test_write_draft_rejects_pii_leak() -> None:
    fs = FakeFirestore()
    try:
        transparency_service.write_draft(
            fs,
            period="2026-Q1",
            scope="platform",
            payload={"note": "leaked groups/g1/messages/m1"},
        )
    except ValueError as exc:
        assert "leak" in str(exc)
    else:
        raise AssertionError("write_draft should have refused a payload with PII")


def test_publish_409_when_already_published() -> None:
    fs = FakeFirestore()
    report_id = transparency_service.write_draft(
        fs, period="2026-Q1", scope="platform", payload={"reports": {"received": 0}}
    )
    transparency_service.publish(fs, report_id=report_id)
    ok, reason = transparency_service.publish(fs, report_id=report_id)
    assert not ok and reason == "already_published"


def test_latest_published_picks_most_recent() -> None:
    fs = FakeFirestore()
    older = transparency_service.write_draft(
        fs, period="2026-Q1", scope="platform", payload={"reports": {"received": 1}}
    )
    newer = transparency_service.write_draft(
        fs, period="2026-Q2", scope="platform", payload={"reports": {"received": 2}}
    )
    transparency_service.publish(fs, report_id=older, now=datetime(2026, 4, 5, tzinfo=UTC))
    transparency_service.publish(fs, report_id=newer, now=datetime(2026, 7, 5, tzinfo=UTC))
    latest = transparency_service.latest_published(fs, scope="platform")
    assert latest is not None
    assert latest["reportId"] == newer


# ── HTTP endpoints ──────────────────────────────────────────────────────────


def test_get_latest_returns_null_when_no_published_report() -> None:
    fs = FakeFirestore()
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app()).get("/api/transparency/latest")
    assert res.status_code == 200
    assert res.json() is None


def test_get_latest_returns_published_report() -> None:
    fs = FakeFirestore()
    rid = transparency_service.write_draft(
        fs, period="2026-Q1", scope="platform", payload={"reports": {"received": 3}}
    )
    transparency_service.publish(fs, report_id=rid)
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app()).get("/api/transparency/latest")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["period"] == "2026-Q1"
    assert body["payload"]["reports"]["received"] == 3


def test_admin_generate_creates_draft() -> None:
    fs = FakeFirestore()
    user = _user("admin1", is_admin=True)
    with (
        patch("app.routers.transparency._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/transparency/generate?period=2026-Q1"
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["period"] == "2026-Q1"
    assert body["publishedAt"] is None


def test_admin_generate_rejects_bad_period() -> None:
    fs = FakeFirestore()
    user = _user("admin1", is_admin=True)
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/transparency/generate?period=2026-Q9"
        )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "bad_period"


def test_admin_publish_marks_report_published() -> None:
    fs = FakeFirestore()
    rid = transparency_service.write_draft(
        fs, period="2026-Q1", scope="platform", payload={"reports": {"received": 0}}
    )
    user = _user("admin1", is_admin=True)
    with (
        patch("app.routers.transparency._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            f"/api/admin/transparency/{rid}/publish"
        )
    assert res.status_code == 200, res.text
    assert res.json()["publishedAt"] is not None


def test_admin_publish_404_when_missing() -> None:
    fs = FakeFirestore()
    user = _user("admin1", is_admin=True)
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/transparency/missing/publish"
        )
    assert res.status_code == 404


def test_admin_audit_csv_returns_csv() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "audit_log/a1",
        {
            "action": "ban_user",
            "actorUid": "admin1",
            "targetRef": "users/u1",
            "createdAt": datetime.now(UTC) - timedelta(days=1),
        },
    )
    user = _user("admin1", is_admin=True)
    with (
        patch("app.routers.transparency._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user, is_admin=True)).get(
            "/api/admin/transparency/audit-log.csv?days=7"
        )
    assert res.status_code == 200
    assert "createdAt,action,actorUid,targetRef" in res.text
    assert "ban_user" in res.text
    assert res.headers["content-type"].startswith("text/csv")


def test_org_latest_403_for_non_admin() -> None:
    fs = FakeFirestore()
    fs._doc_set("orgs/myorg", {"name": "My Org"})
    user = _user("stranger")
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/myorg/transparency/latest")
    assert res.status_code == 403


def test_org_latest_200_for_org_admin() -> None:
    fs = FakeFirestore()
    fs._doc_set("orgs/myorg", {"name": "My Org"})
    fs._doc_set("orgs/myorg/admins/admin1", {"addedAt": datetime.now(UTC)})
    rid = transparency_service.write_draft(
        fs, period="2026-Q1", scope="myorg", payload={"reports": {"received": 1}}
    )
    transparency_service.publish(fs, report_id=rid)
    user = _user("admin1")
    with patch("app.routers.transparency._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/myorg/transparency/latest")
    assert res.status_code == 200, res.text
    assert res.json()["scope"] == "myorg"


# ── audit-log CSV ───────────────────────────────────────────────────────────


def test_stream_audit_csv_filters_window_and_sorts() -> None:
    fs = FakeFirestore()
    inside = datetime(2026, 2, 14, tzinfo=UTC)
    later = datetime(2026, 2, 15, tzinfo=UTC)
    outside = datetime(2025, 1, 1, tzinfo=UTC)
    fs._doc_set(
        "audit_log/old",
        {"action": "ban_user", "createdAt": outside, "actorUid": "x", "targetRef": "y"},
    )
    fs._doc_set(
        "audit_log/b",
        {
            "action": "appeal_submit",
            "createdAt": later,
            "actorUid": "u2",
            "targetRef": "appeals/a2",
        },
    )
    fs._doc_set(
        "audit_log/a",
        {
            "action": "ncmec_submit",
            "createdAt": inside,
            "actorUid": "u1",
            "targetRef": "ncmec_cases/c1",
        },
    )
    text = transparency_service.stream_audit_csv(
        fs, start=datetime(2026, 1, 1, tzinfo=UTC), end=datetime(2026, 4, 1, tzinfo=UTC)
    )
    lines = [ln for ln in text.splitlines() if ln.strip()]
    # header + 2 rows; order is by createdAt ascending
    assert lines[0] == "createdAt,action,actorUid,targetRef"
    assert "ncmec_submit" in lines[1]
    assert "appeal_submit" in lines[2]
    assert "ban_user" not in text  # outside window
