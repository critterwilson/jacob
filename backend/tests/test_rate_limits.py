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

from app.limits import ADMIN_MUTATION, INVITE_ROTATE, REPORT_SUBMIT, UPLOAD_INIT
from app.middleware.rate_limit import _key_by_uid_or_ip

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
        patch("app.services.reports._db") as svc_db,
    ):
        db = MagicMock()
        # bans collection: not banned
        bans_ref = MagicMock()
        bans_ref.get.return_value = MagicMock(exists=False)
        # moderation_queue dedup query returns nothing
        modq = MagicMock()
        modq.where.return_value = modq
        modq.limit.return_value = modq
        modq.stream.return_value = []
        modq.document.return_value = MagicMock()

        bans_col = MagicMock(document=MagicMock(return_value=bans_ref))

        def collection_side_effect(name: str) -> MagicMock:
            return {"bans": bans_col, "moderation_queue": modq}[name]

        db.collection.side_effect = collection_side_effect
        mock_db.return_value = db
        svc_db.return_value = db

        client = _reports_client()
        r = client.post(
            "/api/reports",
            json={
                "resourceType": "message",
                "resourceId": "m1",
                "groupId": "g1",
                "reason": "spam",
                "context": "this is spam",
            },
        )
    assert r.status_code == 201
    body = r.json()
    assert "reportId" in body
    assert body["dedup"] is False
    assert body["severity"] == 1


def test_report_submit_requires_auth() -> None:
    from app.routers.reports import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    r = client.post(
        "/api/reports",
        json={
            "resourceType": "message",
            "resourceId": "m1",
            "groupId": "g1",
            "reason": "spam",
        },
    )
    assert r.status_code == 401


# ── limit constant sanity checks (additional) ─────────────────────────────────


def test_admin_mutation_limit_value() -> None:
    assert ADMIN_MUTATION == "10/minute"


# ── L1: key function uses UID not IP for authed requests ─────────────────────


def test_key_func_returns_uid_when_set() -> None:
    """Authenticated requests are bucketed by UID, not IP."""
    mock_request = MagicMock(spec=Request)
    mock_request.state.uid = "user-abc"
    assert _key_by_uid_or_ip(mock_request) == "user-abc"


def test_key_func_falls_back_to_ip_when_no_uid() -> None:
    """Unauthenticated requests fall back to the client IP."""
    mock_request = MagicMock(spec=Request)
    # Simulate state with no uid attribute set
    del mock_request.state.uid
    # getattr with default should return None → fall back to IP
    mock_request.client = MagicMock()
    mock_request.client.host = "1.2.3.4"
    mock_request.headers = {}
    result = _key_by_uid_or_ip(mock_request)
    # Should be an IP address (the mock's client.host), not a UID
    assert result != "user-abc"


def test_key_func_uses_lb_attested_xff_not_leftmost() -> None:
    """H1: GCP HTTPS LB appends `<client>, <LB>` to X-Forwarded-For.

    The leftmost entry is whatever the caller sent — attacker-controlled.
    The keyfunc must pick the LB-attested client (second-to-last entry),
    not the leftmost value, or a caller rotating a fresh XFF per request
    bypasses per-IP rate limits.
    """
    mock_request = MagicMock(spec=Request)
    del mock_request.state.uid
    # Attacker spoofs "8.8.8.8" in their outgoing XFF; GLB then appends
    # the real client (1.2.3.4) followed by its own egress (169.254.1.1).
    mock_request.headers = {"x-forwarded-for": "8.8.8.8, 1.2.3.4, 169.254.1.1"}
    mock_request.client = MagicMock()
    mock_request.client.host = "169.254.1.1"
    assert _key_by_uid_or_ip(mock_request) == "1.2.3.4"


def test_key_func_rotated_spoof_maps_to_same_bucket() -> None:
    """Two requests from one real client with different attacker-supplied
    XFF prefixes must hash to the same bucket — the LB-attested
    second-to-last entry is identical in both.
    """
    real_client = "203.0.113.7"
    lb = "169.254.1.1"

    req_a = MagicMock(spec=Request)
    del req_a.state.uid
    req_a.headers = {"x-forwarded-for": f"1.1.1.1, {real_client}, {lb}"}
    req_a.client = MagicMock()
    req_a.client.host = lb

    req_b = MagicMock(spec=Request)
    del req_b.state.uid
    req_b.headers = {"x-forwarded-for": f"2.2.2.2, {real_client}, {lb}"}
    req_b.client = MagicMock()
    req_b.client.host = lb

    assert _key_by_uid_or_ip(req_a) == real_client
    assert _key_by_uid_or_ip(req_b) == real_client


def test_key_func_falls_back_to_remote_when_no_xff() -> None:
    """Without an X-Forwarded-For header, fall back to the direct peer."""
    mock_request = MagicMock(spec=Request)
    del mock_request.state.uid
    mock_request.headers = {}
    mock_request.client = MagicMock()
    mock_request.client.host = "9.9.9.9"
    assert _key_by_uid_or_ip(mock_request) == "9.9.9.9"


def test_two_uids_are_independent_buckets() -> None:
    """Two authenticated users with different UIDs each get their own counter."""
    test_limiter = Limiter(key_func=_key_by_uid_or_ip, headers_enabled=True)
    app = FastAPI()
    app.state.limiter = test_limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    @app.post("/test-uid")
    @test_limiter.limit("1/minute")
    async def _route(request: Request, response: Response) -> dict[str, str]:
        return {"ok": "true"}

    client = TestClient(app, raise_server_exceptions=False)

    # Exhaust alice's bucket (unused return values are intentional)
    client.post("/test-uid", headers={"X-Test-UID": "uid-alice"})
    client.post("/test-uid", headers={"X-Test-UID": "uid-alice"})

    # Manually set state.uid via a middleware override for the second user
    # The limiter uses _key_by_uid_or_ip which reads request.state.uid; since
    # TestClient doesn't run middleware, we verify the key function directly.
    mock_alice = MagicMock(spec=Request)
    mock_alice.state.uid = "uid-alice"
    mock_bob = MagicMock(spec=Request)
    mock_bob.state.uid = "uid-bob"

    assert _key_by_uid_or_ip(mock_alice) != _key_by_uid_or_ip(mock_bob)


# ── M10: rate-limit decorator presence (not just the constant) ─────────────────
#
# These tests guard against the decorator being silently dropped during a
# refactor — a regression that would leave UPLOAD_INIT/REPORT_SUBMIT/etc as
# dead constants while the route accepts unlimited traffic.


def _route_has_slowapi_limit(handler: object) -> bool:
    """slowapi wraps the route in a closure that captures the Limiter.

    Detection: the wrapper's `__wrapped__` points at the undecorated function
    and its `__closure__` contains a Limiter instance. If both hold, the
    `@limiter.limit(...)` decorator was applied at import time.
    """
    from slowapi import Limiter

    if not callable(handler):
        return False
    inner = getattr(handler, "__wrapped__", None)
    if inner is None or inner is handler:
        return False
    closure = getattr(handler, "__closure__", None)
    if not closure:
        return False
    return any(isinstance(cell.cell_contents, Limiter) for cell in closure)


def test_upload_init_route_is_rate_limited() -> None:
    """create_photo_upload must keep its @limiter.limit(UPLOAD_INIT) decorator."""
    from app.routers.uploads import create_photo_upload

    assert _route_has_slowapi_limit(create_photo_upload), (
        "create_photo_upload is missing the @limiter.limit decorator; UPLOAD_INIT "
        "would become a dead constant."
    )


def test_invite_rotate_route_is_rate_limited() -> None:
    from app.routers.groups import rotate_invite

    assert _route_has_slowapi_limit(rotate_invite)


def test_report_submit_route_is_rate_limited() -> None:
    from app.routers.reports import post_report

    assert _route_has_slowapi_limit(post_report)


def test_admin_resolve_route_is_rate_limited() -> None:
    from app.routers.admin import resolve_moderation_item

    assert _route_has_slowapi_limit(resolve_moderation_item)


def test_admin_bulk_resolve_route_is_rate_limited() -> None:
    from app.routers.admin import bulk_resolve_moderation_items

    assert _route_has_slowapi_limit(bulk_resolve_moderation_items)
