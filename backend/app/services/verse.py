"""Bible verse service — fetch today's verse from bible-api.com (WEB translation).

Circuit breaker (P8): 5 consecutive errors → open for 5 minutes, logged as
`bible_api_circuit_open`. Kill-switch: set JACOB_VERSE_DISABLED=true.
"""

from __future__ import annotations

import json
import logging
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

_CALENDAR_PATH = (
    Path(__file__).parent.parent.parent.parent.parent / "infra" / "seed" / "verse_calendar.json"
)
Translation = Literal["WEB", "KJV"]


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
@lru_cache(maxsize=1)
def _load_calendar() -> dict[str, object]:
    if _CALENDAR_PATH.exists():
        return dict(json.loads(_CALENDAR_PATH.read_text()))
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
        raw_t = override.get("translation", "WEB")
        translation: Translation = "WEB" if raw_t not in ("WEB", "KJV") else raw_t  # type: ignore[assignment]
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
    translation = "WEB"
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
