"""Shared helpers for the admin-approval signup flow.

See `docs/adr/0011-admin-approval-signup.md`. The `applications/{uid}`
collection is the queueing object; `users/{uid}` is the load-bearing
"approved member" artifact. Both this service and the admin router
share the dob-to-age computation and the doc-to-view hydration.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from app.models.applications import ApplicationView

# Minimum age accepted by JACOB (terms.md § Who can use JACOB). Under-13
# applicants are refused at the application-submit endpoint before any
# admin sees them. The frontend also gates this client-side, but the
# server check is the load-bearing one.
MIN_AGE: int = 13


def compute_age(dob: date, *, today: date | None = None) -> int:
    """Whole-year age on `today` (default: now in UTC).

    Calendar-year math: subtract years, then subtract one if the
    birthday hasn't happened yet this year. Avoids floating point and
    the "365.25" rounding bug that drifts on leap years.
    """
    ref = today or datetime.now(UTC).date()
    years = ref.year - dob.year
    if (ref.month, ref.day) < (dob.month, dob.day):
        years -= 1
    return years


def is_minor(dob: date, *, today: date | None = None) -> bool:
    """True iff the applicant is under 18 on `today`."""
    return compute_age(dob, today=today) < 18


def ts_to_dt(value: Any) -> datetime | None:
    """Firestore Timestamp / datetime / None → datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    converter = getattr(value, "ToDatetime", None)
    if callable(converter):
        try:
            result = converter(tzinfo=UTC)
        except TypeError:
            result = converter()
        if isinstance(result, datetime):
            return result if result.tzinfo else result.replace(tzinfo=UTC)
    return None


def _parse_dob(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def application_doc_to_view(uid: str, data: dict[str, Any]) -> ApplicationView:
    """Hydrate an `ApplicationView` from an `applications/{uid}` snapshot dict."""
    dob = _parse_dob(data.get("dob"))
    age = compute_age(dob) if dob is not None else None
    minor_flag = bool(data.get("isMinor", False))
    return ApplicationView(
        uid=uid,
        email=data.get("email"),
        displayName=str(data.get("displayName") or ""),
        photoURL=data.get("photoURL"),
        dob=dob,
        age=age,
        isMinor=minor_flag,
        phone=data.get("phone"),
        location=data.get("location"),
        faithBackground=data.get("faithBackground"),
        status=str(data.get("status") or "pending"),
        createdAt=ts_to_dt(data.get("createdAt")),
        submittedAt=ts_to_dt(data.get("submittedAt")),
        decidedAt=ts_to_dt(data.get("decidedAt")),
        decidedBy=data.get("decidedBy"),
        parentalConsentObtained=(
            None
            if data.get("parentalConsentObtained") is None
            else bool(data.get("parentalConsentObtained"))
        ),
        parentalConsentNotes=str(data.get("parentalConsentNotes") or ""),
        rejectionReason=str(data.get("rejectionReason") or ""),
        grandfathered=bool(data.get("grandfathered", False)),
    )
