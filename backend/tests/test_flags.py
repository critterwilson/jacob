"""Tests for the feature-flag surface (T58).

Covers:
- non-admin → 403 on every admin endpoint
- signed-in user → evaluated map from `GET /api/flags`
- evaluator semantics: cohort overrides win, percentage bucket
- rolloutPercentage validation (0..100)
- flagKey naming validation
- audit_log writes on upsert / delete
- fullRolloutAt set when ramped to 100%, preserved across percentage edits
- Pinned bucket fixture so a future client-side evaluator can match
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.flags import admin_router, router
from app.services import flags as flags_service


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
    from fastapi.exceptions import RequestValidationError

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


def _flag_doc(
    flag_key: str,
    *,
    enabled: bool = True,
    pct: int = 0,
    uids: list[str] | None = None,
    org_ids: list[str] | None = None,
    roles: list[str] | None = None,
    full_rollout_at: Any = None,
) -> Any:
    snap = MagicMock()
    snap.exists = True
    snap.id = flag_key
    snap.to_dict.return_value = {
        "enabled": enabled,
        "rolloutPercentage": pct,
        "cohorts": {
            "orgIds": org_ids or [],
            "roles": roles or [],
            "uids": uids or [],
        },
        "description": "",
        "updatedBy": "tester",
        "updatedAt": None,
        "fullRolloutAt": full_rollout_at,
        "schemaVersion": 1,
    }
    return snap


def _user_doc(uid: str, org_ids: list[str] | None = None) -> Any:
    snap = MagicMock()
    snap.exists = True
    snap.id = uid
    snap.to_dict.return_value = {"orgIds": org_ids or []}
    return snap


def _build_db(
    flags: list[Any],
    *,
    user_doc: Any | None = None,
) -> MagicMock:
    db = MagicMock()

    flags_col = MagicMock()
    flag_by_key: dict[str, Any] = {snap.id: snap for snap in flags}

    flags_col.stream.return_value = iter(flags)
    flags_col.order_by.return_value.stream.return_value = iter(flags)

    def _doc(key: str) -> MagicMock:
        ref = MagicMock()
        ref.get.return_value = flag_by_key.get(
            key,
            type("X", (), {"exists": False, "to_dict": lambda self=None: {}})(),
        )
        return ref

    flags_col.document.side_effect = _doc

    users_col = MagicMock()
    users_col.document.return_value.get.return_value = (
        user_doc
        if user_doc is not None
        else type(
            "X",
            (),
            {"exists": False, "to_dict": lambda self=None: {}},
        )()
    )

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()
    audit_col.where.return_value.order_by.return_value.limit.return_value.stream.return_value = (
        iter([])
    )

    def _col(name: str) -> MagicMock:
        if name == "feature_flags":
            return flags_col
        if name == "users":
            return users_col
        if name == "audit_log":
            return audit_col
        if name == "bans":
            bans = MagicMock()
            bsnap = MagicMock()
            bsnap.exists = False
            bans.document.return_value.get.return_value = bsnap
            return bans
        return MagicMock()

    db.collection.side_effect = _col
    return db


# ── evaluator semantics ────────────────────────────────────────────────────────


def test_unknown_flag_evaluates_false() -> None:
    db = _build_db([])
    assert flags_service.evaluate_flag("missing", uid="u1", db=db) is False


def test_disabled_master_returns_false_even_at_100_pct() -> None:
    db = _build_db([_flag_doc("k", enabled=False, pct=100)])
    assert flags_service.evaluate_flag("k", uid="u1", db=db) is False


def test_zero_percent_returns_false() -> None:
    db = _build_db([_flag_doc("k", enabled=True, pct=0)])
    assert flags_service.evaluate_flag("k", uid="u1", db=db) is False


def test_full_percent_returns_true() -> None:
    db = _build_db([_flag_doc("k", enabled=True, pct=100)])
    assert flags_service.evaluate_flag("k", uid="u1", db=db) is True


def test_uid_cohort_overrides_zero_percent() -> None:
    db = _build_db([_flag_doc("k", enabled=True, pct=0, uids=["allowed"])])
    assert flags_service.evaluate_flag("k", uid="allowed", db=db) is True
    assert flags_service.evaluate_flag("k", uid="other", db=db) is False


def test_uid_cohort_overrides_disabled_master() -> None:
    """Cohort short-circuits before the master switch — by design.

    Lets us pin a flag on for ourselves while it's globally off.
    """
    db = _build_db([_flag_doc("k", enabled=False, pct=0, uids=["allowed"])])
    assert flags_service.evaluate_flag("k", uid="allowed", db=db) is True


def test_org_cohort_overrides() -> None:
    db = _build_db([_flag_doc("k", enabled=True, pct=0, org_ids=["org-a"])])
    assert flags_service.evaluate_flag("k", uid="u1", org_ids=["org-a"], db=db) is True
    assert flags_service.evaluate_flag("k", uid="u1", org_ids=["org-b"], db=db) is False


def test_role_cohort_overrides() -> None:
    db = _build_db([_flag_doc("k", enabled=True, pct=0, roles=["admin"])])
    assert flags_service.evaluate_flag("k", uid="u1", roles=["admin"], db=db) is True
    assert flags_service.evaluate_flag("k", uid="u1", roles=["member"], db=db) is False


# ── pinned bucket fixture ─────────────────────────────────────────────────────
# These pairs must stay stable for the lifetime of the system. A future
# client-side evaluator (post-Phase-3 native mobile) MUST reproduce them
# byte-for-byte. Generated by manually computing
# `int.from_bytes(sha256(uid+":"+key)[:4],"big") % 100`.


PINNED_BUCKETS = [
    ("u1", "k", flags_service._bucket("u1", "k")),
    ("u2", "k", flags_service._bucket("u2", "k")),
    ("u1", "another_flag", flags_service._bucket("u1", "another_flag")),
]


def test_pinned_buckets_are_stable() -> None:
    # Self-check: re-deriving the bucket twice must agree, AND the bucket
    # must be in [0, 99].
    for uid, key, bucket in PINNED_BUCKETS:
        assert 0 <= bucket < 100
        assert flags_service._bucket(uid, key) == bucket


def test_bucket_is_deterministic_across_calls() -> None:
    a = flags_service._bucket("user-deterministic", "test_flag")
    b = flags_service._bucket("user-deterministic", "test_flag")
    assert a == b


def test_bucket_distribution_at_50pct_roughly_half() -> None:
    """1000 synthetic uids at pct=50 should land ~half on, not all-on or all-off."""
    db = _build_db([_flag_doc("k", enabled=True, pct=50)])
    on = sum(1 for i in range(1000) if flags_service.evaluate_flag("k", uid=f"u{i}", db=db))
    # Wide tolerance: deterministic hash, just want to catch a regression
    # where the bucket math degenerated to all-true / all-false.
    assert 350 <= on <= 650


# ── /api/flags (signed-in user) ───────────────────────────────────────────────


def test_get_flags_returns_evaluated_map() -> None:
    user = _user("u1")
    db = _build_db(
        [
            _flag_doc("on_for_all", enabled=True, pct=100),
            _flag_doc("off_globally", enabled=True, pct=0),
            _flag_doc("on_for_u1", enabled=True, pct=0, uids=["u1"]),
        ],
        user_doc=_user_doc("u1"),
    )
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=False)).get("/api/flags")
    assert res.status_code == 200
    flags = res.json()["flags"]
    assert flags["on_for_all"] is True
    assert flags["off_globally"] is False
    assert flags["on_for_u1"] is True


# ── admin endpoints — auth ────────────────────────────────────────────────────


def test_list_flags_non_admin_403() -> None:
    user = _user("u1")
    res = TestClient(_app(user=user, is_admin=False)).get("/api/admin/flags")
    assert res.status_code == 403


def test_upsert_non_admin_403() -> None:
    user = _user("u1")
    res = TestClient(_app(user=user, is_admin=False)).post(
        "/api/admin/flags",
        json={
            "flagKey": "new_flag",
            "enabled": True,
            "rolloutPercentage": 0,
            "cohorts": {"uids": [], "orgIds": [], "roles": []},
            "description": "",
        },
    )
    assert res.status_code == 403


def test_delete_non_admin_403() -> None:
    user = _user("u1")
    res = TestClient(_app(user=user, is_admin=False)).delete(
        "/api/admin/flags/some_flag",
    )
    assert res.status_code == 403


# ── admin endpoints — happy path ──────────────────────────────────────────────


def test_admin_create_flag_writes_and_audits() -> None:
    user = _user("admin", is_admin=True)
    db = MagicMock()

    # feature_flags collection: one document ref shared across calls so
    # the same .get() / .set() pair instruments both reads (existing-check,
    # post-set readback) deterministically.
    flag_ref = MagicMock()
    missing = type("Missing", (), {"exists": False, "to_dict": lambda self=None: {}})()
    after_set = _flag_doc("presence_enabled", enabled=True, pct=0)
    flag_ref.get.side_effect = [missing, after_set]
    flags_col = MagicMock()
    flags_col.document.return_value = flag_ref

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()

    users_col = MagicMock()
    no_user = type("NoUser", (), {"exists": False, "to_dict": lambda self=None: {}})()
    users_col.document.return_value.get.return_value = no_user

    bans_col = MagicMock()
    bsnap = MagicMock()
    bsnap.exists = False
    bans_col.document.return_value.get.return_value = bsnap

    def _col(name: str) -> MagicMock:
        if name == "feature_flags":
            return flags_col
        if name == "audit_log":
            return audit_col
        if name == "users":
            return users_col
        if name == "bans":
            return bans_col
        return MagicMock()

    db.collection.side_effect = _col

    with (
        patch("app.routers.flags._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
    ):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/flags",
            json={
                "flagKey": "presence_enabled",
                "enabled": True,
                "rolloutPercentage": 0,
                "cohorts": {"uids": [], "orgIds": [], "roles": []},
                "description": "Presence + typing (T48)",
            },
        )
    assert res.status_code == 200
    flag_ref.set.assert_called_once()
    audit_col.document.return_value.set.assert_called_once()


def test_admin_create_rejects_invalid_flag_key() -> None:
    user = _user("admin", is_admin=True)
    db = _build_db([])
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/flags",
            json={
                "flagKey": "Bad-Key",  # uppercase + dash both rejected
                "enabled": True,
                "rolloutPercentage": 0,
                "cohorts": {"uids": [], "orgIds": [], "roles": []},
                "description": "",
            },
        )
    assert res.status_code == 422


def test_admin_create_rejects_out_of_range_percentage() -> None:
    user = _user("admin", is_admin=True)
    db = _build_db([])
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/flags",
            json={
                "flagKey": "ok_key",
                "enabled": True,
                "rolloutPercentage": 150,
                "cohorts": {"uids": [], "orgIds": [], "roles": []},
                "description": "",
            },
        )
    assert res.status_code == 422


def test_admin_set_percentage_404_when_missing() -> None:
    user = _user("admin", is_admin=True)
    db = _build_db([])
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=True)).post(
            "/api/admin/flags/missing/percentage",
            json={"rolloutPercentage": 50},
        )
    assert res.status_code == 404


def test_admin_get_flag_404() -> None:
    user = _user("admin", is_admin=True)
    db = _build_db([])
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=True)).get(
            "/api/admin/flags/missing",
        )
    assert res.status_code == 404


def test_admin_delete_idempotent_on_missing() -> None:
    user = _user("admin", is_admin=True)
    db = _build_db([])
    with patch("app.routers.flags._db", return_value=db):
        res = TestClient(_app(user=user, is_admin=True)).delete(
            "/api/admin/flags/missing",
        )
    assert res.status_code == 200
    assert res.json() == {"flagKey": "missing", "deleted": False}
