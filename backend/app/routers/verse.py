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
    day_key = day or _today_utc()

    db = get_firestore()
    snap: Any = db.collection("daily_verse").document(day_key).get()
    if not snap.exists:
        # Cloud Run Job may not have run yet for the requested day; surface
        # 404 so the client can hide the verse panel quietly.
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="verse_not_found",
            message="No verse has been published for this day yet",
            details={"day": day_key},
        )

    data: dict[str, Any] = snap.to_dict() or {}
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
