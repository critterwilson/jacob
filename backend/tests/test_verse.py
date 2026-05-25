"""Tests for backend/app/services/verse.py (T33) and the daily-verse router (M1)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.verse import router as verse_router
from app.services import verse as verse_svc


@pytest.fixture(autouse=True)
def reset_circuit():
    """Reset the module-level circuit breaker state between tests."""
    verse_svc._circuit._failures = 0
    verse_svc._circuit._opened_at = None
    verse_svc._load_calendar.cache_clear()
    yield
    verse_svc._circuit._failures = 0
    verse_svc._circuit._opened_at = None
    verse_svc._load_calendar.cache_clear()


_SAMPLE_CALENDAR = {
    "calendar": {
        "12-25": {"reference": "Luke 2:11", "translation": "KJV", "source": "calendar-override"},
        "2026-04-05": {
            "reference": "Joel 2:12-13",
            "translation": "KJV",
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
    mock_api.assert_called_once_with("Joel 2:12-13", "KJV")


def test_fetch_verse_calendar_override_by_month_day():
    """MM-DD override is used when no YYYY-MM-DD match."""
    fixed_date = datetime(2025, 12, 25, tzinfo=UTC)
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api("To you is born a Savior.") as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)

    assert doc.reference == "Luke 2:11"
    assert doc.source == "calendar-override"
    mock_api.assert_called_once_with("Luke 2:11", "KJV")


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


# ── /api/daily-verse router ─────────────────────────────────────────────


def _verse_app(*, authed: bool = True) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(verse_router)
    if authed:
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            uid="alice", email="alice@example.com", claims={}
        )
    return app


def _verse_doc_snap(
    *,
    exists: bool = True,
    reference: str = "John 3:16",
    translation: str = "WEB",
    text: str = "For God so loved the world.",
    source: str = "bible-api.com",
) -> MagicMock:
    snap = MagicMock()
    snap.exists = exists
    snap.to_dict.return_value = {
        "reference": reference,
        "translation": translation,
        "text": text,
        "source": source,
    }
    return snap


def _verse_db(snap: MagicMock) -> MagicMock:
    db = MagicMock()
    db.collection.return_value.document.return_value.get.return_value = snap
    return db


def test_daily_verse_happy_path() -> None:
    snap = _verse_doc_snap()
    with patch("app.routers.verse.get_firestore", return_value=_verse_db(snap)):
        client = TestClient(_verse_app())
        res = client.get(
            "/api/daily-verse?day=2026-05-03",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "day": "2026-05-03",
        "reference": "John 3:16",
        "translation": "KJV",
        "text": "For God so loved the world.",
        "source": "bible-api.com",
    }


def test_daily_verse_defaults_to_today() -> None:
    snap = _verse_doc_snap()
    db = _verse_db(snap)
    with patch("app.routers.verse.get_firestore", return_value=db):
        client = TestClient(_verse_app())
        res = client.get("/api/daily-verse", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    # Document key must match today's UTC date — verify the lookup path.
    expected_day = datetime.now(UTC).strftime("%Y-%m-%d")
    db.collection.assert_called_once_with("daily_verse")
    db.collection.return_value.document.assert_called_once_with(expected_day)
    assert res.json()["day"] == expected_day


def test_daily_verse_404_when_doc_missing() -> None:
    snap = _verse_doc_snap(exists=False)
    with patch("app.routers.verse.get_firestore", return_value=_verse_db(snap)):
        client = TestClient(_verse_app())
        res = client.get(
            "/api/daily-verse?day=2026-05-03",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "verse_not_found"
    assert res.json()["error"]["details"] == {"day": "2026-05-03"}


def _verse_db_with_fallback(today_snap: MagicMock, fallback_snap: MagicMock) -> MagicMock:
    """Mock DB that returns `today_snap` for .document(today).get() and
    `fallback_snap` (its .id + .to_dict()) from .order_by().limit().stream()."""
    coll = MagicMock()
    coll.document.return_value.get.return_value = today_snap
    coll.order_by.return_value.limit.return_value.stream.return_value = iter([fallback_snap])
    db = MagicMock()
    db.collection.return_value = coll
    return db


def test_daily_verse_falls_back_to_most_recent_when_today_missing() -> None:
    """When the default no-day call lands during the 00:00–07:00 UTC window
    before the daily job has written today's doc, the endpoint must return
    the most recent doc with 200 instead of 404 — otherwise the frontend
    hides the verse panel for the entire US evening."""
    today_missing = _verse_doc_snap(exists=False)
    fallback = MagicMock()
    fallback.id = "2026-05-24"
    fallback.to_dict.return_value = {
        "reference": "1 Peter 2:9",
        "translation": "KJV",
        "text": "But you are a chosen race…",
        "source": "bible-api.com",
    }
    db = _verse_db_with_fallback(today_missing, fallback)
    with patch("app.routers.verse.get_firestore", return_value=db):
        client = TestClient(_verse_app())
        res = client.get("/api/daily-verse", headers={"Authorization": "Bearer t"})

    assert res.status_code == 200
    body = res.json()
    # The response carries the *fallback's* real day so the client can show
    # it accurately, not today's date.
    assert body["day"] == "2026-05-24"
    assert body["reference"] == "1 Peter 2:9"
    assert body["translation"] == "KJV"
    # Confirm the fallback path was actually exercised.
    db.collection.return_value.order_by.assert_called_once()


def test_daily_verse_404_when_collection_empty() -> None:
    """Cold-start: no docs at all → 404 (only condition under which the
    no-day path may still 404)."""
    today_missing = _verse_doc_snap(exists=False)
    coll = MagicMock()
    coll.document.return_value.get.return_value = today_missing
    coll.order_by.return_value.limit.return_value.stream.return_value = iter([])
    db = MagicMock()
    db.collection.return_value = coll
    with patch("app.routers.verse.get_firestore", return_value=db):
        client = TestClient(_verse_app())
        res = client.get("/api/daily-verse", headers={"Authorization": "Bearer t"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "verse_not_found"


def test_daily_verse_explicit_day_still_404s_when_missing() -> None:
    """Explicit ?day=... lookups remain strict: missing → 404 (no fallback).
    Historical queries are deliberate, so missing means missing."""
    today_missing = _verse_doc_snap(exists=False)
    fallback = MagicMock()
    fallback.id = "2026-05-24"
    fallback.to_dict.return_value = {"reference": "Psalm 23:1"}
    db = _verse_db_with_fallback(today_missing, fallback)
    with patch("app.routers.verse.get_firestore", return_value=db):
        client = TestClient(_verse_app())
        res = client.get(
            "/api/daily-verse?day=2024-01-15",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 404
    # Crucially, the fallback path must NOT be touched for explicit-day queries.
    db.collection.return_value.order_by.assert_not_called()


def test_daily_verse_requires_auth() -> None:
    client = TestClient(_verse_app(authed=False))
    res = client.get("/api/daily-verse")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_daily_verse_invalid_day_param() -> None:
    client = TestClient(_verse_app())
    res = client.get(
        "/api/daily-verse?day=2026/05/03",
        headers={"Authorization": "Bearer t"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_day"


def test_load_calendar_resolves_bundled_file() -> None:
    """verse_calendar.json must be reachable at the path shipped in the container image."""
    from app.services.verse import _CALENDAR_PATH

    assert _CALENDAR_PATH.exists(), f"verse_calendar.json not found at {_CALENDAR_PATH}"
    cal = verse_svc._load_calendar()
    assert isinstance(cal.get("rotation"), list)
    assert len(cal["rotation"]) > 0  # type: ignore[arg-type]
    assert isinstance(cal.get("calendar"), dict)


def test_daily_verse_normalises_unexpected_translation() -> None:
    snap = _verse_doc_snap(translation="ESV", source="other")
    with patch("app.routers.verse.get_firestore", return_value=_verse_db(snap)):
        client = TestClient(_verse_app())
        res = client.get(
            "/api/daily-verse?day=2026-05-03",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["translation"] == "KJV"
    assert body["source"] == "bible-api.com"


def test_daily_verse_normalises_legacy_web_translation() -> None:
    """Legacy daily_verse docs written with translation='WEB' should be served
    as 'KJV' after the translation-policy change."""
    snap = _verse_doc_snap(translation="WEB")
    with patch("app.routers.verse.get_firestore", return_value=_verse_db(snap)):
        client = TestClient(_verse_app())
        res = client.get(
            "/api/daily-verse?day=2026-05-03",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["translation"] == "KJV"


# ── Song of Solomon exclusion ────────────────────────────────────────────


@pytest.mark.parametrize(
    "reference,expected",
    [
        ("Song of Solomon 2:1", True),
        ("Song of Solomon 4:1-7", True),
        ("Song of Songs 1:1", True),
        ("song of songs 1:1", True),
        ("CANTICLES 2:4", True),
        ("Canticles 8:6", True),
        ("John 3:16", False),
        ("1 John 4:8", False),
        ("Psalm 23:1", False),
        ("Romans 8:28", False),
        ("Songs 1:1", False),  # not an actual book — must not be falsely matched
    ],
)
def test_is_excluded_reference(reference: str, expected: bool) -> None:
    assert verse_svc.is_excluded_reference(reference) is expected


def test_scrub_excluded_filters_calendar_and_rotation() -> None:
    """Calendar overrides and rotation entries in excluded books are dropped at load time."""
    src = "calendar-override"
    raw = {
        "calendar": {
            "12-25": {"reference": "Luke 2:11", "translation": "KJV", "source": src},
            "02-14": {"reference": "Song of Solomon 2:10", "translation": "KJV", "source": src},
            "06-01": {"reference": "Song of Songs 8:6-7", "translation": "KJV", "source": src},
        },
        "rotation": [
            "John 3:16",
            "Song of Solomon 2:1",
            "Romans 8:28",
            "Canticles 1:2",
            "Psalm 23:1",
        ],
    }

    scrubbed = verse_svc._scrub_excluded(raw)

    assert "12-25" in scrubbed["calendar"]  # type: ignore[operator]
    assert "02-14" not in scrubbed["calendar"]  # type: ignore[operator]
    assert "06-01" not in scrubbed["calendar"]  # type: ignore[operator]
    assert scrubbed["rotation"] == ["John 3:16", "Romans 8:28", "Psalm 23:1"]


def test_fetch_verse_calendar_override_excluded_raises() -> None:
    """Even if a Song of Solomon entry somehow slips past the loader, fetch must refuse."""
    fixed_date = datetime(2026, 2, 14, tzinfo=UTC)
    # Patch _load_calendar directly with an unscrubbed calendar that the
    # production loader would reject — proves the in-flight guard works too.
    poisoned = {
        "calendar": {
            "02-14": {
                "reference": "Song of Solomon 2:10",
                "translation": "KJV",
                "source": "calendar-override",
            },
        },
        "rotation": ["John 3:16"],
    }
    with _patch_calendar(poisoned), _patch_api("text") as mock_api:
        with pytest.raises(RuntimeError, match="excluded book"):
            verse_svc.fetch_verse_for_today(today=fixed_date)
    mock_api.assert_not_called()


def test_bundled_calendar_has_no_excluded_books() -> None:
    """Sanity: the shipped verse_calendar.json must not select any excluded book.

    This is the load-bearing assertion that no Song of Solomon reference can
    be selected/served from the calendar/rotation pair we ship today, and
    will fail loudly if a future edit slips one through.
    """
    import json as _json
    from pathlib import Path as _Path

    backend_root = _Path(__file__).resolve().parent.parent
    files = [
        backend_root / "app" / "data" / "verse_calendar.json",
        backend_root.parent / "infra" / "seed" / "verse_calendar.json",
    ]

    for path in files:
        assert path.exists(), f"missing {path}"
        raw = _json.loads(path.read_text())
        for key, entry in (raw.get("calendar") or {}).items():
            ref = entry.get("reference", "")
            assert not verse_svc.is_excluded_reference(
                ref
            ), f"{path.name}: calendar entry {key!r} ({ref!r}) is an excluded book"
        for ref in raw.get("rotation") or []:
            assert not verse_svc.is_excluded_reference(
                ref
            ), f"{path.name}: rotation entry {ref!r} is an excluded book"


def test_fetch_verse_never_returns_excluded_reference() -> None:
    """End-to-end: walk every day of a leap year through fetch_verse_for_today
    using the real bundled calendar. None of the selected references may be
    from an excluded book."""
    from datetime import timedelta

    # Real bundled calendar — _load_calendar's cache_clear in the autouse
    # fixture forces a fresh load from disk.
    start = datetime(2024, 1, 1, tzinfo=UTC)
    with _patch_api("text"):
        for day_of_year in range(366):
            d = start + timedelta(days=day_of_year)
            doc = verse_svc.fetch_verse_for_today(today=d)
            assert not verse_svc.is_excluded_reference(
                doc.reference
            ), f"day {d.date()} selected excluded reference {doc.reference!r}"


# ── Translation restriction ──────────────────────────────────────────────


def test_default_translation_is_kjv() -> None:
    """The rotation path (no override) must request KJV from bible-api.com."""
    fixed_date = datetime(2025, 6, 15, tzinfo=UTC)
    with _patch_calendar(_SAMPLE_CALENDAR), _patch_api("text") as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)
    assert doc.translation == "KJV"
    args, _ = mock_api.call_args
    assert args[1] == "KJV"


def test_calendar_override_forces_kjv_regardless_of_data() -> None:
    """Even if the calendar JSON specified a non-KJV translation, the service
    must coerce to KJV — we never ship copyrighted translation text."""
    cal = {
        "calendar": {
            "12-25": {
                "reference": "Luke 2:11",
                "translation": "ESV",  # not allowed
                "source": "calendar-override",
            },
        },
        "rotation": ["John 3:16"],
    }
    fixed_date = datetime(2025, 12, 25, tzinfo=UTC)
    with _patch_calendar(cal), _patch_api("text") as mock_api:
        doc = verse_svc.fetch_verse_for_today(today=fixed_date)
    assert doc.translation == "KJV"
    mock_api.assert_called_once_with("Luke 2:11", "KJV")
