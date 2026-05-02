"""T28 — pagination + idempotency for the reindex script.

The script lives at `infra/scripts/reindex_messages.py`. It's imported
here directly so we exercise the same code that runs in production.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

# Make `infra/scripts/` importable for this test module.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "infra" / "scripts"))

import reindex_messages  # noqa: E402


def _make_snap(snap_id: str, data: dict) -> MagicMock:
    snap = MagicMock()
    snap.id = snap_id
    snap.exists = True
    snap.to_dict.return_value = data
    return snap


def _paginated_query(pages: list[list[MagicMock]]) -> MagicMock:
    """Build a Firestore-like query whose `.stream()` returns each page in
    order, indexed by start_after cursor."""
    query = MagicMock()
    state: dict[str, int] = {"page": 0}

    def stream() -> list[MagicMock]:
        idx = state["page"]
        if idx >= len(pages):
            return []
        return pages[idx]

    query.stream.side_effect = lambda: stream()

    def start_after(_cursor: object) -> MagicMock:
        state["page"] += 1
        return query

    query.start_after.side_effect = start_after
    return query


def test_iter_groups_paginates_until_short_page() -> None:
    """`iter_groups` should keep paginating until it sees a page < PAGE_SIZE_GROUPS."""
    db = MagicMock()
    full_page = [_make_snap(f"g{i}", {}) for i in range(reindex_messages.PAGE_SIZE_GROUPS)]
    short_page = [_make_snap("gN", {})]
    pages = [full_page, short_page]
    query = _paginated_query(pages)
    db.collection.return_value.limit.return_value = query

    gids = list(reindex_messages.iter_groups(db))
    assert len(gids) == reindex_messages.PAGE_SIZE_GROUPS + 1
    assert gids[-1] == "gN"


def test_iter_messages_skips_after_short_page() -> None:
    db = MagicMock()
    page = [_make_snap("m1", {"body": "hi"}), _make_snap("m2", {"body": "ho"})]
    query = _paginated_query([page])
    base_chain = (
        db.collection.return_value.document.return_value.collection.return_value.where.return_value.order_by.return_value.limit.return_value
    )
    base_chain.stream.side_effect = query.stream.side_effect
    base_chain.start_after.side_effect = query.start_after.side_effect

    out = list(reindex_messages.iter_messages(db, "g1"))
    assert [mid for mid, _ in out] == ["m1", "m2"]


def test_reindex_is_idempotent_with_repeated_input() -> None:
    """Re-running with identical input must produce identical upsert payloads."""
    upserts: list[list[dict]] = []
    db = MagicMock()

    # Mock iter_groups to yield two groups.
    # Mock iter_messages to yield two messages each.
    def fake_iter_groups(_db: object) -> list[str]:
        return ["g1", "g2"]

    def fake_iter_messages(_db: object, gid: str) -> list[tuple[str, dict]]:
        if gid == "g1":
            return [("m1", {"authorUid": "alice", "body": "hi"})]
        return [("m2", {"authorUid": "bob", "body": "ho"})]

    def fake_resolve(_db: object, uid: str, _cache: dict) -> str | None:
        return f"display-{uid}"

    def fake_upsert(batch: list[dict]) -> None:
        upserts.append([dict(d) for d in batch])

    orig_iter_groups = reindex_messages.iter_groups
    orig_iter_messages = reindex_messages.iter_messages
    orig_resolve = reindex_messages.resolve_display_name
    try:
        reindex_messages.iter_groups = fake_iter_groups  # type: ignore[assignment]
        reindex_messages.iter_messages = fake_iter_messages  # type: ignore[assignment]
        reindex_messages.resolve_display_name = fake_resolve  # type: ignore[assignment]

        first = reindex_messages.reindex(db, fake_upsert)
        second = reindex_messages.reindex(db, fake_upsert)
    finally:
        reindex_messages.iter_groups = orig_iter_groups  # type: ignore[assignment]
        reindex_messages.iter_messages = orig_iter_messages  # type: ignore[assignment]
        reindex_messages.resolve_display_name = orig_resolve  # type: ignore[assignment]

    assert first == {"upserted": 2, "skippedDeleted": 0}
    assert second == {"upserted": 2, "skippedDeleted": 0}
    # Same upsert payloads on rerun → idempotent.
    assert upserts[0] == upserts[2]
    assert upserts[1] == upserts[3]


def test_reindex_skips_soft_deleted_messages() -> None:
    upserts: list[list[dict]] = []
    db = MagicMock()

    def fake_iter_groups(_db: object) -> list[str]:
        return ["g1"]

    def fake_iter_messages(_db: object, _gid: str) -> list[tuple[str, dict]]:
        return [
            ("m1", {"authorUid": "alice", "body": "live"}),
            (
                "m2",
                {
                    "authorUid": "bob",
                    "body": "dead",
                    "deletedAt": object(),
                },
            ),
        ]

    def fake_resolve(_db: object, _uid: str, _cache: dict) -> str | None:
        return None

    orig_iter_groups = reindex_messages.iter_groups
    orig_iter_messages = reindex_messages.iter_messages
    orig_resolve = reindex_messages.resolve_display_name
    try:
        reindex_messages.iter_groups = fake_iter_groups  # type: ignore[assignment]
        reindex_messages.iter_messages = fake_iter_messages  # type: ignore[assignment]
        reindex_messages.resolve_display_name = fake_resolve  # type: ignore[assignment]

        counts = reindex_messages.reindex(db, lambda batch: upserts.append(list(batch)))
    finally:
        reindex_messages.iter_groups = orig_iter_groups  # type: ignore[assignment]
        reindex_messages.iter_messages = orig_iter_messages  # type: ignore[assignment]
        reindex_messages.resolve_display_name = orig_resolve  # type: ignore[assignment]

    assert counts == {"upserted": 1, "skippedDeleted": 1}
    flat = [doc for batch in upserts for doc in batch]
    assert [doc["id"] for doc in flat] == ["m1"]
