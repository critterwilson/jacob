"""Shared test fixtures.

The `_default_no_real_firestore` autouse fixture patches `app.deps.get_firestore`
so the `require_not_banned` dep can run during tests without ADC. By default the
mock returns "no bans for any uid". Tests that need a specific ban state override
this with their own `patch("app.deps.get_firestore", return_value=...)` inside
the test body — the test's `with patch(...)` wins for its duration.

`banned_db()` is a helper that builds a Firestore-shaped mock returning an active
ban — for 403-banned regression tests on protected write endpoints.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

_ROUTER_DB_MODULES = (
    "app.routers.groups",
    "app.routers.discover",
    "app.routers.invites",
    "app.routers.uploads",
    "app.routers.account",
    "app.routers.reports",
    "app.routers.boards",
)


def _no_bans_col() -> MagicMock:
    bans_snap = MagicMock()
    bans_snap.exists = False
    bans_doc = MagicMock()
    bans_doc.get.return_value = bans_snap
    bans_col = MagicMock()
    bans_col.document.return_value = bans_doc
    return bans_col


def _active_router_db() -> MagicMock | None:
    """Find a currently-mocked router `_db` and call it for its mock_db.

    When a test does `patch("app.routers.groups._db", return_value=test_db)`,
    this returns `test_db` so the deps share state with the handler.
    """
    import importlib

    for mp in _ROUTER_DB_MODULES:
        try:
            mod = importlib.import_module(mp)
        except Exception:  # pragma: no cover — module may not exist
            continue
        db_func = getattr(mod, "_db", None)
        # The router-level helper is a real function; tests replace it with
        # a MagicMock via `patch(..., return_value=test_db)`. Detect that.
        if isinstance(db_func, MagicMock):
            try:
                return db_func()  # type: ignore[no-any-return]
            except Exception:  # pragma: no cover
                return None
    return None


@pytest.fixture(autouse=True)
def _default_no_real_firestore():
    """Default-mock `app.deps.get_firestore` so deps that need Firestore can
    run without ADC. The mock returns "no bans for any uid" by default.

    If a test patches a router-level `_db` (e.g. `app.routers.groups._db`),
    the deps mock delegates non-bans collection reads to that router mock —
    so the handler and the deps share state. This lets existing tests keep
    their `patch("app.routers.X._db", return_value=db)` pattern unchanged.

    Tests that need a *banned* uid override `app.deps.get_firestore`
    themselves; their own `with patch(...)` wins for its duration.
    """
    bans_col = _no_bans_col()

    def _build_fake_db() -> MagicMock:
        fake_db = MagicMock()
        router_db = _active_router_db()

        def _coll(name: str) -> MagicMock:
            if name == "bans":
                return bans_col
            if router_db is not None:
                return router_db.collection(name)
            return MagicMock()

        fake_db.collection.side_effect = _coll
        return fake_db

    with patch("app.deps.get_firestore", side_effect=_build_fake_db):
        yield


def banned_db() -> MagicMock:
    """Mock db with an active (non-expired) ban for any uid that asks.

    Use under `patch("app.deps.get_firestore", return_value=banned_db())` to
    drive a 403 from `require_not_banned` without setting up the rest of
    the handler's data.
    """
    db = MagicMock()
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {"expiresAt": datetime.now(UTC) + timedelta(days=1)}
    bans_doc = MagicMock()
    bans_doc.get.return_value = snap
    bans_col = MagicMock()
    bans_col.document.return_value = bans_doc
    db.collection.side_effect = lambda name: bans_col if name == "bans" else MagicMock()
    return db
