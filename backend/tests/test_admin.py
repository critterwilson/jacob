"""Tests for the admin router.

firebase_admin and _db are mocked; `get_current_user` / `require_admin` are
overridden via FastAPI dependency injection so no real Firebase calls happen.

Coverage:
- non-admin → 403 on every mutating endpoint
- admin happy path: ban, unban, resolve
- idempotent unban: unbanning a user who has no active ban is a no-op returning 200
- resolve 404 when item not found
- resolve 409 when item already resolved
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.admin import router


def _admin_app(uid: str = "admin-uid", is_admin: bool = True) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    user = CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_admin] = lambda: user
    return app


def _non_admin_app() -> FastAPI:
    """App where require_admin raises 403 (non-admin user)."""
    from fastapi import HTTPException as FHE

    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)

    def _raise_forbidden() -> CurrentUser:
        raise FHE(
            status_code=403,
            detail={
                "error": {
                    "code": "forbidden",
                    "message": "Admin privileges required",
                    "details": {},
                }
            },
        )

    app.dependency_overrides[require_admin] = _raise_forbidden
    return app


def _make_db(
    *,
    ban_exists: bool = False,
    queue_item_exists: bool = True,
    queue_item_status: str = "pending",
) -> MagicMock:
    db = MagicMock()

    # bans collection
    bans_col = MagicMock()
    ban_ref = MagicMock()
    ban_snap = MagicMock()
    ban_snap.exists = ban_exists
    ban_ref.get.return_value = ban_snap
    bans_col.document.return_value = ban_ref

    # moderation_queue collection
    queue_col = MagicMock()
    item_ref = MagicMock()
    item_snap = MagicMock()
    item_snap.exists = queue_item_exists
    item_data = {
        "resourceRef": "uploads/abc",
        "reason": "safesearch_adult",
        "status": queue_item_status,
        "uploaderUid": "uploader-uid",
        "createdAt": None,
    }
    item_snap.to_dict.return_value = item_data
    item_ref.get.return_value = item_snap
    queue_col.document.return_value = item_ref
    queue_col.where.return_value.order_by.return_value.limit.return_value.stream.return_value = (
        iter([])
    )

    # audit_log collection
    audit_col = MagicMock()
    audit_ref = MagicMock()
    audit_col.document.return_value = audit_ref

    # users and groups collections
    users_col = MagicMock()
    groups_col = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "bans":
            return bans_col
        if name == "moderation_queue":
            return queue_col
        if name == "audit_log":
            return audit_col
        if name == "users":
            return users_col
        return groups_col

    db.collection.side_effect = _col
    return db


# ── non-admin → 403 ───────────────────────────────────────────────────────────


def test_ban_non_admin_403() -> None:
    res = TestClient(_non_admin_app()).post(
        "/api/admin/users/uid-x/ban",
        json={"reason": "test", "duration": "24h"},
    )
    assert res.status_code == 403


def test_unban_non_admin_403() -> None:
    res = TestClient(_non_admin_app()).post("/api/admin/users/uid-x/unban")
    assert res.status_code == 403


def test_resolve_non_admin_403() -> None:
    res = TestClient(_non_admin_app()).post(
        "/api/admin/moderation/item-1/resolve",
        json={"resolution": "approve"},
    )
    assert res.status_code == 403


# ── ban happy path ────────────────────────────────────────────────────────────


def test_ban_24h_happy_path() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/users/target-uid/ban",
            json={"reason": "spamming", "duration": "24h"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["uid"] == "target-uid"
    assert data["banned"] is True
    # ban doc should have been set
    mock_db.collection("bans").document("target-uid").set.assert_called_once()


def test_ban_permanent_sets_far_future_expiry() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/users/target-uid/ban",
            json={"reason": "serious violation", "duration": "permanent"},
        )
    assert res.status_code == 200
    call_kwargs = mock_db.collection("bans").document("target-uid").set.call_args[0][0]
    assert call_kwargs["expiresAt"].year == 2099


# ── unban happy path ──────────────────────────────────────────────────────────


def test_unban_banned_user() -> None:
    mock_db = _make_db(ban_exists=True)
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post("/api/admin/users/banned-uid/unban")
    assert res.status_code == 200
    data = res.json()
    assert data["uid"] == "banned-uid"
    assert data["unbanned"] is True
    mock_db.collection("bans").document("banned-uid").delete.assert_called_once()


def test_unban_non_banned_user_is_noop() -> None:
    """Unbanning a user who has no ban record is a no-op — returns 200."""
    mock_db = _make_db(ban_exists=False)
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post("/api/admin/users/not-banned/unban")
    assert res.status_code == 200
    data = res.json()
    assert data["unbanned"] is True
    # delete should NOT have been called since there was no ban
    mock_db.collection("bans").document("not-banned").delete.assert_not_called()


# ── resolve moderation item ───────────────────────────────────────────────────


def test_resolve_approve_happy_path() -> None:
    mock_db = _make_db(queue_item_exists=True, queue_item_status="pending")
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/moderation/item-abc/resolve",
            json={"resolution": "approve"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["itemId"] == "item-abc"
    assert data["status"] == "approved"


def test_resolve_reject_happy_path() -> None:
    mock_db = _make_db(queue_item_exists=True, queue_item_status="pending")
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/moderation/item-abc/resolve",
            json={"resolution": "reject"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "rejected"


def test_resolve_404_when_item_not_found() -> None:
    mock_db = _make_db(queue_item_exists=False)
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/moderation/missing-item/resolve",
            json={"resolution": "approve"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "item_not_found"


def test_resolve_409_when_already_resolved() -> None:
    mock_db = _make_db(queue_item_exists=True, queue_item_status="approved")
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/moderation/item-abc/resolve",
            json={"resolution": "reject"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_resolved"


# ── audit log is written ──────────────────────────────────────────────────────


def test_ban_writes_audit_log() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        TestClient(_admin_app()).post(
            "/api/admin/users/target-uid/ban",
            json={"reason": "test", "duration": "7d"},
        )
    mock_db.collection("audit_log").document.assert_called()
    audit_set_call = mock_db.collection("audit_log").document().set.call_args[0][0]
    assert audit_set_call["action"] == "ban_user"
    assert audit_set_call["actorUid"] == "admin-uid"
    assert audit_set_call["targetRef"] == "users/target-uid"


# ── M3: BanRequest.reason validation ─────────────────────────────────────────


def test_ban_reason_empty_string_returns_422() -> None:
    res = TestClient(_admin_app()).post(
        "/api/admin/users/uid-x/ban",
        json={"reason": "", "duration": "24h"},
    )
    assert res.status_code == 422


def test_ban_reason_over_500_chars_returns_422() -> None:
    res = TestClient(_admin_app()).post(
        "/api/admin/users/uid-x/ban",
        json={"reason": "x" * 501, "duration": "24h"},
    )
    assert res.status_code == 422


def test_ban_reason_exactly_500_chars_is_valid() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.admin._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_admin_app()).post(
            "/api/admin/users/uid-x/ban",
            json={"reason": "x" * 500, "duration": "24h"},
        )
    assert res.status_code == 200


# ── H-BACK-2: prefix-search sentinel ─────────────────────────────────────────


class _PrefixSearchDB:
    """Records every where(...) call so we can pin the prefix range bounds.

    The admin search endpoints build a Firestore prefix query as
    `where(field, ">=", q).where(field, "<=", q + "\\uf8ff")`. A regression
    that drops the U+F8FF sentinel collapses the upper bound to exact
    equality and silently breaks partial-prefix matches.
    """

    def __init__(self, matches: list[dict[str, Any]]) -> None:
        self.where_calls: list[tuple[str, str, Any]] = []
        self._matches = matches

    def collection(self, name: str) -> _PrefixSearchDB:
        return self

    def where(self, field: str, op: str, value: Any) -> _PrefixSearchDB:
        self.where_calls.append((field, op, value))
        return self

    def order_by(self, *_a: Any, **_kw: Any) -> _PrefixSearchDB:
        return self

    def limit(self, _n: int) -> _PrefixSearchDB:
        return self

    def stream(self) -> Any:
        for entry in self._matches:
            snap = MagicMock()
            snap.id = entry["id"]
            snap.exists = True
            snap.to_dict.return_value = {k: v for k, v in entry.items() if k != "id"}
            yield snap

    def document(self, _doc_id: str) -> MagicMock:
        # search_users issues a per-doc bans lookup after the prefix query.
        ban_snap = MagicMock()
        ban_snap.exists = False
        doc = MagicMock()
        doc.get.return_value = ban_snap
        return doc


def test_search_users_partial_prefix_uses_unicode_sentinel() -> None:
    """Pin the U+F8FF sentinel so the prefix range covers `alic*`, not just `alic`."""
    db = _PrefixSearchDB(
        matches=[
            {"id": "u1", "displayName": "alice", "email": "a@x"},
            {"id": "u2", "displayName": "alicia", "email": "b@x"},
        ]
    )
    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_admin_app()).get("/api/admin/users?q=alic")
    assert res.status_code == 200, res.text
    names = sorted(u["displayName"] for u in res.json()["users"])
    assert names == ["alice", "alicia"]
    # Bounds: `>= alic` paired with `<= alic`. If the sentinel is
    # dropped the upper bound collapses to "alic" and "alicia" disappears.
    upper_calls = [c for c in db.where_calls if c[1] == "<="]
    assert ("displayName", "<=", "alic") in upper_calls


def test_search_groups_partial_prefix_uses_unicode_sentinel() -> None:
    db = _PrefixSearchDB(
        matches=[
            {"id": "g1", "name": "men of valor", "memberCount": 4},
            {"id": "g2", "name": "men's bible study", "memberCount": 3},
        ]
    )
    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_admin_app()).get("/api/admin/groups?q=men")
    assert res.status_code == 200, res.text
    assert {g["name"] for g in res.json()["groups"]} == {"men of valor", "men's bible study"}
    upper_calls = [c for c in db.where_calls if c[1] == "<="]
    assert ("name", "<=", "men") in upper_calls
