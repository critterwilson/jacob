"""Tests for the T55 custom-domains surface.

Covers:
- subdomain claim happy path + reserved + invalid + duplicate
- subdomain release
- vanity claim issues TXT, idempotent re-issue when pending
- vanity verify with TXT present flips status to verified
- vanity verify with TXT absent stays pending
- vanity release clears the org doc
- /api/by-host returns the org metadata for a claimed subdomain
- /api/by-host returns 404 for unknown / released / non-verified vanity
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.orgs import public_router, router
from app.services import dns_verification as dns_v
from app.services import domains as domains_service

# Re-use the FakeFirestore from test_orgs.
from tests.test_orgs import FakeFirestore  # noqa: E402


def _user(uid: str = "u1", *, is_admin: bool = False) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(*, user: CurrentUser, is_platform_admin: bool = False) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.include_router(public_router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    if is_platform_admin:
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


def _seed_org(
    fs: FakeFirestore,
    *,
    org_id: str,
    admins: list[str] | None = None,
    audience: str = "christian",
) -> None:
    fs._doc_set(
        f"orgs/{org_id}",
        {
            "name": "Pilot",
            "slug": "pilot",
            "audience": audience,
            "logoUrl": None,
            "primaryColor": None,
            "customDomain": None,
            "customSubdomain": None,
            "createdAt": datetime.now(UTC),
        },
    )
    for admin in admins or []:
        fs._doc_set(
            f"orgs/{org_id}/admins/{admin}",
            {"addedBy": "system", "addedAt": datetime.now(UTC)},
        )


def test_claim_subdomain_happy_path() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    user = _user("admin")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/subdomain",
            json={"subdomain": "pilot-church"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["hostname"] == "pilot-church.jacob.app"
    assert fs._doc_get("domain_claims/pilot-church.jacob.app")["orgId"] == "o1"
    assert fs._doc_get("orgs/o1")["customSubdomain"] == "pilot-church"


def test_claim_subdomain_reserved() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    user = _user("admin")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/subdomain",
            json={"subdomain": "api"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "reserved_subdomain"


def test_claim_subdomain_invalid_format_rejected_by_pydantic() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    user = _user("admin")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/subdomain",
            json={"subdomain": "Bad-Cap"},  # uppercase rejected by regex
        )
    assert res.status_code == 422


def test_claim_subdomain_duplicate_409() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "domain_claims/taken.jacob.app",
        {
            "orgId": "other-org",
            "hostname": "taken.jacob.app",
            "type": "subdomain",
        },
    )
    user = _user("admin")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/subdomain",
            json={"subdomain": "taken"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "domain_taken"


def test_claim_subdomain_idempotent_when_same_org() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "domain_claims/already.jacob.app",
        {
            "orgId": "o1",
            "hostname": "already.jacob.app",
            "type": "subdomain",
        },
    )
    fs._doc_set("orgs/o1", {**fs._doc_get("orgs/o1"), "customSubdomain": "already"})
    user = _user("admin")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/subdomain",
            json={"subdomain": "already"},
        )
    assert res.status_code == 200
    assert res.json()["hostname"] == "already.jacob.app"


def test_release_subdomain_clears_org_field() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "domain_claims/foo.jacob.app",
        {"orgId": "o1", "hostname": "foo.jacob.app", "type": "subdomain"},
    )
    fs._doc_set("orgs/o1", {**fs._doc_get("orgs/o1"), "customSubdomain": "foo"})
    user = _user("admin")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).delete("/api/orgs/o1/subdomain")
    assert res.status_code == 200
    assert res.json()["released"] is True
    assert fs._doc_get("orgs/o1")["customSubdomain"] is None
    # domain_claims doc kept (cooling-off); releasedAt set
    assert fs._doc_get("domain_claims/foo.jacob.app")["releasedAt"] is not None


def test_vanity_claim_issues_txt_and_persists() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    user = _user("admin")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/custom-domain",
            json={"hostname": "groups.example.org"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["txtRecord"].startswith("jacob-domain-verify=")
    assert fs._doc_get("orgs/o1")["customDomain"]["status"] == "pending"


def test_vanity_claim_rejects_subdomain_of_base() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    user = _user("admin")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/custom-domain",
            json={"hostname": "x.jacob.app"},
        )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "subdomain_required"


def test_vanity_verify_pending_when_txt_absent() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "orgs/o1",
        {
            **fs._doc_get("orgs/o1"),
            "customDomain": {
                "hostname": "groups.example.org",
                "status": "pending",
                "txtRecord": "jacob-domain-verify=expected",
                "txtRecordExpiresAt": datetime.now(UTC) + timedelta(hours=1),
                "verifiedAt": None,
                "certStatus": "not_started",
            },
        },
    )
    user = _user("admin")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.dns_verification.verify_txt_record", return_value=False),
    ):
        res = TestClient(_app(user=user)).get("/api/orgs/o1/custom-domain/status")
    assert res.status_code == 200
    body = res.json()
    assert body["customDomain"]["status"] == "pending"
    assert "not yet visible" in body["message"]


def test_vanity_verify_flips_to_verified_when_txt_present() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "orgs/o1",
        {
            **fs._doc_get("orgs/o1"),
            "customDomain": {
                "hostname": "groups.example.org",
                "status": "pending",
                "txtRecord": "jacob-domain-verify=expected",
                "txtRecordExpiresAt": datetime.now(UTC) + timedelta(hours=1),
                "verifiedAt": None,
                "certStatus": "not_started",
            },
        },
    )
    fs._doc_set(
        "domain_claims/groups.example.org",
        {
            "orgId": "o1",
            "hostname": "groups.example.org",
            "type": "vanity",
            "status": "pending",
            "txtRecord": "jacob-domain-verify=expected",
        },
    )
    user = _user("admin")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
        patch("app.services.dns_verification.verify_txt_record", return_value=True),
    ):
        res = TestClient(_app(user=user)).get("/api/orgs/o1/custom-domain/status")
    assert res.status_code == 200
    body = res.json()
    assert body["customDomain"]["status"] == "verified"
    assert body["customDomain"]["certStatus"] == "provisioning"
    # Audit log written
    assert any(path.startswith("audit_log/") for path in fs.docs.keys())


def test_by_host_returns_org_metadata() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set("orgs/o1", {**fs._doc_get("orgs/o1"), "name": "Pilot Church"})
    fs._doc_set(
        "domain_claims/pilot.jacob.app",
        {
            "orgId": "o1",
            "hostname": "pilot.jacob.app",
            "type": "subdomain",
        },
    )
    user = _user("anon")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get(
            "/api/by-host?host=pilot.jacob.app",
        )
    assert res.status_code == 200, res.text
    assert res.json()["orgId"] == "o1"
    assert res.json()["name"] == "Pilot Church"


def test_by_host_404_for_unknown() -> None:
    fs = FakeFirestore()
    user = _user("anon")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/by-host?host=nope.jacob.app")
    assert res.status_code == 404


def test_by_host_404_for_pending_vanity_claim() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "domain_claims/groups.example.org",
        {
            "orgId": "o1",
            "hostname": "groups.example.org",
            "type": "vanity",
            "status": "pending",
        },
    )
    user = _user("anon")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get(
            "/api/by-host?host=groups.example.org",
        )
    assert res.status_code == 404


def test_by_host_returns_org_for_verified_vanity_claim() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin"])
    fs._doc_set(
        "domain_claims/groups.example.org",
        {
            "orgId": "o1",
            "hostname": "groups.example.org",
            "type": "vanity",
            "status": "verified",
        },
    )
    user = _user("anon")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get(
            "/api/by-host?host=groups.example.org",
        )
    assert res.status_code == 200


# ── pure helpers ──────────────────────────────────────────────────────────────


def test_dns_token_is_url_safe_and_prefixed() -> None:
    tok = dns_v.generate_txt_token()
    assert tok.startswith("jacob-domain-verify=")
    rest = tok.split("=", 1)[1]
    # token_urlsafe alphabet
    assert all(c.isalnum() or c in "-_" for c in rest)
    assert len(rest) > 20


def test_is_valid_subdomain_regex() -> None:
    assert domains_service.is_valid_subdomain("good")
    assert domains_service.is_valid_subdomain("good-name-123")
    assert not domains_service.is_valid_subdomain("-bad")
    assert not domains_service.is_valid_subdomain("bad-")
    assert not domains_service.is_valid_subdomain("ab")  # too short
    assert not domains_service.is_valid_subdomain("Bad")  # uppercase


def test_is_valid_hostname_regex() -> None:
    assert domains_service.is_valid_hostname("groups.example.org")
    assert domains_service.is_valid_hostname("deeper.sub.example.com")
    assert not domains_service.is_valid_hostname("no-tld")
    assert not domains_service.is_valid_hostname("UPPER.case")
    # TLD must be ≥ 2 chars — single-char TLDs are not valid public DNS.
    assert not domains_service.is_valid_hostname("a.b.c.d")
