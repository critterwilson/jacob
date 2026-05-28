"""Devotional-specific path / slug helpers.

The generic title→slug + collision-suffix functions used to live here.
They've been lifted into `app.services.slugs` so boards, reading
plans, and any future content surface can share them; devotionals
keep their existing 60-char cap + "devotional" fallback via a thin
wrapper so doc IDs (`org__<slug>` / `group__<hash>__<slug>`) don't
reshape.
"""

from __future__ import annotations

import base64
import hashlib
from collections.abc import Callable
from typing import Literal

from app.services.slugs import (
    next_available_slug as _next_available_slug_generic,
)
from app.services.slugs import (
    slugify_title as _slugify_title_generic,
)

Scope = Literal["org", "group"]

# Devotionals keep their original 60-char cap + "devotional" fallback
# so existing doc IDs are stable.
_MAX_SLUG_LEN = 60
_SLUG_FALLBACK = "devotional"

# Hash bytes → base32 char width: 5 bytes → 8 chars (no padding).
_AUTHOR_HASH_BYTES = 5
# Salt prefix so this hash never coincides with another use of
# sha256(uid) elsewhere in the system.
_AUTHOR_HASH_SALT = "jacob.dev.author:"


def slugify_title(title: str) -> str:
    """Devotional title → slug. Thin wrapper around the generic helper
    so devotionals keep their original max-length and fallback."""
    return _slugify_title_generic(
        title,
        max_len=_MAX_SLUG_LEN,
        fallback=_SLUG_FALLBACK,
    )


def next_available_slug(
    base_slug: str,
    *,
    exists: Callable[[str], bool],
    max_attempts: int = 100,
) -> str:
    """Devotional-specific collision suffixing. Same wrapper rationale
    as `slugify_title` — preserves the 60-char cap and "devotional"
    fallback so post-collision slugs match the legacy shape."""
    return _next_available_slug_generic(
        base_slug,
        exists=exists,
        max_attempts=max_attempts,
        max_len=_MAX_SLUG_LEN,
        fallback=_SLUG_FALLBACK,
    )


def author_hash(uid: str) -> str:
    """Stable 8-char base32 hash of a Firebase UID.

    Deterministic — `author_hash(uid)` always returns the same value
    for the same uid — but not reversible: SHA-256 + truncation means
    no one can recover the uid from the hash. Same uid → same hash
    across processes, deploys, and authors.
    """
    digest = hashlib.sha256(f"{_AUTHOR_HASH_SALT}{uid}".encode()).digest()
    encoded = base64.b32encode(digest[:_AUTHOR_HASH_BYTES]).decode("ascii")
    return encoded.lower().rstrip("=")


def doc_id_for(scope: Scope, slug: str, *, author_hash_value: str | None = None) -> str:
    """Compose the Firestore document ID for a devotional.

    Platform-wide:  `org__<slug>`
    Group-scoped:   `group__<authorHash>__<slug>`

    Slashes aren't legal in Firestore doc IDs, so the URL's `/`
    separators become `__` here.
    """
    if scope == "org":
        return f"org__{slug}"
    if scope == "group":
        if not author_hash_value:
            raise ValueError("group-scoped doc IDs require an author hash")
        return f"group__{author_hash_value}__{slug}"
    raise ValueError(f"unknown scope: {scope!r}")


def path_for(scope: Scope, slug: str, *, author_hash_value: str | None = None) -> str:
    """The URL path segment under `/devotionals/`.

    Mirrors `doc_id_for` but with `/` as the separator. The frontend
    builds the canonical link as `/devotionals/<path>`.
    """
    if scope == "org":
        return f"org/{slug}"
    if scope == "group":
        if not author_hash_value:
            raise ValueError("group-scoped paths require an author hash")
        return f"group/{author_hash_value}/{slug}"
    raise ValueError(f"unknown scope: {scope!r}")


def parse_doc_id(doc_id: str) -> tuple[Scope, str | None, str] | None:
    """Inverse of `doc_id_for`. Returns (scope, authorHash|None, slug).

    Returns None for legacy single-segment doc IDs (e.g.
    `psalm-23-shepherd`) so callers can distinguish "pre-rename data"
    from "current scheme".
    """
    if doc_id.startswith("org__"):
        rest = doc_id[len("org__") :]
        if not rest:
            return None
        return ("org", None, rest)
    if doc_id.startswith("group__"):
        rest = doc_id[len("group__") :]
        # Author hash is fixed-width (8 chars) followed by `__`.
        sep = rest.find("__")
        if sep <= 0:
            return None
        author = rest[:sep]
        slug = rest[sep + 2 :]
        if not author or not slug:
            return None
        return ("group", author, slug)
    return None
