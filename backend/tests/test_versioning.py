"""Verify that /api/v1/* and /api/* route to the same handlers (T-versioning).

The _V1PathRewriteMiddleware in main.py rewrites /api/v1/<rest> → /api/<rest>
before route matching, so every versioned URL must produce a response that is
identical in status code and body shape to its unversioned counterpart.

We test two endpoints without supplying auth tokens; both the unversioned and
versioned surfaces must return the same 401 shape, confirming that route
matching is identical regardless of which prefix the caller uses.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=True)


def test_v1_groups_matches_unversioned() -> None:
    """GET /api/v1/groups/{gid} → same 401 shape as GET /api/groups/{gid}."""
    r_plain = client.get("/api/groups/test-group-id")
    r_v1 = client.get("/api/v1/groups/test-group-id")

    assert r_plain.status_code == r_v1.status_code == 401
    assert r_plain.json() == r_v1.json()


def test_v1_flags_matches_unversioned() -> None:
    """GET /api/v1/flags → same 401 shape as GET /api/flags."""
    r_plain = client.get("/api/flags")
    r_v1 = client.get("/api/v1/flags")

    assert r_plain.status_code == r_v1.status_code == 401
    assert r_plain.json() == r_v1.json()


def test_unversioned_routes_still_work() -> None:
    """Legacy /api/* paths remain routable after the v1 middleware is wired in."""
    r = client.get("/api/groups/some-id")
    # 401 proves the route was found and the auth dep ran — not a 404.
    assert r.status_code == 401


def test_unknown_v1_path_returns_404() -> None:
    """/api/v1/nonexistent rewrites to /api/nonexistent, which has no handler."""
    r = client.get("/api/v1/nonexistent-endpoint-xyz")
    assert r.status_code == 404
