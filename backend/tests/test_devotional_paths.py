"""Tests for the devotional slug / author-hash / doc-ID helpers.

Covers the URL-shape contract:
* `slugify_title` reduces a free-text title to a URL-safe slug
* `author_hash` is stable per uid, the same length, and non-reversible
* `doc_id_for` + `path_for` mirror each other (just `__` vs `/` separator)
* `parse_doc_id` is the inverse of `doc_id_for` for current-scheme IDs
  and returns None for legacy single-segment ones
* `next_available_slug` appends suffixes on collision and stays under
  the slug length cap
"""

from __future__ import annotations

import pytest

from app.services.devotional_paths import (
    author_hash,
    doc_id_for,
    next_available_slug,
    parse_doc_id,
    path_for,
    slugify_title,
)

# ── slugify_title ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "title, expected",
    [
        ("The Lord is My Shepherd", "the-lord-is-my-shepherd"),
        ("John 3:16 — God So Loved", "john-3-16-god-so-loved"),
        # Apostrophes, em-dashes, and other non-ASCII punctuation collapse
        # to a single hyphen along with surrounding whitespace.
        ("Don't Lose Heart", "don-t-lose-heart"),
        ("  Lots   of   spaces  ", "lots-of-spaces"),
        ("UPPERCASE Title", "uppercase-title"),
        # Trailing/leading punctuation drops cleanly — no stray hyphens.
        ("!!! Joy !!!", "joy"),
    ],
)
def test_slugify_title_basic_cases(title: str, expected: str) -> None:
    assert slugify_title(title) == expected


def test_slugify_title_truncates_at_60_chars() -> None:
    long_title = "word " * 30  # 150 chars before slugify
    result = slugify_title(long_title)
    assert len(result) <= 60
    # Must not end in a hyphen even after truncation lands on one.
    assert not result.endswith("-")


def test_slugify_title_empty_falls_back_to_devotional() -> None:
    # All-punctuation titles would otherwise produce an empty doc-ID
    # segment (`org__`), which is unreachable. Fall back to "devotional".
    assert slugify_title("!!!") == "devotional"
    assert slugify_title("") == "devotional"
    assert slugify_title("    ") == "devotional"


# ── author_hash ─────────────────────────────────────────────────────────────


def test_author_hash_is_stable_per_uid() -> None:
    # Same uid → same hash. This is the contract that keeps a leader's
    # devotional URLs stable across sessions.
    assert author_hash("abc-uid") == author_hash("abc-uid")


def test_author_hash_differs_per_uid() -> None:
    # Different uids should hash to different values for any reasonable
    # population — this is a smoke test on the salt + truncation choice.
    assert author_hash("uid-a") != author_hash("uid-b")


def test_author_hash_is_eight_lowercase_base32_chars() -> None:
    h = author_hash("any-uid")
    assert len(h) == 8
    # Lowercase base32: a-z + 2-7, no padding.
    assert all(c in "abcdefghijklmnopqrstuvwxyz234567" for c in h)


def test_author_hash_does_not_contain_raw_uid() -> None:
    # The whole point of hashing the uid is to keep it out of URLs.
    uid = "firebase-auth-uid-1234567890abcdef"
    h = author_hash(uid)
    assert uid not in h
    # And no recoverable prefix either — the hash should look unrelated
    # to the input. A naive truncation of the uid itself would fail this.
    assert uid[:6] not in h


def test_author_hash_uses_salt_so_it_differs_from_plain_sha256() -> None:
    # Defensive: if anyone removes the salt prefix, this catches it.
    import base64
    import hashlib

    uid = "uid-for-salt-check"
    unsalted = (
        base64.b32encode(hashlib.sha256(uid.encode()).digest()[:5])
        .decode("ascii")
        .lower()
        .rstrip("=")
    )
    assert author_hash(uid) != unsalted


# ── doc_id_for / path_for / parse_doc_id ────────────────────────────────────


def test_doc_id_for_org_format() -> None:
    assert doc_id_for("org", "psalm-23") == "org__psalm-23"


def test_doc_id_for_group_requires_author_hash() -> None:
    with pytest.raises(ValueError):
        doc_id_for("group", "psalm-23")


def test_doc_id_for_group_format() -> None:
    assert (
        doc_id_for("group", "psalm-23", author_hash_value="abc12345") == "group__abc12345__psalm-23"
    )


def test_path_for_uses_slashes_instead_of_double_underscore() -> None:
    assert path_for("org", "psalm-23") == "org/psalm-23"
    assert path_for("group", "psalm-23", author_hash_value="abc12345") == "group/abc12345/psalm-23"


def test_parse_doc_id_round_trips() -> None:
    # Round-trip: doc_id_for → parse_doc_id should give back the same parts.
    for scope, slug, hashed in [
        ("org", "psalm-23", None),
        ("org", "the-lord-is-my-shepherd", None),
        ("group", "john-3-16", "abc12345"),
    ]:
        doc_id = doc_id_for(scope, slug, author_hash_value=hashed)
        parsed = parse_doc_id(doc_id)
        assert parsed == (scope, hashed, slug)


def test_parse_doc_id_returns_none_for_legacy_ids() -> None:
    # Pre-rename docs (single-segment slug as doc ID) — the parser must
    # surface this so callers can fall back to the legacy URL shape.
    assert parse_doc_id("psalm-23-shepherd") is None
    assert parse_doc_id("john-1-light") is None


def test_parse_doc_id_returns_none_for_malformed_group_ids() -> None:
    # Defensive: a malformed `group__` doc ID without an author hash
    # shouldn't crash the parser.
    assert parse_doc_id("group__") is None
    assert parse_doc_id("group__abc") is None  # no slug
    assert parse_doc_id("org__") is None


# ── next_available_slug ─────────────────────────────────────────────────────


def test_next_available_slug_returns_base_when_unused() -> None:
    taken: set[str] = set()
    assert next_available_slug("foo", exists=taken.__contains__) == "foo"


def test_next_available_slug_appends_numeric_suffix_on_collision() -> None:
    taken = {"foo"}
    assert next_available_slug("foo", exists=taken.__contains__) == "foo-2"


def test_next_available_slug_walks_through_suffixes() -> None:
    taken = {"foo", "foo-2", "foo-3"}
    assert next_available_slug("foo", exists=taken.__contains__) == "foo-4"


def test_next_available_slug_truncates_long_base_to_keep_slug_in_bounds() -> None:
    # Long base + suffix should still respect the 60-char slug cap.
    base = "a" * 60
    taken = {base}
    result = next_available_slug(base, exists=taken.__contains__)
    assert len(result) <= 60
    assert result.endswith("-2")
    assert not result.startswith("-")


def test_next_available_slug_raises_after_max_attempts() -> None:
    # All probes return True → no slug ever available. The helper must
    # bail rather than spinning forever.
    with pytest.raises(RuntimeError):
        next_available_slug("foo", exists=lambda _: True, max_attempts=3)
