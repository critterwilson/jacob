"""T28 — backend Typesense REST client + circuit breaker.

The client is intentionally minimal: one `search` call against the
configured collection. Mirrors the function-side wrapper in
`functions/src/services/typesense.ts` so the operational behaviour
matches.

The frontend never reaches Typesense directly; this module is the only
backend touchpoint.
"""

from __future__ import annotations

import datetime as _dt
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.models.search import SearchResponse, SearchResult

logger = logging.getLogger(__name__)

_FAILURES_TO_OPEN = 5
_OPEN_DURATION_SECONDS = 5 * 60


@dataclass
class _BreakerState:
    failures: int = 0
    opened_at: float | None = None


_state = _BreakerState()


def is_circuit_open(now: float | None = None) -> bool:
    if _state.opened_at is None:
        return False
    current = time.monotonic() if now is None else now
    if current - _state.opened_at > _OPEN_DURATION_SECONDS:
        _state.opened_at = None
        _state.failures = 0
        return False
    return True


def record_success() -> None:
    _state.failures = 0
    _state.opened_at = None


def record_failure(now: float | None = None) -> None:
    _state.failures += 1
    if _state.failures >= _FAILURES_TO_OPEN:
        _state.opened_at = time.monotonic() if now is None else now


def _reset_circuit_for_tests() -> None:
    _state.failures = 0
    _state.opened_at = None


class SearchUnavailableError(RuntimeError):
    """Raised when the search backend is offline or the breaker is open."""


class SearchClient:
    """Tiny wrapper over Typesense's `/collections/{c}/documents/search`."""

    def __init__(
        self,
        *,
        host: str,
        api_key: str,
        collection: str,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._host = host.rstrip("/")
        self._api_key = api_key
        self._collection = collection
        self._timeout_seconds = timeout_seconds
        self._client = client

    def _http(self) -> httpx.Client:
        if self._client is not None:
            return self._client
        return httpx.Client(timeout=self._timeout_seconds)

    def search(
        self,
        *,
        q: str,
        gids: list[str],
        page: int,
        per_page: int,
    ) -> dict[str, Any]:
        if not gids:
            # Empty membership set means no results — short-circuit before
            # the network call.
            return {"hits": [], "found": 0}

        filter_by_parts = [f"groupId:[{','.join(gids)}]", "moderationState:!=hidden"]
        params = {
            "q": q,
            "query_by": "body,authorDisplayName",
            "filter_by": " && ".join(filter_by_parts),
            "sort_by": "createdAtUnix:desc",
            "page": str(page),
            "per_page": str(per_page),
            "highlight_fields": "body",
            "highlight_full_fields": "body",
        }

        url = f"{self._host}/collections/{self._collection}/documents/search"
        headers = {"X-TYPESENSE-API-KEY": self._api_key}
        client = self._http()
        try:
            res = client.get(url, params=params, headers=headers)
        except httpx.HTTPError as err:
            record_failure()
            raise SearchUnavailableError(str(err)) from err

        if res.status_code >= 500:
            record_failure()
            raise SearchUnavailableError(f"typesense returned {res.status_code}: {res.text[:200]}")
        if res.status_code >= 400:
            # 4xx is a programmer error against Typesense, not a transient
            # outage. Surface as unavailable but don't trip the breaker.
            raise SearchUnavailableError(f"typesense returned {res.status_code}: {res.text[:200]}")

        record_success()
        data: dict[str, Any] = res.json()
        return data


def normalise(response: dict[str, Any], *, page: int, per_page: int) -> SearchResponse:
    """Convert a Typesense JSON response into our `SearchResponse` shape."""
    raw_hits = response.get("hits", []) or []
    hits: list[SearchResult] = []
    for hit in raw_hits:
        doc = hit.get("document", {}) or {}
        gid = str(doc.get("groupId", ""))
        mid = str(doc.get("id", ""))
        if not gid or not mid:
            continue

        # Prefer the highlighted body snippet over the raw body so the
        # client can render `<mark>` after sanitising. Typesense returns
        # `highlights` (list, deprecated) and `highlight` (object) — handle
        # both shapes.
        snippet: str | None = None
        highlights = hit.get("highlights")
        if isinstance(highlights, list):
            for h in highlights:
                if h.get("field") == "body":
                    snippet = h.get("snippet") or h.get("value")
                    break
        if snippet is None:
            highlight = hit.get("highlight") or {}
            body_h = highlight.get("body") if isinstance(highlight, dict) else None
            if isinstance(body_h, dict):
                snippet = body_h.get("snippet") or body_h.get("value")

        body = snippet or str(doc.get("body", ""))

        created_unix_raw = doc.get("createdAtUnix", 0)
        try:
            created_unix = int(created_unix_raw)
        except (TypeError, ValueError):
            created_unix = 0
        created_iso = _dt.datetime.fromtimestamp(created_unix, tz=_dt.UTC).isoformat()

        hits.append(
            SearchResult(
                messageRef=f"groups/{gid}/messages/{mid}",
                groupId=gid,
                authorUid=str(doc.get("authorUid", "")),
                authorDisplayName=doc.get("authorDisplayName"),
                body=body,
                createdAt=created_iso,
                parentMessageId=doc.get("parentMessageId"),
            )
        )

    total_raw = response.get("found", 0)
    try:
        total = int(total_raw)
    except (TypeError, ValueError):
        total = 0

    return SearchResponse(hits=hits, total=total, page=page, limit=per_page)


def get_client() -> SearchClient:
    settings = get_settings()
    return SearchClient(
        host=settings.typesense_host,
        api_key=settings.typesense_api_key,
        collection=settings.typesense_collection,
        timeout_seconds=settings.typesense_timeout_seconds,
    )


def enumerate_memberships(db: Any, uid: str, cap: int = 100) -> list[str]:
    """Return the gids the caller is a member of, capped at `cap`.

    Uses the `members` collection-group query (ADR 0003). The Admin SDK
    bypasses rules but the rule shape would also permit this read — see
    ADR 0005 for the threat-model reasoning.
    """
    snaps = db.collection_group("members").where("uid", "==", uid).limit(cap).stream()
    gids: list[str] = []
    for snap in snaps:
        ref = getattr(snap, "reference", None)
        parent = getattr(getattr(ref, "parent", None), "parent", None)
        if parent is not None and getattr(parent, "id", None):
            gids.append(parent.id)
    return gids


def health(client: SearchClient | None = None) -> dict[str, Any]:
    settings = get_settings()
    target = client or get_client()
    url = f"{target._host}/health"  # noqa: SLF001 — internal helper
    headers = {"X-TYPESENSE-API-KEY": settings.typesense_api_key}
    with httpx.Client(timeout=settings.typesense_timeout_seconds) as http_client:
        res = http_client.get(url, headers=headers)
    return {"status": res.status_code, "body": res.text}
