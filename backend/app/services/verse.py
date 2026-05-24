"""Bible verse service — fetch today's verse from bible-api.com (KJV translation).

Circuit breaker (P8): 5 consecutive errors → open for 5 minutes, logged as
`bible_api_circuit_open`. Kill-switch: set JACOB_VERSE_DISABLED=true.

Translation policy: only KJV is served. ESV/NIV/NKJV/NLT/NRSV are copyrighted
and require a publisher license, which JACOB does not hold. KJV is public
domain and supported by bible-api.com directly.

Book policy: Song of Solomon (a.k.a. Song of Songs, Canticles) is never
selected — see `EXCLUDED_BOOKS`.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

from app.config import get_settings

try:
    import sentry_sdk
except ImportError:  # pragma: no cover
    sentry_sdk = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CALENDAR_PATH = Path(__file__).parent.parent / "data" / "verse_calendar.json"
Translation = Literal["KJV"]

# Books that must never be selected for the daily verse, regardless of how
# they appear in the calendar or rotation. Compared case-insensitively against
# the parsed book name (see `_book_of`).
EXCLUDED_BOOKS: frozenset[str] = frozenset({"song of solomon", "song of songs", "canticles"})

# Strips the trailing chapter:verse(-verse) suffix off a reference, leaving
# just the book name. Handles "1 John 4:8", "Song of Solomon 2:1-3", etc.
_REF_TAIL_RE = re.compile(r"\s+\d+:\d+(?:-\d+)?\s*$")


def _book_of(reference: str) -> str:
    return _REF_TAIL_RE.sub("", reference).strip()


def is_excluded_reference(reference: str) -> bool:
    """Return True if `reference` is in a book the daily verse must skip."""
    return _book_of(reference).lower() in EXCLUDED_BOOKS


@dataclass(frozen=True)
class VerseDoc:
    reference: str
    translation: Translation
    text: str
    source: Literal["bible-api.com", "calendar-override"]
    fetchedAt: datetime


class VerseCircuitBreaker:
    def __init__(self, threshold: int = 5, timeout_seconds: float = 300.0) -> None:
        self._failures = 0
        self._opened_at: datetime | None = None
        self._threshold = threshold
        self._timeout = timeout_seconds

    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        elapsed = (datetime.now(UTC) - self._opened_at).total_seconds()
        if elapsed >= self._timeout:
            self._failures = 0
            self._opened_at = None
            return False
        return True

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            self._opened_at = datetime.now(UTC)
            logger.warning(
                "bible_api_circuit_open",
                extra={"failures": self._failures, "threshold": self._threshold},
            )

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None


_circuit = VerseCircuitBreaker()


def _scrub_excluded(raw: dict[str, object]) -> dict[str, object]:
    """Filter out any calendar/rotation entry whose book is excluded.

    Excluded entries are dropped silently in the output but logged with a
    warning so an operator can fix the source file.
    """
    raw_calendar = raw.get("calendar") or {}
    calendar_in: dict[str, object] = dict(raw_calendar) if isinstance(raw_calendar, dict) else {}
    calendar_out: dict[str, object] = {}
    for key, entry in calendar_in.items():
        if isinstance(entry, dict):
            ref = str(entry.get("reference", ""))
            if ref and is_excluded_reference(ref):
                logger.warning(
                    "verse_calendar_excluded_book_skipped",
                    extra={"key": key, "reference": ref},
                )
                continue
        calendar_out[key] = entry

    raw_rotation = raw.get("rotation") or []
    rotation_in: list[object] = list(raw_rotation) if isinstance(raw_rotation, list) else []
    rotation_out: list[str] = []
    for ref_obj in rotation_in:
        ref_s = str(ref_obj)
        if is_excluded_reference(ref_s):
            logger.warning(
                "verse_rotation_excluded_book_skipped",
                extra={"reference": ref_s},
            )
            continue
        rotation_out.append(ref_s)

    out: dict[str, object] = dict(raw)
    out["calendar"] = calendar_out
    out["rotation"] = rotation_out
    return out


@lru_cache(maxsize=1)
def _load_calendar() -> dict[str, object]:
    if _CALENDAR_PATH.exists():
        return _scrub_excluded(dict(json.loads(_CALENDAR_PATH.read_text())))
    return {"calendar": {}, "rotation": []}


def _verse_disabled() -> bool:
    return get_settings().jacob_verse_disabled


def _fetch_from_api(reference: str, translation: str) -> str:
    base = get_settings().bible_api_base
    url = f"{base}/{urllib.parse.quote(reference)}?translation={translation.lower()}"

    last_err: Exception | None = None
    for attempt in range(3):
        if attempt:
            time.sleep(2 ** (attempt - 1))
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
                data = json.loads(resp.read().decode())
                text = data.get("text", "").strip()
                if not text:
                    raise ValueError("empty text in api response")
                return str(text[:2000])
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning(
                "bible_api_attempt_failed",
                extra={"attempt": attempt + 1, "error": str(exc)},
            )

    raise RuntimeError(f"bible-api.com unavailable after 3 attempts: {last_err}") from last_err


def fetch_verse_for_today(today: datetime | None = None) -> VerseDoc:
    """Return today's verse. Raises RuntimeError if disabled or API fails."""
    if _verse_disabled():
        raise RuntimeError("verse service disabled (JACOB_VERSE_DISABLED)")

    if _circuit.is_open():
        raise RuntimeError("verse circuit open — skipping bible-api.com call")

    now = today or datetime.now(UTC)
    cal = _load_calendar()
    calendar: dict[str, object] = cal.get("calendar", {})  # type: ignore[assignment]
    rotation: list[str] = cal.get("rotation", [])  # type: ignore[assignment]

    ymd = now.strftime("%Y-%m-%d")
    md = now.strftime("%m-%d")

    override_raw = calendar.get(ymd) or calendar.get(md)
    if override_raw:
        override: dict[str, str] = override_raw  # type: ignore[assignment]
        reference = override["reference"]
        if is_excluded_reference(reference):
            # Defense in depth — _load_calendar should have already scrubbed
            # excluded entries. Refuse rather than fall back, so the daily job
            # logs the misconfiguration loudly.
            raise RuntimeError(f"calendar override references an excluded book: {reference}")
        translation: Translation = "KJV"
        source: Literal["bible-api.com", "calendar-override"] = "calendar-override"
        try:
            text = _fetch_from_api(reference, translation)
            _circuit.record_success()
        except Exception as exc:
            _circuit.record_failure()
            if sentry_sdk:
                sentry_sdk.capture_exception(exc)
            raise
        return VerseDoc(
            reference=reference, translation=translation, text=text, source=source, fetchedAt=now
        )

    if not rotation:
        raise RuntimeError("verse_calendar.json has no rotation entries")

    day_of_year = now.timetuple().tm_yday - 1
    reference = rotation[day_of_year % len(rotation)]
    if is_excluded_reference(reference):  # pragma: no cover — _scrub_excluded handles this
        raise RuntimeError(f"rotation entry references an excluded book: {reference}")
    translation = "KJV"
    try:
        text = _fetch_from_api(reference, translation)
        _circuit.record_success()
    except Exception as exc:
        _circuit.record_failure()
        if sentry_sdk:
            sentry_sdk.capture_exception(exc)
        raise

    return VerseDoc(
        reference=reference,
        translation=translation,
        text=text,
        source="bible-api.com",
        fetchedAt=now,
    )
