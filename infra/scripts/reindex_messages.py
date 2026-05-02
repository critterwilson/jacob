"""T28 — full reindex of every non-deleted message into Typesense.

Run this once per environment after deploying the Typesense sidecar
and the index trigger. It is idempotent — re-running converges to the
same state because it uses Typesense's `upsert` action, keyed by
message id.

Usage (Cloud Run Job, or local):

    GCP_PROJECT_ID=jacob-prod \\
    TYPESENSE_HOST=https://typesense-internal.run.app \\
    TYPESENSE_ADMIN_KEY=... \\
    TYPESENSE_COLLECTION=messages \\
    python infra/scripts/reindex_messages.py

The script paginates groups (1000 per page) and messages (500 per
page) so it converges in bounded memory. Progress is written to stdout
in a "[reindex] gid=... batch=... upserted=N" format that's easy for
an operator to grep.

Limits / caveats:
  - Soft-deleted (`deletedAt != null`) messages are skipped.
  - The script reads `users/{authorUid}.displayName` once and caches
    it for the duration of the run (limit 5000 entries).
  - The script does NOT clean up Typesense docs that no longer exist
    in Firestore. The trigger handles deletes; if you suspect
    divergence (e.g. Typesense restored from an older snapshot), drop
    the collection and rerun.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Iterable, Iterator
from typing import Any

logger = logging.getLogger("reindex_messages")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


PAGE_SIZE_GROUPS = 1000
PAGE_SIZE_MESSAGES = 500
DISPLAY_NAME_CACHE_LIMIT = 5000


def _normalise_message(
    mid: str, gid: str, data: dict[str, Any], display_name: str | None
) -> dict[str, Any]:
    created_at = data.get("createdAt")
    created_unix = 0
    if created_at is not None:
        try:
            created_unix = int(created_at.timestamp())
        except (AttributeError, TypeError):
            try:
                created_unix = int(int(created_at) / 1000)
            except (TypeError, ValueError):
                created_unix = 0

    sticker_ids = data.get("stickerIds") or []
    moderation_state: str | None = None
    moderation = data.get("moderation")
    if isinstance(moderation, dict):
        raw_state = moderation.get("state")
        moderation_state = str(raw_state) if raw_state is not None else None

    return {
        "id": mid,
        "groupId": gid,
        "authorUid": str(data.get("authorUid") or ""),
        "authorDisplayName": display_name,
        "body": str(data.get("body") or ""),
        "stickerIds": list(sticker_ids) if sticker_ids else None,
        "createdAtUnix": created_unix,
        "parentMessageId": data.get("parentMessageId"),
        "moderationState": moderation_state,
    }


def iter_groups(db: Any) -> Iterator[str]:
    """Yield every group's id."""
    query = db.collection("groups").limit(PAGE_SIZE_GROUPS)
    last: Any = None
    while True:
        page = query.start_after(last) if last is not None else query
        snaps = list(page.stream())
        if not snaps:
            return
        for snap in snaps:
            yield snap.id
        if len(snaps) < PAGE_SIZE_GROUPS:
            return
        last = snaps[-1]


def iter_messages(db: Any, gid: str) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (mid, data) for every non-deleted message in a group."""
    base = (
        db.collection("groups")
        .document(gid)
        .collection("messages")
        .where("deletedAt", "==", None)
        .order_by("createdAt")
        .limit(PAGE_SIZE_MESSAGES)
    )
    last: Any = None
    while True:
        page = base.start_after(last) if last is not None else base
        snaps = list(page.stream())
        if not snaps:
            return
        for snap in snaps:
            data = snap.to_dict() or {}
            yield snap.id, data
        if len(snaps) < PAGE_SIZE_MESSAGES:
            return
        last = snaps[-1]


def resolve_display_name(
    db: Any, uid: str, cache: dict[str, str | None]
) -> str | None:
    if uid in cache:
        return cache[uid]
    if len(cache) >= DISPLAY_NAME_CACHE_LIMIT:
        # Cap memory; new lookups will hit Firestore but won't grow further.
        return None
    snap = db.collection("users").document(uid).get()
    name = None
    if snap.exists:
        raw = (snap.to_dict() or {}).get("displayName")
        name = str(raw) if raw is not None else None
    cache[uid] = name
    return name


def reindex(
    db: Any,
    upsert_batch: callable,  # type: ignore[type-arg]
    *,
    sleep_between_batches: float = 0.0,
) -> dict[str, int]:
    """Drive the reindex; returns counts per category.

    `upsert_batch(docs: list[dict])` is the I/O seam — pass a lambda
    that talks to Typesense, or a fake for tests.
    """
    cache: dict[str, str | None] = {}
    upserted = 0
    skipped_deleted = 0

    for gid in iter_groups(db):
        batch: list[dict[str, Any]] = []
        for mid, data in iter_messages(db, gid):
            if data.get("deletedAt") is not None:
                skipped_deleted += 1
                continue
            display_name = resolve_display_name(db, str(data.get("authorUid") or ""), cache)
            batch.append(_normalise_message(mid, gid, data, display_name))
            if len(batch) >= 100:
                upsert_batch(batch)
                upserted += len(batch)
                logger.info("[reindex] gid=%s batch_flushed=%d total=%d", gid, len(batch), upserted)
                batch = []
                if sleep_between_batches > 0:
                    time.sleep(sleep_between_batches)
        if batch:
            upsert_batch(batch)
            upserted += len(batch)
            logger.info("[reindex] gid=%s batch_flushed=%d total=%d", gid, len(batch), upserted)
    return {"upserted": upserted, "skippedDeleted": skipped_deleted}


def _make_typesense_upserter(
    host: str, admin_key: str, collection: str
) -> Any:
    """Return a callable(list[dict]) that posts each doc to Typesense.

    Typesense doesn't have a native batched-upsert REST endpoint for
    arbitrary actions, so we use the import endpoint with `action=upsert`
    and JSONL bodies (one document per line).
    """
    import httpx
    import json

    url = f"{host.rstrip('/')}/collections/{collection}/documents/import?action=upsert"
    headers = {"X-TYPESENSE-API-KEY": admin_key, "Content-Type": "application/jsonl"}

    def _upsert(docs: Iterable[dict[str, Any]]) -> None:
        body = "\n".join(json.dumps(d) for d in docs)
        with httpx.Client(timeout=30.0) as client:
            res = client.post(url, content=body, headers=headers)
        if res.status_code >= 400:
            raise RuntimeError(
                f"Typesense import failed status={res.status_code} body={res.text[:500]}"
            )

    return _upsert


def main() -> int:
    project = os.environ.get("GCP_PROJECT_ID")
    host = os.environ.get("TYPESENSE_HOST")
    admin_key = os.environ.get("TYPESENSE_ADMIN_KEY")
    collection = os.environ.get("TYPESENSE_COLLECTION", "messages")

    missing = [
        name
        for name, value in (
            ("GCP_PROJECT_ID", project),
            ("TYPESENSE_HOST", host),
            ("TYPESENSE_ADMIN_KEY", admin_key),
        )
        if not value
    ]
    if missing:
        logger.error("missing required env vars: %s", ", ".join(missing))
        return 2

    from google.cloud import firestore  # imported lazily for test friendliness

    db = firestore.Client(project=project)
    upserter = _make_typesense_upserter(host or "", admin_key or "", collection)

    counts = reindex(db, upserter)
    logger.info(
        "[reindex] done upserted=%d skipped_deleted=%d",
        counts["upserted"],
        counts["skippedDeleted"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
