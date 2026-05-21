"""Devotionals + reading-plans router (T51).

* `GET  /api/devotionals` — list (any signed-in)
* `GET  /api/devotionals/{slug}` — detail
* `GET  /api/reading-plans` — list (summary; days dropped)
* `GET  /api/reading-plans/{slug}` — detail with day list
* `GET  /api/reading-plans/{slug}/progress` — caller's progress
* `POST /api/reading-plans/{slug}/progress/mark` — mark a day complete

Direct Firestore access on `devotionals/`, `reading_plans/`, and
`users/{uid}/plan_progress/` is denied per M6.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import (
    DEVOTIONAL_LIST,
    PLAN_PROGRESS_READ,
    PLAN_PROGRESS_WRITE,
)
from app.middleware.rate_limit import limiter
from app.models.devotionals import (
    ActivePlanToday,
    Audience,
    Devotional,
    DevotionalListResponse,
    MarkDayCompleteRequest,
    MarkDayCompleteResponse,
    PlanProgress,
    ReadingPlan,
    ReadingPlanDay,
    ReadingPlanListResponse,
    ReadingPlanSummary,
)
from app.models.user import CurrentUser
from app.services import devotionals as devotionals_service
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["devotionals"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_str(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        result: str = ts.isoformat()
        return result
    except AttributeError:
        return str(ts)


def _doc_to_devotional(snap: Any) -> Devotional:
    data: dict[str, Any] = snap.to_dict() or {}
    return Devotional(
        slug=str(data.get("slug") or snap.id),
        title=str(data.get("title", "")),
        scriptureRef=str(data.get("scriptureRef", "")),
        body=str(data.get("body", "")),
        audioUrl=data.get("audioUrl"),
        sourceAttribution=str(data.get("sourceAttribution", "")),
        publishedAt=_ts_to_str(data.get("publishedAt")),
        audience=data.get("audience", "christian"),
        schemaVersion=int(data.get("schemaVersion", 1) or 1),
    )


def _doc_to_plan(snap: Any) -> ReadingPlan:
    data: dict[str, Any] = snap.to_dict() or {}
    raw_days = data.get("days") or []
    days = [
        ReadingPlanDay(
            dayNumber=int(d.get("dayNumber", 0) or 0),
            scriptureRef=str(d.get("scriptureRef", "")),
            prompt=str(d.get("prompt", "")),
        )
        for d in raw_days
    ]
    return ReadingPlan(
        slug=str(data.get("slug") or snap.id),
        title=str(data.get("title", "")),
        description=str(data.get("description", "")),
        days=days,
        duration=int(data.get("duration") or len(days)),
        audience=data.get("audience", "christian"),
        publishedAt=_ts_to_str(data.get("publishedAt")),
        schemaVersion=int(data.get("schemaVersion", 1) or 1),
    )


def _doc_to_plan_summary(snap: Any) -> ReadingPlanSummary:
    data: dict[str, Any] = snap.to_dict() or {}
    return ReadingPlanSummary(
        slug=str(data.get("slug") or snap.id),
        title=str(data.get("title", "")),
        description=str(data.get("description", "")),
        duration=int(data.get("duration") or len(data.get("days") or [])),
        audience=data.get("audience", "christian"),
        publishedAt=_ts_to_str(data.get("publishedAt")),
    )


# ── devotionals ──────────────────────────────────────────────────────────────


@router.get("/api/devotionals", response_model=DevotionalListResponse)
@limiter.limit(DEVOTIONAL_LIST)
def list_devotionals(
    request: Request,
    response: Response,
    audience: Audience | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> DevotionalListResponse:
    db = _db()
    query: Any = db.collection("devotionals")
    if audience is not None:
        query = query.where("audience", "==", audience)
    snaps = list(query.stream())
    devotionals = [_doc_to_devotional(s) for s in snaps]
    devotionals.sort(key=lambda d: d.publishedAt or "", reverse=True)
    return DevotionalListResponse(devotionals=devotionals)


@router.get("/api/devotionals/{slug}", response_model=Devotional)
def get_devotional(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> Devotional:
    db = _db()
    snap = db.collection("devotionals").document(slug).get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="devotional_not_found",
            message=f"Devotional {slug!r} not found",
        )
    return _doc_to_devotional(snap)


# ── reading plans ────────────────────────────────────────────────────────────


@router.get("/api/reading-plans", response_model=ReadingPlanListResponse)
@limiter.limit(DEVOTIONAL_LIST)
def list_reading_plans(
    request: Request,
    response: Response,
    audience: Audience | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> ReadingPlanListResponse:
    db = _db()
    query: Any = db.collection("reading_plans")
    if audience is not None:
        query = query.where("audience", "==", audience)
    snaps = list(query.stream())
    plans = [_doc_to_plan_summary(s) for s in snaps]
    plans.sort(key=lambda p: p.publishedAt or "", reverse=True)
    return ReadingPlanListResponse(plans=plans)


@router.get("/api/reading-plans/{slug}", response_model=ReadingPlan)
def get_reading_plan(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ReadingPlan:
    db = _db()
    snap = db.collection("reading_plans").document(slug).get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="plan_not_found",
            message=f"Reading plan {slug!r} not found",
        )
    return _doc_to_plan(snap)


@router.get(
    "/api/reading-plans/{slug}/progress",
    response_model=PlanProgress,
)
@limiter.limit(PLAN_PROGRESS_READ)
def get_plan_progress(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> PlanProgress:
    db = _db()
    progress = devotionals_service.get_progress(db, uid=user.uid, plan_slug=slug)
    if progress is None:
        # Empty progress is a valid "not started" state — return zeros.
        return PlanProgress(
            planSlug=slug,
            startedAt=None,
            completedDays=[],
            streak=0,
            lastCompletedAt=None,
        )
    return PlanProgress(
        planSlug=slug,
        startedAt=_ts_to_str(progress.get("startedAt")),
        completedDays=list(progress.get("completedDays") or []),
        streak=int(progress.get("streak") or 0),
        lastCompletedAt=_ts_to_str(progress.get("lastCompletedAt")),
    )


@router.post(
    "/api/reading-plans/{slug}/progress/mark",
    response_model=MarkDayCompleteResponse,
)
@limiter.limit(PLAN_PROGRESS_WRITE)
def mark_day_complete(
    slug: str,
    request: Request,
    response: Response,
    body: MarkDayCompleteRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> MarkDayCompleteResponse:
    db = _db()

    # Pull user locale from the user doc so streak math respects it.
    user_snap = db.collection("users").document(user.uid).get()
    locale: str | None = None
    if user_snap.exists:
        locale = (user_snap.to_dict() or {}).get("locale")

    try:
        completed, streak, last_at = devotionals_service.mark_day_complete(
            db,
            uid=user.uid,
            plan_slug=slug,
            day_number=body.dayNumber,
            locale=locale,
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "plan_not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="plan_not_found",
                message=f"Reading plan {slug!r} not found",
            ) from exc
        if msg == "day_out_of_range":
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="day_out_of_range",
                message="dayNumber is outside the plan's day range",
            ) from exc
        raise

    return MarkDayCompleteResponse(
        planSlug=slug,
        completedDays=completed,
        streak=streak,
        lastCompletedAt=_ts_to_str(last_at) or "",
    )


# ── home-surface aggregator ──────────────────────────────────────────────────


@router.get("/api/users/me/reading-plan-today", response_model=ActivePlanToday)
@limiter.limit(PLAN_PROGRESS_READ)
def reading_plan_today(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ActivePlanToday:
    """Pick the user's active reading plan and its next uncompleted day.

    Composite call for the /home "Today" surface — avoids the
    list-plans + per-plan-progress fan-out a naive client would do.
    Returns an empty payload (plan=None) when the user has no
    plan_progress; the frontend renders a "start a plan" empty state.
    """
    db = _db()
    progress_docs = list(
        db.collection("users").document(user.uid).collection("plan_progress").stream()
    )
    if not progress_docs:
        return ActivePlanToday(plan=None, nextDay=None)

    def _engaged_at(snap: Any) -> str:
        # Sort key: most recent activity first. lastCompletedAt is the
        # strongest signal; startedAt as fallback for plans the user
        # opened but hasn't marked a day on.
        data = snap.to_dict() or {}
        last = data.get("lastCompletedAt")
        started = data.get("startedAt")
        for cand in (last, started):
            if cand is None:
                continue
            try:
                result: str = cand.isoformat()
                return result
            except AttributeError:
                return str(cand)
        return ""

    progress_docs.sort(key=_engaged_at, reverse=True)
    top = progress_docs[0]
    top_data = top.to_dict() or {}
    plan_slug = str(top_data.get("planSlug") or top.id)

    plan_snap = db.collection("reading_plans").document(plan_slug).get()
    if not plan_snap.exists:
        # Stale progress for a deleted plan — treat as no active plan
        # rather than 500.
        return ActivePlanToday(plan=None, nextDay=None)

    plan_data = plan_snap.to_dict() or {}
    raw_days = plan_data.get("days") or []
    completed = sorted({int(d) for d in (top_data.get("completedDays") or [])})
    completed_set = set(completed)

    next_day_payload: ReadingPlanDay | None = None
    all_done = False
    for d in raw_days:
        day_number = int(d.get("dayNumber", 0) or 0)
        if day_number in completed_set:
            continue
        next_day_payload = ReadingPlanDay(
            dayNumber=day_number,
            scriptureRef=str(d.get("scriptureRef", "")),
            prompt=str(d.get("prompt", "")),
        )
        break
    else:
        # Loop fell through with no break — every day is complete.
        all_done = len(raw_days) > 0

    return ActivePlanToday(
        plan=ReadingPlanSummary(
            slug=plan_slug,
            title=str(plan_data.get("title", "")),
            description=str(plan_data.get("description", "")),
            duration=int(plan_data.get("duration") or len(raw_days)),
            audience=plan_data.get("audience", "christian"),
            publishedAt=_ts_to_str(plan_data.get("publishedAt")),
        ),
        nextDay=next_day_payload,
        completedDays=completed,
        streak=int(top_data.get("streak") or 0),
        lastCompletedAt=_ts_to_str(top_data.get("lastCompletedAt")),
        allDaysComplete=all_done,
    )
