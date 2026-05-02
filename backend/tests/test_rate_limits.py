"""Rate limit tests for T17.

Each test creates an isolated FastAPI app with a fresh Limiter instance so
there is no cross-test state bleed from the shared in-memory counter.

We use a "1/minute" limit in each fixture so we can trigger a 429 with just
two requests instead of N+1 for the production limit. The production limit
strings are verified separately via constant assertions.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.limits import INVITE_ROTATE, REPORT_SUBMIT, UPLOAD_INIT

# ── limit constant sanity checks ─────────────────────────────────────────────


def test_upload_init_limit_value() -> None:
    assert UPLOAD_INIT == "10/hour"


def test_invite_rotate_limit_value() -> None:
    assert INVITE_ROTATE == "20/day"


def test_report_submit_limit_value() -> None:
    assert REPORT_SUBMIT == "10/day"


# ── helpers ───────────────────────────────────────────────────────────────────


def _isolated_app(limit_str: str = "1/minute") -> tuple[FastAPI, TestClient]:
    """Return a fresh (app, client) pair with an isolated in-memory limiter."""
    test_limiter = Limiter(key_func=get_remote_address, headers_enabled=True)
    app = FastAPI()
    app.state.limiter = test_limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    @app.post("/test")
    @test_limiter.limit(limit_str)
    async def _route(request: Request, response: Response) -> dict[str, str]:
        return {"ok": "true"}

    return app, TestClient(app, raise_server_exceptions=False)


# ── mechanism tests ───────────────────────────────────────────────────────────


def test_rate_limit_allows_first_request() -> None:
    _, client = _isolated_app("1/minute")
    r = client.post("/test")
    assert r.status_code == 200


def test_rate_limit_returns_429_on_second_request() -> None:
    _, client = _isolated_app("1/minute")
    client.post("/test")
    r = client.post("/test")
    assert r.status_code == 429


def test_rate_limit_retry_after_header_present() -> None:
    _, client = _isolated_app("1/minute")
    client.post("/test")
    r = client.post("/test")
    assert "retry-after" in {h.lower() for h in r.headers}


# ── upload init surface ───────────────────────────────────────────────────────


def _upload_client() -> TestClient:
    from app.deps import get_current_user
    from app.middleware.rate_limit import limiter
    from app.models.user import CurrentUser
    from app.routers.uploads import router

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    # Use a unique test UID so this test never collides with other tests
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid="rate_test_upload_uid", email="u@test.com", claims={}
    )
    return TestClient(app, raise_server_exceptions=False)


def test_upload_init_succeeds_within_limit() -> None:
    with (
        patch("app.routers.uploads.init_firebase_admin"),
        patch("app.routers.uploads._db") as mock_db,
        patch("app.services.storage.generate_signed_put_url") as mock_url,
    ):
        from datetime import datetime

        mock_url.return_value = ("https://example.com/upload", datetime(2099, 1, 1))
        db = MagicMock()
        db.collection.return_value.document.return_value.set.return_value = None
        mock_db.return_value = db

        client = _upload_client()
        r = client.post(
            "/api/uploads/photos",
            json={"purpose": "avatar", "mimeType": "image/jpeg", "byteCount": 1024},
        )
    assert r.status_code in (200, 201)


# ── invite rotation surface ───────────────────────────────────────────────────


def _invite_client() -> TestClient:
    from app.deps import get_current_user
    from app.middleware.rate_limit import limiter
    from app.models.user import CurrentUser
    from app.routers.groups import router

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid="rate_test_invite_uid", email="i@test.com", claims={}
    )
    return TestClient(app, raise_server_exceptions=False)


def test_invite_rotate_succeeds_for_leader() -> None:
    with (
        patch("app.routers.groups.init_firebase_admin"),
        patch("app.routers.groups._db") as mock_db,
    ):
        group_snap = MagicMock()
        group_snap.exists = True
        member_snap = MagicMock()
        member_snap.exists = True
        member_snap.get.return_value = "leader"

        group_ref = MagicMock()
        group_ref.get.return_value = group_snap
        members_col = MagicMock()
        members_col.document.return_value.get.return_value = member_snap
        group_ref.collection.return_value = members_col

        code_query = MagicMock()
        code_query.limit.return_value.stream.return_value = []

        def _col(name: str) -> MagicMock:
            col = MagicMock()
            if name == "groups":
                col.document.return_value = group_ref
                col.where.return_value = code_query
            return col

        db = MagicMock()
        db.collection.side_effect = _col
        mock_db.return_value = db

        client = _invite_client()
        r = client.post("/api/groups/test-gid/invite/rotate")
    assert r.status_code == 200


# ── reports surface ───────────────────────────────────────────────────────────


def _reports_client() -> TestClient:
    from app.deps import get_current_user
    from app.middleware.rate_limit import limiter
    from app.models.user import CurrentUser
    from app.routers.reports import router

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid="rate_test_report_uid", email="r@test.com", claims={}
    )
    return TestClient(app, raise_server_exceptions=False)


def test_report_submit_creates_moderation_item() -> None:
    with (
        patch("app.routers.reports.init_firebase_admin"),
        patch("app.routers.reports._db") as mock_db,
    ):
        db = MagicMock()
        mock_db.return_value = db

        client = _reports_client()
        r = client.post(
            "/api/reports",
            json={"resourceRef": "groups/g1/messages/m1", "reason": "Spam content"},
        )
    assert r.status_code == 201
    assert "reportId" in r.json()


def test_report_submit_requires_auth() -> None:
    from app.routers.reports import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    r = client.post(
        "/api/reports",
        json={"resourceRef": "groups/g1/messages/m1", "reason": "Test"},
    )
    assert r.status_code == 401
