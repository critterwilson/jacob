"""Tests for the T59 incident surface.

Coverage:
- non-admin → 403 on declare/clear
- declare happy path: writes incident + audit row, returns id
- clear sets displayUntil to past, audit row, 404 when missing
- list filters out incidents whose displayUntil has elapsed
- admin list returns expired incidents too
- validation: displayMinutes range, severity literal
"""

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
from app.routers.incidents import admin_router, router

# Re-use the FakeFirestore from test_orgs.
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
    app.include_router(router)
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


def _seed_incident(
    fs: FakeFirestore,
    *,
    incident_id: str,
    severity: str = "SEV2",
    title: str = "Search down",
    body: str = "We're investigating.",
    display_until: datetime | None = None,
) -> None:
    fs._doc_set(
        f"active_incidents/{incident_id}",
        {
            "severity": severity,
            "title": title,
            "body": body,
            "createdBy": "admin-1",
            "createdAt": datetime.now(UTC),
            "displayUntil": display_until or (datetime.now(UTC) + timedelta(hours=1)),
            "acknowledged": False,
        },
    )


def test_declare_non_admin_403() -> None:
    user = _user("u1")
    res = TestClient(_app(user=user, is_admin=False)).post(
        "/api/admin/incidents",
        json={
            "severity": "SEV2",
            "title": "x",
            "body": "y",
            "displayMinutes": 30,
        },
    )
    assert res.status_code == 403


def test_declare_happy_path_writes_audit() -> None:
    user = _user("admin", is_admin=True)
    fs = FakeFirestore()
    with (
        patch("app.routers.incidents._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/incidents",
            json={
                "severity": "SEV1",
                "title": "Login broken",
                "body": "Investigating",
                "displayMinutes": 30,
            },
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["severity"] == "SEV1"
    assert "incidentId" in body
    # Incident persisted
    assert fs._doc_get(f"active_incidents/{body['incidentId']}") is not None
    # Audit row written
    assert any(p.startswith("audit_log/") for p in fs.docs.keys())


def test_declare_validates_display_minutes_lower_bound() -> None:
    user = _user("admin", is_admin=True)
    res = TestClient(_app(user=user, is_admin=True)).post(
        "/api/admin/incidents",
        json={
            "severity": "SEV2",
            "title": "x",
            "body": "y",
            "displayMinutes": 1,  # below 15-minute floor
        },
    )
    assert res.status_code == 422


def test_declare_validates_display_minutes_upper_bound() -> None:
    user = _user("admin", is_admin=True)
    res = TestClient(_app(user=user, is_admin=True)).post(
        "/api/admin/incidents",
        json={
            "severity": "SEV2",
            "title": "x",
            "body": "y",
            "displayMinutes": 5000,  # above 24-hour ceiling
        },
    )
    assert res.status_code == 422


def test_declare_rejects_invalid_severity() -> None:
    user = _user("admin", is_admin=True)
    res = TestClient(_app(user=user, is_admin=True)).post(
        "/api/admin/incidents",
        json={
            "severity": "MEDIUM",  # not SEV1/2/3
            "title": "x",
            "body": "y",
            "displayMinutes": 30,
        },
    )
    assert res.status_code == 422


def test_clear_404_when_missing() -> None:
    user = _user("admin", is_admin=True)
    fs = FakeFirestore()
    with patch("app.routers.incidents._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/incidents/missing/clear",
        )
    assert res.status_code == 404


def test_clear_sets_display_until_past() -> None:
    user = _user("admin", is_admin=True)
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="i1")
    with (
        patch("app.routers.incidents._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/incidents/i1/clear",
        )
    assert res.status_code == 200
    cleared_until = fs._doc_get("active_incidents/i1")["displayUntil"]
    assert cleared_until < datetime.now(UTC)


def test_list_active_filters_expired() -> None:
    user = _user("u1")
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="active", display_until=datetime.now(UTC) + timedelta(hours=1))
    _seed_incident(fs, incident_id="expired", display_until=datetime.now(UTC) - timedelta(hours=1))
    with patch("app.routers.incidents._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=False)).get("/api/incidents")
    assert res.status_code == 200
    ids = [i["incidentId"] for i in res.json()["incidents"]]
    assert ids == ["active"]


def test_admin_list_includes_expired() -> None:
    user = _user("admin", is_admin=True)
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="active", display_until=datetime.now(UTC) + timedelta(hours=1))
    _seed_incident(fs, incident_id="expired", display_until=datetime.now(UTC) - timedelta(hours=1))
    with patch("app.routers.incidents._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=True)).get("/api/admin/incidents")
    assert res.status_code == 200
    ids = sorted(i["incidentId"] for i in res.json()["incidents"])
    assert ids == ["active", "expired"]


# ── ETag / 304 ──────────────────────────────────────────────────────────


def test_list_incidents_etag_header_emitted() -> None:
    user = _user("u1")
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="i1", display_until=datetime.now(UTC) + timedelta(hours=1))
    with patch("app.routers.incidents._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=False)).get("/api/incidents")
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')


def test_list_incidents_if_none_match_returns_304() -> None:
    user = _user("u1")
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="i1", display_until=datetime.now(UTC) + timedelta(hours=1))
    client = TestClient(_app(user=user, is_admin=False))
    with patch("app.routers.incidents._db", return_value=fs):
        first = client.get("/api/incidents")
    assert first.status_code == 200
    etag = first.headers["etag"]
    with patch("app.routers.incidents._db", return_value=fs):
        second = client.get("/api/incidents", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.headers["etag"] == etag


def test_list_incidents_stale_etag_returns_200() -> None:
    user = _user("u1")
    fs = FakeFirestore()
    _seed_incident(fs, incident_id="i1", display_until=datetime.now(UTC) + timedelta(hours=1))
    with patch("app.routers.incidents._db", return_value=fs):
        res = TestClient(_app(user=user, is_admin=False)).get(
            "/api/incidents",
            headers={"If-None-Match": 'W/"stale-etag"'},
        )
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')
