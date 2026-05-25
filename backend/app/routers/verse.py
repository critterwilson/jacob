"""Daily-verse router — M1 of the data-layer migration.

Thin façade over the cached `daily_verse/{YYYY-MM-DD}` doc that the Cloud
Run Job (`infra/scheduled/daily_verse.py`) writes once per day. Replaces
the browser's direct Firestore read at `firestore.rules:646`.

The router only reads Firestore — generating a verse on-demand stays in
the daily job (see `app/services/verse.py`) so the bible-api.com circuit
breaker keeps protecting the backend from a paid-API runaway loop.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user
from app.errors import APIError
from app.models.user import CurrentUser
from app.models.verse import DailyVerseResponse
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(tags=["verse"])

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Only KJV is currently servable. Other translations in the policy set
# (ESV/NIV/NKJV/NLT/NRSV) are copyrighted and would require a publisher
# license. Legacy WEB docs written before the policy change are normalised
# to KJV — the historic text may not match the label, but for past-day
# lookups this is acceptable transient drift.
_ALLOWED_TRANSLATIONS = {"KJV"}
_ALLOWED_SOURCES = {"bible-api.com", "calendar-override"}


def _today_utc() -> str:
    # The daily job keys on UTC (`infra/scheduled/daily_verse.py:46-47`); match it.
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _most_recent_verse(db: Any) -> tuple[str, dict[str, Any]] | None:
    """Return (doc_id, fields) for the most recent `daily_verse/*` doc, or None.

    Doc IDs are `YYYY-MM-DD`, so a lexical-descending order on `__name__` is
    also chronological-descending. Used as the no-day fallback when today's
    UTC-keyed doc hasn't been written yet (the daily Cloud Run Job runs at
    07:00 UTC, leaving a 00:00–07:00 UTC window when "today" is missing —
    the entire evening for US users).
    """
    snaps = list(
        db.collection("daily_verse")
        .order_by("__name__", direction=fb_firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    if not snaps:
        return None
    snap = snaps[0]
    return snap.id, (snap.to_dict() or {})


@router.get("/api/daily-verse", response_model=DailyVerseResponse)
def get_daily_verse(
    request: Request,
    response: Response,
    day: str | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> DailyVerseResponse:
    if day is not None and not _DAY_RE.match(day):
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_day",
            message="day must be formatted as YYYY-MM-DD",
        )

    db = get_firestore()

    # Explicit day param: serve that exact doc or 404. Historical lookups
    # are deliberate, so missing means missing.
    if day is not None:
        snap: Any = db.collection("daily_verse").document(day).get()
        if not snap.exists:
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="verse_not_found",
                message="No verse has been published for this day yet",
                details={"day": day},
            )
        return _build_response(response, day, snap.to_dict() or {})

    # Default path (no `day` param): try today's UTC doc first, then fall
    # back to the most recent doc available. This MUST NOT 404 — otherwise
    # the frontend hides the verse panel every night during the 00:00–07:00
    # UTC window before the daily job runs.
    today = _today_utc()
    snap = db.collection("daily_verse").document(today).get()
    if snap.exists:
        return _build_response(response, today, snap.to_dict() or {})

    fallback = _most_recent_verse(db)
    if fallback is None:
        # Collection is genuinely empty (cold start). Nothing to serve.
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="verse_not_found",
            message="No verse has been published yet",
            details={"day": today},
        )
    fallback_day, data = fallback
    logger.info(
        "daily_verse_fallback_to_most_recent",
        extra={"requested_day": today, "served_day": fallback_day},
    )
    return _build_response(response, fallback_day, data)


def _build_response(response: Response, day_key: str, data: dict[str, Any]) -> DailyVerseResponse:
    translation = data.get("translation", "KJV")
    if translation not in _ALLOWED_TRANSLATIONS:
        translation = "KJV"
    source = data.get("source", "bible-api.com")
    if source not in _ALLOWED_SOURCES:
        source = "bible-api.com"

    response.headers["Cache-Control"] = "private, max-age=300, stale-if-error=600"
    return DailyVerseResponse(
        day=day_key,
        reference=str(data.get("reference") or ""),
        translation=translation,
        text=str(data.get("text") or ""),
        source=source,
    )
