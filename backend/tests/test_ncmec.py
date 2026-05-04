"""Tests for the T63 NCMEC reporting surface."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import require_admin
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.ncmec import router
from app.services import ncmec as ncmec_service
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "admin", *, is_admin: bool = True) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(*, user: CurrentUser, admin_grants: bool = True) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    if admin_grants:
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


def _seed_case(
    fs: FakeFirestore,
    *,
    case_id: str = "c1",
    status: str = "pending",
    submitted: bool = False,
) -> None:
    now = datetime.now(UTC)
    fs._doc_set(
        f"ncmec_cases/{case_id}",
        {
            "matchedAt": now,
            "hashSource": "photodna",
            "hashValue": "deadbeef" * 4,
            "evidence": {
                "gcsPath": f"_held/{case_id}.jpg",
                "sha256": "a" * 64,
                "sizeBytes": 1024,
                "contentType": "image/jpeg",
            },
            "reporterUid": None,
            "suspectUid": "uploader-uid",
            "status": status,
            "submittedBy": "admin" if submitted else None,
            "ncmecReportId": "STUB-XYZ" if submitted else None,
            "submittedAt": now if submitted else None,
            "retainedUntil": now,
            "withdrawnReason": None,
            "failureReason": None,
            "schemaVersion": 1,
        },
    )


# ── service-layer ───────────────────────────────────────────────────────────


def test_create_case_writes_pending_doc() -> None:
    fs = FakeFirestore()
    case_id = ncmec_service.create_case(
        fs,
        hash_source="photodna",
        hash_value="abc",
        evidence={"gcsPath": "_held/x.jpg", "sha256": "1" * 64, "sizeBytes": 100},
        suspect_uid="u1",
    )
    assert fs._doc_get(f"ncmec_cases/{case_id}")["status"] == "pending"


def test_submit_case_marks_submitted_and_attributes_operator() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    ok, reason = ncmec_service.submit_case(fs, case_id="c1", operator_uid="admin-1")
    assert ok and reason is None
    data = fs._doc_get("ncmec_cases/c1")
    assert data["status"] == "submitted"
    assert data["submittedBy"] == "admin-1"
    assert (data.get("ncmecReportId") or "").startswith("STUB-")


def test_submit_case_fails_when_already_submitted() -> None:
    fs = FakeFirestore()
    _seed_case(fs, status="submitted", submitted=True)
    ok, reason = ncmec_service.submit_case(fs, case_id="c1", operator_uid="admin-1")
    assert not ok and reason == "already_processed"


def test_submit_case_fails_when_kill_switch_engaged() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    with patch.dict("os.environ", {ncmec_service.SUBMIT_DISABLED_ENV: "true"}):
        ok, reason = ncmec_service.submit_case(fs, case_id="c1", operator_uid="admin-1")
    assert not ok and reason == "submit_disabled"


def test_withdraw_case_records_reason() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    ok, _ = ncmec_service.withdraw_case(
        fs,
        case_id="c1",
        operator_uid="admin-1",
        reason=("False positive — confirmed safe by operator review " * 2),
    )
    assert ok
    assert fs._doc_get("ncmec_cases/c1")["status"] == "withdrawn"


# ── HTTP endpoints ──────────────────────────────────────────────────────────


def test_pending_non_admin_403() -> None:
    user = _user(is_admin=False)
    res = TestClient(_app(user=user, admin_grants=False)).get("/api/admin/ncmec/pending")
    assert res.status_code == 403


def test_pending_returns_pending_cases_only() -> None:
    fs = FakeFirestore()
    _seed_case(fs, case_id="p1", status="pending")
    _seed_case(fs, case_id="s1", status="submitted")
    user = _user()
    with patch("app.routers.ncmec._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/admin/ncmec/pending")
    assert res.status_code == 200
    ids = [c["caseId"] for c in res.json()["cases"]]
    assert ids == ["p1"]


def test_submit_requires_typed_confirmation() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    user = _user()
    with patch("app.routers.ncmec._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/c1/submit",
            json={"confirm": "wrong"},
        )
    assert res.status_code == 422


def test_submit_happy_path() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    user = _user()
    with (
        patch("app.routers.ncmec._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/c1/submit",
            json={"confirm": "SUBMIT"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "submitted"
    assert body["ncmecReportId"].startswith("STUB-")


def test_submit_404_when_case_missing() -> None:
    fs = FakeFirestore()
    user = _user()
    with patch("app.routers.ncmec._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/missing/submit",
            json={"confirm": "SUBMIT"},
        )
    assert res.status_code == 404


def test_submit_409_when_case_already_processed() -> None:
    fs = FakeFirestore()
    _seed_case(fs, status="submitted", submitted=True)
    user = _user()
    with patch("app.routers.ncmec._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/c1/submit",
            json={"confirm": "SUBMIT"},
        )
    assert res.status_code == 409


def test_withdraw_requires_50_char_reason() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    user = _user()
    with patch("app.routers.ncmec._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/c1/withdraw",
            json={"reason": "too short"},
        )
    assert res.status_code == 422


def test_withdraw_records_reason_and_status() -> None:
    fs = FakeFirestore()
    _seed_case(fs)
    user = _user()
    long_reason = "False positive after operator review of the held file." * 2
    with (
        patch("app.routers.ncmec._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/admin/ncmec/c1/withdraw",
            json={"reason": long_reason},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "withdrawn"
    assert fs._doc_get("ncmec_cases/c1")["withdrawnReason"] == long_reason
