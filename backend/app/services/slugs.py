"""Generic title → URL slug helpers.

Originally introduced for devotionals (PR #346, `services/devotional_paths`).
Lifted into a standalone module so boards, reading plans, and any
future content surface can share the same derivation rules:

  * lowercase
  * non-alphanumeric runs → single hyphen
  * trim leading/trailing hyphens
  * cap length at `max_len` (default 60)
  * fall back to `fallback` when the input contains no alphanumerics

The `devotional_paths` module re-exports `slugify_title` /
`next_available_slug` for back-compat; new callers should import from
here directly.
"""

from __future__ import annotations

import re
from collections.abc import Callable

_DEFAULT_MAX_LEN = 60
_DEFAULT_FALLBACK = "item"


def slugify_title(
    title: str,
    *,
    max_len: int = _DEFAULT_MAX_LEN,
    fallback: str = _DEFAULT_FALLBACK,
) -> str:
    """Derive a URL-safe kebab-case slug from a free-form title.

    Examples:
        slugify_title("The Lord Is My Shepherd")  -> "the-lord-is-my-shepherd"
        slugify_title("Acts 2:42 — community")    -> "acts-2-42-community"
        slugify_title("!!!")                       -> "item"  (default fallback)
        slugify_title("a" * 200, max_len=60)       -> 60 chars, no trailing hyphen

    Falls back rather than returning an empty string so doc IDs don't
    end up like `boards/` or `reading_plans/`.
    """
    lowered = title.casefold()
    hyphenated = re.sub(r"[^a-z0-9]+", "-", lowered)
    stripped = hyphenated.strip("-")
    if not stripped:
        return fallback
    if len(stripped) > max_len:
        stripped = stripped[:max_len].rstrip("-") or fallback
    return stripped


def next_available_slug(
    base_slug: str,
    *,
    exists: Callable[[str], bool],
    max_attempts: int = 100,
    max_len: int = _DEFAULT_MAX_LEN,
    fallback: str = _DEFAULT_FALLBACK,
) -> str:
    """Append `-2`, `-3`, … until `exists(candidate)` returns False.

    First candidate is `base_slug` itself; on collision, `<base>-2`,
    `<base>-3`, … The base is truncated so `<head>-<n>` fits inside
    `max_len`, so doc IDs stay bounded even after many title-collision
    suffixes. Raises RuntimeError after `max_attempts` to avoid an
    infinite loop on a misbehaving predicate (Firestore unreachable,
    etc.).
    """
    if not exists(base_slug):
        return base_slug
    for n in range(2, max_attempts + 2):
        suffix = f"-{n}"
        head_budget = max_len - len(suffix)
        head = base_slug[:head_budget].rstrip("-") or fallback
        candidate = f"{head}{suffix}"
        if not exists(candidate):
            return candidate
    raise RuntimeError(
        f"could not find unique slug for base={base_slug!r} after {max_attempts} attempts"
    )
