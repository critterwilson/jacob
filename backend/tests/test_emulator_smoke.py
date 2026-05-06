"""Backend tests that boot the Firebase Admin SDK against a running
Firestore emulator (H8).

These tests are gated by `@pytest.mark.emulator`. The default `pytest`
invocation (`addopts = -m 'not emulator'` in `pyproject.toml`) skips
them. The CI emulator job runs them explicitly via:

    firebase emulators:exec --only firestore --project demo-jacob \\
      "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \\
       GOOGLE_CLOUD_PROJECT=demo-jacob \\
       pytest backend/tests/test_emulator_smoke.py -m emulator -v"

Why these matter: mock-based unit tests catch logic regressions but
don't catch query shape mismatches against the real Firestore
semantics (transaction concurrency, range filter ordering quirks,
collection-group query auth, etc). One real-emulator query per
high-risk router gives a cheap canary that a regression there gets
caught at PR time, not at the next production deploy.

Start small: this file pins the group-health rollup query (which uses
the (groupId, createdAt) composite index added in PR B) and the
discover groups query (used by /api/discover/groups). Add more as
pain reveals which queries are most worth pinning.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.emulator


def _ensure_emulator_env() -> None:
    if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        pytest.skip("FIRESTORE_EMULATOR_HOST not set — emulator tests need it")


@pytest.fixture(scope="module")
def db():  # type: ignore[no-untyped-def]
    """Connect to the Firestore emulator via the lower-level
    `google.cloud.firestore.Client`. The Admin SDK
    (`firebase_admin.firestore`) tries to load Application Default
    Credentials even when targeting the emulator; the lower-level
    client respects `FIRESTORE_EMULATOR_HOST` and accepts anonymous
    auth in that mode.
    """
    _ensure_emulator_env()
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "demo-jacob")
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import firestore as gcf_module

    return gcf_module.Client(
        project="demo-jacob",
        credentials=AnonymousCredentials(),
    )


@pytest.fixture(autouse=True)
def _cleanup(db) -> None:  # type: ignore[no-untyped-def]
    """Wipe the test collections before every test so cases are isolated."""
    for col in ("moderation_queue", "groups"):
        for snap in db.collection(col).stream():
            snap.reference.delete()
    yield


def test_group_health_query_returns_per_day_severity(db) -> None:  # type: ignore[no-untyped-def]
    """Pins the group_health.severity_by_day query against the real emulator.

    Confirms the (groupId ASC, createdAt ASC) composite index — added in
    PR B — actually serves the query without a FAILED_PRECONDITION. The
    emulator does not enforce missing indexes the way production does,
    so this is a smoke check on the query shape itself, not on index
    existence — but if the query *shape* changes (e.g. someone adds a
    third filter), the test breaks immediately rather than at deploy.
    """
    from app.services import group_health

    gid = f"emu-test-{uuid.uuid4().hex[:8]}"
    now = datetime.now(UTC)
    db.collection("moderation_queue").document(f"{gid}-r1").set(
        {"groupId": gid, "createdAt": now - timedelta(days=1), "severity": 5}
    )
    db.collection("moderation_queue").document(f"{gid}-r2").set(
        {"groupId": gid, "createdAt": now - timedelta(days=1), "severity": 3}
    )
    db.collection("moderation_queue").document(f"{gid}-r3").set(
        {"groupId": gid, "createdAt": now, "severity": 1}
    )

    rows = group_health.severity_by_day(db, gid=gid, days=7, now=now)
    by_day = {r["day"]: r for r in rows}

    yesterday = (now - timedelta(days=1)).date().isoformat()
    today = now.date().isoformat()
    assert yesterday in by_day
    assert by_day[yesterday]["count"] == 2
    assert by_day[yesterday]["avgSeverity"] == 4.0
    assert by_day[today]["count"] == 1
    assert by_day[today]["avgSeverity"] == 1.0


def test_discover_groups_query_orders_by_member_count_desc(db) -> None:  # type: ignore[no-untyped-def]
    """Pins the discover query: where(isPrivate=false).where(archivedAt=null)
    .order_by(memberCount DESC).order_by(createdAt DESC). Uses the
    (isPrivate, archivedAt, memberCount, createdAt) composite index that
    already exists in firestore.indexes.json."""
    from google.cloud import firestore as gcf

    base = datetime.now(UTC)
    docs = [
        ("emu-g1", {"isPrivate": False, "archivedAt": None, "memberCount": 50, "createdAt": base}),
        ("emu-g2", {"isPrivate": False, "archivedAt": None, "memberCount": 10, "createdAt": base}),
        # Filtered out: private
        ("emu-g3", {"isPrivate": True, "archivedAt": None, "memberCount": 100, "createdAt": base}),
        # Filtered out: archived
        ("emu-g4", {"isPrivate": False, "archivedAt": base, "memberCount": 100, "createdAt": base}),
    ]
    for gid, data in docs:
        db.collection("groups").document(gid).set(data)

    snaps = list(
        db.collection("groups")
        .where("isPrivate", "==", False)
        .where("archivedAt", "==", None)
        .order_by("memberCount", direction=gcf.Query.DESCENDING)
        .order_by("createdAt", direction=gcf.Query.DESCENDING)
        .limit(10)
        .stream()
    )
    ids = [s.id for s in snaps]
    assert "emu-g1" in ids
    assert "emu-g2" in ids
    assert "emu-g3" not in ids  # filtered: private
    assert "emu-g4" not in ids  # filtered: archived
    # Order: highest memberCount first.
    assert ids.index("emu-g1") < ids.index("emu-g2")
