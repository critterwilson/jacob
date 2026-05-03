"""Tests for the boards router (T32)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.boards import router


def _app(*, admin: bool) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    user = CurrentUser(
        uid="admin-uid" if admin else "alice",
        email="x@example.com",
        claims={"admin": True} if admin else {},
    )
    app.dependency_overrides[get_current_user] = lambda: user
    if admin:
        app.dependency_overrides[require_admin] = lambda: user
    else:

        def _forbidden() -> CurrentUser:
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

        app.dependency_overrides[require_admin] = _forbidden
    return app


def _board_doc(
    *,
    doc_id: str = "b1",
    name: str = "Prayer & Praise",
    slug: str = "prayer-praise",
    description: str = "Cross-group prayer.",
    audience: str = "christian",
    archived: bool = False,
    post_count: int = 0,
) -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = True
    snap.to_dict.return_value = {
        "name": name,
        "slug": slug,
        "description": description,
        "audience": audience,
        "archivedAt": "2026-05-02T12:00:00Z" if archived else None,
        "postCount": post_count,
    }
    return snap


# ── GET /api/boards ─────────────────────────────────────────────────────


def test_list_boards_filters_archived_and_returns_active() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    boards_col.order_by.return_value.limit.return_value.stream.return_value = iter(
        [
            _board_doc(doc_id="b1", slug="prayer-praise"),
            _board_doc(doc_id="b2", slug="archived-one", archived=True),
            _board_doc(doc_id="b3", slug="resources"),
        ]
    )
    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=False)).get("/api/boards")

    assert res.status_code == 200
    payload = res.json()
    slugs = [b["slug"] for b in payload["boards"]]
    assert slugs == ["prayer-praise", "resources"]


# ── POST /api/admin/boards ──────────────────────────────────────────────


def test_admin_create_board_happy_path() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    boards_col.where.return_value.limit.return_value.stream.return_value = iter([])
    new_ref = MagicMock()
    new_ref.id = "new-board-id"
    boards_col.document.return_value = new_ref

    with (
        patch("app.routers.boards._db", return_value=db),
        patch("app.services.audit._db", return_value=MagicMock()),
    ):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards",
            json={
                "name": "Resources",
                "slug": "resources",
                "description": "Studies",
                "audience": "christian",
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert body["boardId"] == "new-board-id"
    assert body["slug"] == "resources"
    new_ref.set.assert_called_once()


def test_admin_create_board_slug_conflict_returns_409() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    boards_col.where.return_value.limit.return_value.stream.return_value = iter(
        [_board_doc(doc_id="existing", slug="resources")]
    )
    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards",
            json={
                "name": "Resources 2",
                "slug": "resources",
                "audience": "general",
            },
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "slug_conflict"


def test_admin_create_board_invalid_slug_returns_422() -> None:
    db = MagicMock()
    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards",
            json={
                "name": "Bad",
                "slug": "Has Spaces",
                "audience": "general",
            },
        )

    assert res.status_code == 422


def test_non_admin_cannot_create_board() -> None:
    res = TestClient(_app(admin=False)).post(
        "/api/admin/boards",
        json={"name": "X", "slug": "x", "audience": "general"},
    )
    assert res.status_code == 403


# ── DELETE /api/admin/boards/{id} ───────────────────────────────────────


def test_admin_archive_board_happy_path() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    snap = _board_doc()
    board_ref = MagicMock()
    board_ref.get.return_value = snap
    boards_col.document.return_value = board_ref

    with (
        patch("app.routers.boards._db", return_value=db),
        patch("app.services.audit._db", return_value=MagicMock()),
    ):
        res = TestClient(_app(admin=True)).delete("/api/admin/boards/b1")

    assert res.status_code == 200
    assert res.json()["boardId"] == "b1"
    board_ref.update.assert_called_once()


def test_admin_archive_already_archived_returns_409() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    snap = _board_doc(archived=True)
    board_ref = MagicMock()
    board_ref.get.return_value = snap
    boards_col.document.return_value = board_ref

    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=True)).delete("/api/admin/boards/b1")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_archived"


def test_admin_archive_missing_returns_404() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    snap = MagicMock()
    snap.exists = False
    board_ref = MagicMock()
    board_ref.get.return_value = snap
    boards_col.document.return_value = board_ref

    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=True)).delete("/api/admin/boards/missing")

    assert res.status_code == 404


# ── POST /api/admin/boards/{id}/posts/{postId}/pin ──────────────────────


def _post_doc(*, deleted: bool = False) -> MagicMock:
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {
        "deletedAt": "2026-05-02T00:00:00Z" if deleted else None,
    }
    return snap


def test_admin_pin_post_happy_path() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    board_ref = MagicMock()
    posts_col = MagicMock()
    post_ref = MagicMock()
    post_ref.get.return_value = _post_doc()
    boards_col.document.return_value = board_ref
    board_ref.collection.return_value = posts_col
    posts_col.document.return_value = post_ref

    with (
        patch("app.routers.boards._db", return_value=db),
        patch("app.services.audit._db", return_value=MagicMock()),
    ):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards/b1/posts/p1/pin",
            json={"pinned": True},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["boardId"] == "b1"
    assert body["postId"] == "p1"
    post_ref.update.assert_called_once()


def test_admin_unpin_clears_pinned_fields() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    board_ref = MagicMock()
    posts_col = MagicMock()
    post_ref = MagicMock()
    post_ref.get.return_value = _post_doc()
    boards_col.document.return_value = board_ref
    board_ref.collection.return_value = posts_col
    posts_col.document.return_value = post_ref

    with (
        patch("app.routers.boards._db", return_value=db),
        patch("app.services.audit._db", return_value=MagicMock()),
    ):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards/b1/posts/p1/pin",
            json={"pinned": False},
        )

    assert res.status_code == 200
    assert res.json()["pinnedAt"] is None
    update_call = post_ref.update.call_args[0][0]
    assert update_call == {"pinnedAt": None, "pinnedBy": None}


def test_admin_pin_deleted_post_returns_409() -> None:
    db = MagicMock()
    boards_col = MagicMock()
    db.collection.return_value = boards_col
    board_ref = MagicMock()
    posts_col = MagicMock()
    post_ref = MagicMock()
    post_ref.get.return_value = _post_doc(deleted=True)
    boards_col.document.return_value = board_ref
    board_ref.collection.return_value = posts_col
    posts_col.document.return_value = post_ref

    with patch("app.routers.boards._db", return_value=db):
        res = TestClient(_app(admin=True)).post(
            "/api/admin/boards/b1/posts/p1/pin",
            json={"pinned": True},
        )

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "post_deleted"


def test_non_admin_cannot_pin_post() -> None:
    res = TestClient(_app(admin=False)).post(
        "/api/admin/boards/b1/posts/p1/pin",
        json={"pinned": True},
    )
    assert res.status_code == 403
