"""Devotionals + reading-plans service (T51).

Handles the streak-math invariants in one place so the rules don't
have to (and the M6 backend-mediated architecture stays consistent).

Streak rules:
* Mark complete with daysGap == 0 (already completed today): no-op.
* daysGap == 1 → streak += 1.
* daysGap == 2 → streak += 1 (1-day grace window).
* daysGap >= 3 → streak resets to 1.

`daysGap` is computed against the user's locale-day boundary if a
locale is set; otherwise UTC. We compare *dates*, not absolute times,
so DST transitions don't break the streak.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


_LOCALE_TZ = {
    "en": "America/Los_Angeles",
    "es": "America/Los_Angeles",
}


def _user_tz(locale: str | None) -> Any:
    """Pick a timezone for the streak math.

    No-op fallback to UTC when a locale isn't set. The exact mapping
    matters less than consistency: we compare dates, so a small zone
    drift can't break a streak — it can only shift the cutoff hour.
    """
    if not locale:
        return UTC
    tz_name = _LOCALE_TZ.get(locale.split("-")[0], "UTC")
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return UTC


def _to_date(value: Any, tz: Any) -> date | None:
    """Normalize a Firestore timestamp / datetime to a *date* in `tz`."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        result: date = value.astimezone(tz).date()
        return result
    return None


def compute_streak_update(
    *,
    today: date,
    last_completed_date: date | None,
    previous_streak: int,
) -> tuple[int, bool]:
    """Return `(new_streak, should_increment_completed_days)`.

    * `should_increment_completed_days` is False only when the user has
      already marked a day complete *today* (daysGap == 0). The caller
      uses that to decide whether to re-write `completedDays`.
    """
    if last_completed_date is None:
        return 1, True
    if today == last_completed_date:
        # Same calendar day — already counted; no streak change.
        return previous_streak, False
    if today < last_completed_date:
        # Clock skew or historical edit: tolerate without resetting.
        return previous_streak, True
    days_gap = (today - last_completed_date).days
    if days_gap == 1 or days_gap == 2:
        return previous_streak + 1, True
    return 1, True


def mark_day_complete(
    db: Any,
    *,
    uid: str,
    plan_slug: str,
    day_number: int,
    locale: str | None = None,
    now: datetime | None = None,
) -> tuple[list[int], int, datetime]:
    """Mark `day_number` complete on a user's reading-plan progress.

    Returns `(completed_days, new_streak, last_completed_at)`. Raises
    `ValueError("plan_not_found")` / `"day_out_of_range")` for caller
    handling.
    """
    plan_ref = db.collection("reading_plans").document(plan_slug)
    plan_snap = plan_ref.get()
    if not plan_snap.exists:
        raise ValueError("plan_not_found")
    plan_data = plan_snap.to_dict() or {}
    duration = int(plan_data.get("duration") or 0)
    if not 1 <= day_number <= duration:
        raise ValueError("day_out_of_range")

    progress_ref = (
        db.collection("users").document(uid).collection("plan_progress").document(plan_slug)
    )
    progress_snap = progress_ref.get()
    progress_data = progress_snap.to_dict() if progress_snap.exists else {}
    progress_data = progress_data or {}

    tz = _user_tz(locale)
    now = now or datetime.now(UTC)
    today = now.astimezone(tz).date()
    last_at = _to_date(progress_data.get("lastCompletedAt"), tz)
    previous_streak = int(progress_data.get("streak") or 0)

    new_streak, increment = compute_streak_update(
        today=today,
        last_completed_date=last_at,
        previous_streak=previous_streak,
    )

    completed_days: list[int] = list(progress_data.get("completedDays") or [])
    if increment and day_number not in completed_days:
        completed_days.append(day_number)
        completed_days.sort()

    payload = {
        "planSlug": plan_slug,
        "startedAt": progress_data.get("startedAt") or fb_firestore.SERVER_TIMESTAMP,
        "completedDays": completed_days,
        "streak": new_streak,
        "lastCompletedAt": now if increment else progress_data.get("lastCompletedAt") or now,
    }
    progress_ref.set(payload, merge=False)
    last_at_value = payload["lastCompletedAt"]
    if not isinstance(last_at_value, datetime):
        last_at_value = now
    return completed_days, new_streak, last_at_value


def get_progress(db: Any, *, uid: str, plan_slug: str) -> dict[str, Any] | None:
    snap = (
        db.collection("users").document(uid).collection("plan_progress").document(plan_slug).get()
    )
    if not snap.exists:
        return None
    data = snap.to_dict()
    return data if isinstance(data, dict) else None
