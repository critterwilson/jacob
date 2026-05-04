"""Open Graph metadata extractor (T53).

`unfurl(url)` returns `{title, description, imageUrl, siteName}` or
None on any guard violation. Cached at `unfurl_cache/{urlHash}` for 24
hours; the cache hash is `sha256(url)[:16]` so we never store the
plain URL in logs.

Image proxying is intentionally NOT implemented in v1 — we return the
OG image URL directly. The frontend renders with
`referrerpolicy="no-referrer"` so the user's browsing the source page
isn't leaked to the image host. Image proxy via GCS is the spec's
"defense-in-depth" path; deferred to a follow-up so this PR stays
small.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from app.services import safe_fetch as sf

logger = logging.getLogger(__name__)


_CACHE_TTL = timedelta(hours=24)
_OG_RE = re.compile(
    r"""<meta\s+[^>]*?(?:property|name)\s*=\s*["']
        (?P<key>og:title|og:description|og:image|og:site_name|description)["']
        \s+[^>]*?content\s*=\s*["'](?P<val>[^"']*)["']""",
    re.IGNORECASE | re.VERBOSE | re.DOTALL,
)
_TITLE_RE = re.compile(r"<title[^>]*>(?P<val>.*?)</title>", re.IGNORECASE | re.DOTALL)


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _empty_metadata() -> dict[str, str | None]:
    """Returned on any failure path so callers can render a bare-link card."""
    return {
        "title": None,
        "description": None,
        "imageUrl": None,
        "siteName": None,
    }


def _decode_text(body: bytes, content_type: str) -> str:
    """Decode bytes → str using the content-type charset hint."""
    charset = "utf-8"
    if content_type:
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("charset="):
                charset = part.split("=", 1)[1].strip().strip('"').lower() or "utf-8"
                break
    try:
        return body.decode(charset, errors="replace")
    except (LookupError, ValueError):
        return body.decode("utf-8", errors="replace")


def parse_og_metadata(html_body: str) -> dict[str, str | None]:
    """Pure helper: pull OG tags and a `<title>` fallback from HTML."""
    out: dict[str, str | None] = {
        "title": None,
        "description": None,
        "imageUrl": None,
        "siteName": None,
    }
    for match in _OG_RE.finditer(html_body):
        key = match.group("key").lower()
        value = html.unescape(match.group("val")).strip()
        if not value:
            continue
        if key == "og:title" and out["title"] is None:
            out["title"] = value
        elif key in ("og:description", "description") and out["description"] is None:
            out["description"] = value
        elif key == "og:image" and out["imageUrl"] is None:
            out["imageUrl"] = value
        elif key == "og:site_name" and out["siteName"] is None:
            out["siteName"] = value

    if out["title"] is None:
        title_match = _TITLE_RE.search(html_body)
        if title_match:
            title_value = html.unescape(title_match.group("val")).strip()
            if title_value:
                out["title"] = title_value

    # Cap field lengths to keep persisted unfurls small.
    if out["title"]:
        out["title"] = out["title"][:200]
    if out["description"]:
        out["description"] = out["description"][:500]
    if out["siteName"]:
        out["siteName"] = out["siteName"][:120]
    return out


def _read_cache(db: Any, key: str) -> dict[str, Any] | None:
    snap = db.collection("unfurl_cache").document(key).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    expires = data.get("expiresAt")
    if isinstance(expires, datetime):
        expires_aware = expires if expires.tzinfo else expires.replace(tzinfo=UTC)
        if expires_aware < datetime.now(UTC):
            return None
    return data


def _write_cache(
    db: Any,
    *,
    key: str,
    url: str,
    metadata: dict[str, str | None],
) -> None:
    now = datetime.now(UTC)
    db.collection("unfurl_cache").document(key).set(
        {
            "urlHash": key,
            "title": metadata.get("title"),
            "description": metadata.get("description"),
            "imageUrl": metadata.get("imageUrl"),
            "siteName": metadata.get("siteName"),
            "fetchedAt": now,
            "expiresAt": now + _CACHE_TTL,
        }
    )


def unfurl(
    url: str,
    *,
    db: Any | None = None,
    fetcher: Any = None,
) -> dict[str, str | None]:
    """Return OG metadata for `url`, hitting the cache when possible.

    Cache misses go through `safe_fetch.safe_fetch`. Failures return a
    "plain" record (everything None) so the caller can still render a
    bare-link card.
    """
    key = url_hash(url)
    if db is not None:
        cached = _read_cache(db, key)
        if cached is not None:
            return {
                "title": cached.get("title"),
                "description": cached.get("description"),
                "imageUrl": cached.get("imageUrl"),
                "siteName": cached.get("siteName"),
            }

    fn = fetcher or sf.safe_fetch
    try:
        status, body, content_type, _final_url = fn(url)
    except sf.SafeFetchError as exc:
        logger.info("unfurl_blocked code=%s url_hash=%s", exc.code, key)
        metadata = _empty_metadata()
        if db is not None:
            _write_cache(db, key=key, url=url, metadata=metadata)
        return metadata

    if status >= 400:
        metadata = _empty_metadata()
    elif "html" not in content_type.lower():
        # Not HTML — store an empty cache entry so we don't re-fetch.
        metadata = _empty_metadata()
    else:
        text = _decode_text(body, content_type)
        metadata = parse_og_metadata(text)

    if db is not None:
        _write_cache(db, key=key, url=url, metadata=metadata)
    return metadata
