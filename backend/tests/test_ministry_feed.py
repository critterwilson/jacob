"""Tests for the central ministry feed router + admin grant/revoke."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.admin import router as admin_router
from app.routers.ministry_feed import router as ministry_router


@pytest.fixture(autouse=True)
def _disable_limits() -> None:
    limiter.enabled = False
    yield
    limiter.enabled = True


def _app(user: CurrentUser | None = None, *, include_admin: bool = False) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(  # type: ignore[arg-type]
        RequestValidationError, validation_exception_handler
    )
    app.state.limiter = limiter
    app.include_router(ministry_router)
    if include_admin:
        app.include_router(admin_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return app


def _post_doc(*, post_id: str = "p1", deleted: bool = False) -> dict[str, Any]:
    return {
        "title": "Sermon",
        "body": "Body text",
        "sermonUrl": None,
        "coverImageRef": None,
        "authorUid": "owner",
        "createdAt": datetime.now(UTC),
        "editedAt": None,
        "deletedAt": datetime.now(UTC) if deleted else None,
        "pinnedAt": None,
        "pinnedBy": None,
        "reactionCounts": {},
    }


def _build_db(
    *,
    post_exists: bool = True,
    post_deleted: bool = False,
    sticker_exists: bool = True,
) -> tuple[MagicMock, MagicMock]:
    db = MagicMock()

    existing_post_snap = MagicMock()
    existing_post_snap.exists = post_exists
    existing_post_snap.id = "p1"
    existing_post_snap.to_dict.return_value = _post_doc(deleted=post_deleted)
    existing_post_ref = MagicMock()
    existing_post_ref.get.return_value = existing_post_snap

    new_post_snap = MagicMock()
    new_post_snap.id = "new-pid"
    new_post_snap.to_dict.return_value = _post_doc(post_id="new-pid")
    new_post_ref = MagicMock()
    new_post_ref.id = "new-pid"
    new_post_ref.get.return_value = new_post_snap

    # Reaction sub-ref chain.
    reaction_user_ref = MagicMock()
    reactions_users = MagicMock()
    reactions_users.document = MagicMock(return_value=reaction_user_ref)
    reactions_slug = MagicMock()
    reactions_slug.collection = MagicMock(return_value=reactions_users)
    reactions_col = MagicMock()
    reactions_col.document = MagicMock(return_value=reactions_slug)
    existing_post_ref.collection = MagicMock(return_value=reactions_col)

    ministry_col = MagicMock()
    # document() with no args → new ref (create); with arg → existing ref.
    ministry_col.document.side_effect = lambda *args: (existing_post_ref if args else new_post_ref)

    sticker_snap = MagicMock()
    sticker_snap.exists = sticker_exists
    sticker_ref = MagicMock()
    sticker_ref.get.return_value = sticker_snap
    stickers_col = MagicMock()
    stickers_col.document = MagicMock(return_value=sticker_ref)

    def _coll(name: str) -> MagicMock:
        if name == "ministry_feed":
            return ministry_col
        if name == "stickers":
            return stickers_col
        return MagicMock()

    db.collection.side_effect = _coll
    return db, existing_post_ref


# ── permissions ──────────────────────────────────────────────────────────


def test_create_post_requires_ministry_owner_claim() -> None:
    """A plain signed-in user gets 403 from `require_ministry_owner`."""
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db()
    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={"title": "Hi", "body": "Hello"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_post_admin_is_not_implicitly_ministry_owner() -> None:
    """An admin without the explicit `ministry_owner` claim still gets 403.

    Locks in ADR 0011 §2 — admin does NOT imply ministry_owner.
    """
    user = CurrentUser(uid="alice", email=None, claims={"admin": True})
    db, _ = _build_db()
    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={"title": "Hi", "body": "Hello"},
        )
    assert res.status_code == 403


def test_ministry_owner_claim_must_be_strict_true() -> None:
    """`ministry_owner: 1` / `"true"` / truthy strings must NOT satisfy the gate."""
    user = CurrentUser(uid="alice", email=None, claims={"ministry_owner": 1})
    db, _ = _build_db()
    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={"title": "Hi", "body": "Hello"},
        )
    assert res.status_code == 403


# ── list / get ───────────────────────────────────────────────────────────


def test_list_posts_orders_pinned_then_recent() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db = MagicMock()
    snaps: list[MagicMock] = []
    for pid, pinned in [("pinned1", True), ("recent1", False)]:
        s = MagicMock()
        s.id = pid
        s.to_dict.return_value = {
            "title": pid,
            "body": "b",
            "authorUid": "owner",
            "createdAt": datetime.now(UTC),
            "pinnedAt": datetime.now(UTC) if pinned else None,
            "deletedAt": None,
        }
        snaps.append(s)

    query = MagicMock()
    query.where = MagicMock(return_value=query)
    query.order_by = MagicMock(return_value=query)
    query.limit = MagicMock(return_value=query)
    query.start_after = MagicMock(return_value=query)
    query.stream.return_value = iter(snaps)
    col = MagicMock()
    col.where = MagicMock(return_value=query)

    def _coll(name: str) -> MagicMock:
        if name == "ministry_feed":
            return col
        return MagicMock()

    db.collection.side_effect = _coll

    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/ministry-feed/posts")
    assert res.status_code == 200
    posts = res.json()["posts"]
    assert [p["postId"] for p in posts] == ["pinned1", "recent1"]


def test_get_post_returns_404_for_deleted_post() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(post_deleted=True)
    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/ministry-feed/posts/p1")
    assert res.status_code == 404


def test_get_post_returns_404_when_missing() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(post_exists=False)
    with patch("app.routers.ministry_feed._db", return_value=db):
        client = TestClient(_app(user))
        res = client.get("/api/ministry-feed/posts/missing")
    assert res.status_code == 404


# ── owner CRUD ───────────────────────────────────────────────────────────


def test_create_post_happy_path() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={"title": "Sunday devotional", "body": "Reflect on Psalm 23."},
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["postId"] == "new-pid"
    assert body["title"] == "Sermon"  # comes back from the mocked fresh snapshot


def test_create_post_rejects_unknown_field() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={"title": "T", "body": "B", "rogue": "no"},
        )
    assert res.status_code == 422


def test_create_post_rejects_invalid_cover_image_ref() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, _ = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post(
            "/api/ministry-feed/posts",
            json={
                "title": "T",
                "body": "B",
                "coverImageRef": "https://evil.example.com/x.png",
            },
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_cover_image_ref"


def test_update_post_only_changes_supplied_fields() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, existing_post_ref = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.patch(
            "/api/ministry-feed/posts/p1",
            json={"body": "Updated body"},
        )
    assert res.status_code == 200, res.text
    args, _ = existing_post_ref.update.call_args
    update_payload = args[0]
    assert "body" in update_payload
    assert "title" not in update_payload  # caller didn't send it


def test_delete_post_is_idempotent() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, existing_post_ref = _build_db(post_deleted=True)
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/ministry-feed/posts/p1")
    assert res.status_code == 204
    # Already-deleted: no second update call.
    existing_post_ref.update.assert_not_called()


def test_pin_post_writes_pinnedAt() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, existing_post_ref = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/ministry-feed/posts/p1/pin")
    assert res.status_code == 200
    args, _ = existing_post_ref.update.call_args
    assert "pinnedAt" in args[0]
    assert args[0]["pinnedBy"] == "owner"


def test_unpin_post_clears_pinnedAt() -> None:
    user = CurrentUser(uid="owner", email=None, claims={"ministry_owner": True})
    db, existing_post_ref = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.delete("/api/ministry-feed/posts/p1/pin")
    assert res.status_code == 200
    args, _ = existing_post_ref.update.call_args
    assert args[0]["pinnedAt"] is None


# ── reactions (any member) ───────────────────────────────────────────────


def test_react_to_post_happy_path() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db()
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/ministry-feed/posts/p1/reactions/pray")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["slug"] == "pray"
    assert body["uid"] == "alice"


def test_react_to_post_404_unknown_sticker() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    db, _ = _build_db(sticker_exists=False)
    with (
        patch("app.routers.ministry_feed._db", return_value=db),
        patch("app.routers.ministry_feed.write_audit_log"),
    ):
        client = TestClient(_app(user))
        res = client.post("/api/ministry-feed/posts/p1/reactions/unknown")
    assert res.status_code == 404


# ── admin grant / revoke ─────────────────────────────────────────────────


def test_grant_ministry_owner_requires_admin() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    client = TestClient(_app(user, include_admin=True))
    res = client.post("/api/admin/users/bob/ministry-owner")
    assert res.status_code == 403


def test_grant_ministry_owner_writes_claim() -> None:
    admin = CurrentUser(uid="root", email=None, claims={"admin": True})

    target = MagicMock()
    target.custom_claims = {"existing": "preserved"}
    set_calls: list[tuple[str, dict[str, Any]]] = []

    with (
        patch("app.routers.admin.firebase_auth.get_user", return_value=target),
        patch(
            "app.routers.admin.firebase_auth.set_custom_user_claims",
            side_effect=lambda uid, claims: set_calls.append((uid, dict(claims))),
        ),
        patch("app.routers.admin.write_audit_log"),
    ):
        client = TestClient(_app(admin, include_admin=True))
        res = client.post("/api/admin/users/bob/ministry-owner")

    assert res.status_code == 200
    assert res.json() == {"uid": "bob", "ministryOwner": True}
    assert set_calls == [("bob", {"existing": "preserved", "ministry_owner": True})]


def test_revoke_ministry_owner_clears_claim_only() -> None:
    """Revoke must NOT touch other claims (e.g. admin)."""
    admin = CurrentUser(uid="root", email=None, claims={"admin": True})

    target = MagicMock()
    target.custom_claims = {"admin": True, "ministry_owner": True}
    set_calls: list[tuple[str, dict[str, Any]]] = []

    with (
        patch("app.routers.admin.firebase_auth.get_user", return_value=target),
        patch(
            "app.routers.admin.firebase_auth.set_custom_user_claims",
            side_effect=lambda uid, claims: set_calls.append((uid, dict(claims))),
        ),
        patch("app.routers.admin.write_audit_log"),
    ):
        client = TestClient(_app(admin, include_admin=True))
        res = client.delete("/api/admin/users/bob/ministry-owner")

    assert res.status_code == 200
    assert set_calls == [("bob", {"admin": True})]


# ── ETag / 304 ──────────────────────────────────────────────────────────


def _ministry_list_db() -> MagicMock:
    """Minimal DB mock for ETag tests on GET /api/ministry-feed/posts."""
    db = MagicMock()
    snap = MagicMock()
    snap.id = "p1"
    snap.to_dict.return_value = {
        "title": "Sermon",
        "body": "Body",
        "authorUid": "owner",
        "createdAt": datetime(2026, 5, 1, tzinfo=UTC),
        "pinnedAt": None,
        "deletedAt": None,
    }
    query = MagicMock()
    query.where = MagicMock(return_value=query)
    query.order_by = MagicMock(return_value=query)
    query.limit = MagicMock(return_value=query)
    query.stream.return_value = iter([snap])
    col = MagicMock()
    col.where = MagicMock(return_value=query)
    db.collection.return_value = col
    return db


def test_list_ministry_posts_etag_header_emitted() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    with patch("app.routers.ministry_feed._db", return_value=_ministry_list_db()):
        res = TestClient(_app(user)).get("/api/ministry-feed/posts")
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')


def test_list_ministry_posts_if_none_match_returns_304() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    client = TestClient(_app(user))
    with patch("app.routers.ministry_feed._db", return_value=_ministry_list_db()):
        first = client.get("/api/ministry-feed/posts")
    assert first.status_code == 200
    etag = first.headers["etag"]
    with patch("app.routers.ministry_feed._db", return_value=_ministry_list_db()):
        second = client.get("/api/ministry-feed/posts", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.headers["etag"] == etag


def test_list_ministry_posts_stale_etag_returns_200() -> None:
    user = CurrentUser(uid="alice", email=None, claims={})
    with patch("app.routers.ministry_feed._db", return_value=_ministry_list_db()):
        res = TestClient(_app(user)).get(
            "/api/ministry-feed/posts",
            headers={"If-None-Match": 'W/"stale-etag"'},
        )
    assert res.status_code == 200
    assert res.headers.get("etag", "").startswith('W/"')
