"""Native Firestore search (ADR 0016).

Search runs against the `searchTokens` field on each message
(maintained by the `onMessageTokenize` Cloud Function trigger). The query
splits the user's text into lowercase tokens; the first token drives a
per-group `array_contains` Firestore query, and any remaining tokens are
applied as a post-filter so multi-word queries behave like AND.

Tradeoffs (intentional, see ADR 0016):
  - No typo tolerance, no stemming, no ranking by relevance — results are
    ordered by `createdAt` desc.
  - Pagination is approximate: we fetch up to `MAX_HITS_PER_GROUP` per
    membership, merge, sort, and slice. `total` reflects the merged set,
    not a Firestore aggregate count.
  - Membership cap (`_MEMBERSHIP_CAP`) bounds the per-request cost.
"""

from __future__ import annotations

import datetime as _dt
import logging
import re
from typing import Any

from app.models.search import SearchResponse, SearchResult

logger = logging.getLogger(__name__)

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_MEMBERSHIP_CAP = 30
_MAX_HITS_PER_GROUP = 100


def tokenize(text: str) -> list[str]:
    """Split text into lowercase word tokens, dedup, preserve order."""
    seen: set[str] = set()
    out: list[str] = []
    for tok in _TOKEN_PATTERN.findall((text or "").lower()):
        if tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
    return out


def enumerate_memberships(db: Any, uid: str, cap: int = _MEMBERSHIP_CAP) -> list[str]:
    """Return the gids the caller is a member of, capped at `cap`.

    Uses the `members` collection-group query (ADR 0003).
    """
    snaps = db.collection_group("members").where("uid", "==", uid).limit(cap).stream()
    gids: list[str] = []
    for snap in snaps:
        ref = getattr(snap, "reference", None)
        parent = getattr(getattr(ref, "parent", None), "parent", None)
        if parent is not None and getattr(parent, "id", None):
            gids.append(parent.id)
    return gids


def _doc_to_hit(gid: str, mid: str, data: dict[str, Any]) -> SearchResult:
    created_at_raw: Any = data.get("createdAt")
    iso_method = getattr(created_at_raw, "isoformat", None)
    if callable(iso_method):
        created_iso = iso_method()
    elif isinstance(created_at_raw, (int, float)):
        created_iso = _dt.datetime.fromtimestamp(float(created_at_raw), tz=_dt.UTC).isoformat()
    else:
        created_iso = ""
    body = data.get("body")
    return SearchResult(
        messageRef=f"groups/{gid}/messages/{mid}",
        groupId=gid,
        authorUid=str(data.get("authorUid", "")),
        authorDisplayName=None,
        body=body if isinstance(body, str) else "",
        createdAt=created_iso,
        parentMessageId=(
            data.get("parentMessageId") if isinstance(data.get("parentMessageId"), str) else None
        ),
    )


def _is_visible(data: dict[str, Any]) -> bool:
    if data.get("deletedAt") is not None:
        return False
    moderation = data.get("moderation")
    if isinstance(moderation, dict) and moderation.get("state") == "hidden":
        return False
    return True


def _matches_all_tokens(data: dict[str, Any], tokens: list[str]) -> bool:
    """Confirm every query token is present in the doc's searchTokens."""
    raw = data.get("searchTokens")
    if not isinstance(raw, list):
        return False
    have = {t for t in raw if isinstance(t, str)}
    return all(t in have for t in tokens)


def search_messages(
    db: Any,
    *,
    uid: str,
    q: str,
    page: int,
    limit: int,
) -> SearchResponse:
    tokens = tokenize(q)
    if not tokens:
        return SearchResponse(hits=[], total=0, page=page, limit=limit)

    gids = enumerate_memberships(db, uid)
    if not gids:
        return SearchResponse(hits=[], total=0, page=page, limit=limit)

    primary = tokens[0]
    extra = tokens[1:]

    merged: list[tuple[float, SearchResult, dict[str, Any]]] = []
    for gid in gids:
        col = db.collection("groups").doc(gid).collection("messages")
        try:
            snaps = (
                col.where("searchTokens", "array_contains", primary)
                .limit(_MAX_HITS_PER_GROUP)
                .stream()
            )
        except Exception:
            logger.exception("search_query_failed gid=%s uid=%s", gid, uid)
            continue
        for snap in snaps:
            data = snap.to_dict() or {}
            if not _is_visible(data):
                continue
            if extra and not _matches_all_tokens(data, tokens):
                continue
            hit = _doc_to_hit(gid, snap.id, data)
            sort_key = _sort_key(data.get("createdAt"))
            merged.append((sort_key, hit, data))

    merged.sort(key=lambda triple: triple[0], reverse=True)
    total = len(merged)
    start = (page - 1) * limit
    end = start + limit
    page_hits = [h for _, h, _ in merged[start:end]]
    return SearchResponse(hits=page_hits, total=total, page=page, limit=limit)


def _sort_key(value: Any) -> float:
    if hasattr(value, "timestamp"):
        try:
            return float(value.timestamp())
        except Exception:
            return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0
