"""Slug generation, author-hash, and doc-ID helpers for devotionals.

Devotional URLs took a new shape after the title-slug autogeneration
change: platform-wide entries live at `/devotionals/org/<slug>` and
group-scoped entries at `/devotionals/group/<authorHash>/<slug>`. The
Firestore doc ID mirrors the path with `__` as the segment delimiter
(slashes aren't legal in doc IDs).

`author_hash` is a deterministic, non-reversible base32 prefix of
SHA-256(uid). Stable per uid; keeps the raw Firebase UID out of URLs
without needing a secret-keyed HMAC (knowing a UID never grants
anything in this system; the goal is just "URL doesn't leak the UID
verbatim").
"""

from __future__ import annotations

import base64
import hashlib
import re
from collections.abc import Callable
from typing import Literal

Scope = Literal["org", "group"]

# Title-derived slug constraints. 60 chars is a comfortable upper bound:
# long enough to keep titles readable, short enough that doc IDs (which
# include scope + optional 8-char author hash + two `__` separators)
# stay well under Firestore's 1500-byte limit.
_MAX_SLUG_LEN = 60
_SLUG_FALLBACK = "devotional"

# Hash bytes → base32 char width: 5 bytes → 8 chars (no padding).
_AUTHOR_HASH_BYTES = 5
# Salt prefix so this hash never coincides with another use of
# sha256(uid) elsewhere in the system.
_AUTHOR_HASH_SALT = "jacob.dev.author:"


def slugify_title(title: str) -> str:
    """Derive a URL-safe slug from a devotional title.

    Lowercase; non-alphanumeric becomes a single hyphen; collapsed runs
    of hyphens; stripped at the ends; truncated to `_MAX_SLUG_LEN`. If
    the title contains no alphanumerics, falls back to "devotional"
    rather than returning an empty string (which would produce a doc
    ID like `org__`).
    """
    lowered = title.casefold()
    # Replace any run of non-alphanumerics with a single hyphen.
    hyphenated = re.sub(r"[^a-z0-9]+", "-", lowered)
    stripped = hyphenated.strip("-")
    if not stripped:
        return _SLUG_FALLBACK
    if len(stripped) > _MAX_SLUG_LEN:
        stripped = stripped[:_MAX_SLUG_LEN].rstrip("-") or _SLUG_FALLBACK
    return stripped


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


def next_available_slug(
    base_slug: str,
    *,
    exists: Callable[[str], bool],
    max_attempts: int = 100,
) -> str:
    """Append `-2`, `-3`, ... until `exists(candidate)` returns False.

    `exists` is a caller-provided predicate (typically a Firestore
    document-exists check). The first candidate tried is `base_slug`
    itself; on collision, `<base>-2`, then `<base>-3`, and so on.

    Truncates the base if the suffix would push the total past
    `_MAX_SLUG_LEN` so the doc ID stays within bounds even after many
    title collisions. Raises RuntimeError after `max_attempts` to
    avoid infinite loops on a misbehaving predicate.
    """
    if not exists(base_slug):
        return base_slug
    for n in range(2, max_attempts + 2):
        suffix = f"-{n}"
        head_budget = _MAX_SLUG_LEN - len(suffix)
        head = base_slug[:head_budget].rstrip("-") or _SLUG_FALLBACK
        candidate = f"{head}{suffix}"
        if not exists(candidate):
            return candidate
    raise RuntimeError(
        f"could not find unique slug for base={base_slug!r} after {max_attempts} attempts"
    )
