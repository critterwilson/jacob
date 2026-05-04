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


@pytest.fixture(autouse=True)
def _default_no_real_firestore():
    fake_db = MagicMock()

    bans_snap = MagicMock()
    bans_snap.exists = False
    bans_doc = MagicMock()
    bans_doc.get.return_value = bans_snap
    bans_col = MagicMock()
    bans_col.document.return_value = bans_doc

    def _coll(name: str) -> MagicMock:
        if name == "bans":
            return bans_col
        # Anything else: a plain MagicMock — tests that need real behaviour
        # patch `app.deps.get_firestore` themselves and override this fixture
        # for the duration of their `with patch(...)` block.
        return MagicMock()

    fake_db.collection.side_effect = _coll

    with patch("app.deps.get_firestore", return_value=fake_db):
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
