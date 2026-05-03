"""Tests for backend/app/services/verse.py (T33)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from app.services import verse as verse_svc


@pytest.fixture(autouse=True)
def reset_circuit():
    """Reset the module-level circuit breaker state between tests."""
    verse_svc._circuit._failures = 0
    verse_svc._circuit._opened_at = None
    verse_svc._calendar_cache = None
    yield
    verse_svc._circuit._failures = 0
    verse_svc._circuit._opened_at = None
    verse_svc._calendar_cache = None


_SAMPLE_CALENDAR = {
    "calendar": {
        "12-25": {"reference": "Luke 2:11", "translation": "WEB", "source": "calendar-override"},
        "2026-04-05": {
            "reference": "Joel 2:12-13",
            "translation": "WEB",
            "source": "calendar-override",
        },
    },
    "rotation": [
        "John 3:16",
        "Romans 8:28",
        "Psalm 23:1",
    ],
}


def _patch_calendar(cal: dict):
    return patch.object(verse_svc, "_load_calendar", return_value=cal)


def _patch_api(text: str = "For God so loved the world."):
    return patch.object(verse_svc, "_fetch_from_api", return_value=text)


def test_fetch_verse_calendar_override_by_full_date():
    """YYYY-MM-DD override takes precedence over rotation."""
    fixed_date = datetime(2026, 4, 5, tzinfo=UTC)
    text = "Return to me with all your heart."
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api(text) as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)

    assert doc.reference == "Joel 2:12-13"
    assert doc.source == "calendar-override"
    mock_api.assert_called_once_with("Joel 2:12-13", "WEB")


def test_fetch_verse_calendar_override_by_month_day():
    """MM-DD override is used when no YYYY-MM-DD match."""
    fixed_date = datetime(2025, 12, 25, tzinfo=UTC)
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api("To you is born a Savior.") as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)

    assert doc.reference == "Luke 2:11"
    assert doc.source == "calendar-override"
    mock_api.assert_called_once_with("Luke 2:11", "WEB")


def test_fetch_verse_rotation():
    """Non-override date uses rotation entry keyed by day_of_year."""
    fixed_date = datetime(2025, 6, 15, tzinfo=UTC)  # day 166
    day_of_year = fixed_date.timetuple().tm_yday - 1  # 165
    expected_ref = _SAMPLE_CALENDAR["rotation"][day_of_year % 3]
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api("I can do all things.") as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)

    assert doc.reference == expected_ref
    assert doc.source == "bible-api.com"
    mock_api.assert_called_once()


def test_fetch_verse_api_failure_circuit_opens():
    """Five consecutive failures open the circuit."""
    fixed_date = datetime(2025, 6, 10, tzinfo=UTC)
    with _patch_calendar(_SAMPLE_CALENDAR):
        with patch.object(verse_svc, "_fetch_from_api", side_effect=RuntimeError("api down")):
            for _ in range(5):
                with pytest.raises(RuntimeError):
                    verse_svc.fetch_verse_for_today(today=fixed_date)
                    verse_svc._circuit._failures  # keep state

    assert verse_svc._circuit.is_open()


def test_fetch_verse_circuit_open_raises_immediately():
    """When circuit is open, fetch raises without calling the API."""
    verse_svc._circuit._failures = 5
    verse_svc._circuit._opened_at = datetime.now(UTC)
    with _patch_calendar(_SAMPLE_CALENDAR):
        with patch.object(verse_svc, "_fetch_from_api") as mock_api:
            with pytest.raises(RuntimeError, match="circuit open"):
                verse_svc.fetch_verse_for_today()
    mock_api.assert_not_called()


def test_write_verse_idempotent():
    """Calling fetch_verse_for_today twice on the same day returns the same reference."""
    fixed_date = datetime(2025, 1, 1, tzinfo=UTC)
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api("Great is his faithfulness."):
        doc1 = verse_svc.fetch_verse_for_today(today=fixed_date)
        doc2 = verse_svc.fetch_verse_for_today(today=fixed_date)

    assert doc1.reference == doc2.reference
    assert doc1.text == doc2.text


def test_verse_disabled_raises():
    """JACOB_VERSE_DISABLED causes fetch to raise RuntimeError."""
    with patch.object(verse_svc, "_verse_disabled", return_value=True):
        with pytest.raises(RuntimeError, match="disabled"):
            verse_svc.fetch_verse_for_today()
