"""Devotionals + reading-plans router (T51).

* `GET    /api/devotionals` — list (any signed-in)
* `GET    /api/devotionals/{slug}` — detail
* `POST   /api/devotionals` — create (ministry_owner only)
* `PATCH  /api/devotionals/{slug}` — update (ministry_owner only)
* `DELETE /api/devotionals/{slug}` — delete (ministry_owner only)
* `GET    /api/reading-plans` — list (summary; days dropped)
* `GET    /api/reading-plans/{slug}` — detail with day list
* `POST   /api/reading-plans` — create (admin only)
* `PATCH  /api/reading-plans/{slug}` — update (admin only)
* `DELETE /api/reading-plans/{slug}` — delete (admin only)
* `GET    /api/reading-plans/{slug}/progress` — caller's progress
* `POST   /api/reading-plans/{slug}/progress/mark` — mark a day complete

Direct Firestore access on `devotionals/`, `reading_plans/`, and
`users/{uid}/plan_progress/` is denied per M6.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin, require_ministry_owner, require_not_banned
from app.errors import APIError
from app.limits import (
    DEVOTIONAL_LIST,
    DEVOTIONAL_MUTATION,
    PLAN_MUTATION,
    PLAN_PROGRESS_READ,
    PLAN_PROGRESS_WRITE,
)
from app.middleware.rate_limit import limiter
from app.models.devotionals import (
    ActivePlanToday,
    Audience,
    Devotional,
    DevotionalCreateRequest,
    DevotionalListResponse,
    DevotionalUpdateRequest,
    MarkDayCompleteRequest,
    MarkDayCompleteResponse,
    PlanProgress,
    ReadingPlan,
    ReadingPlanCreateRequest,
    ReadingPlanDay,
    ReadingPlanListResponse,
    ReadingPlanSummary,
    ReadingPlanUpdateRequest,
)
from app.models.user import CurrentUser
from app.services import devotionals as devotionals_service
from app.services.audit import write_audit_log
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


def _parse_date_str(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=UTC) if "T" not in s else dt.astimezone(UTC)
    except ValueError:
        return None


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


@router.post("/api/devotionals", response_model=Devotional, status_code=status.HTTP_201_CREATED)
@limiter.limit(DEVOTIONAL_MUTATION)
def create_devotional(
    request: Request,
    response: Response,
    body: DevotionalCreateRequest,
    user: CurrentUser = Depends(require_ministry_owner),
) -> Devotional:
    db = _db()
    ref = db.collection("devotionals").document(body.slug)
    if ref.get().exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="slug_taken",
            message=f"A devotional with slug {body.slug!r} already exists",
        )
    published_at = _parse_date_str(body.publishedAt) or datetime.now(UTC)
    ref.set(
        {
            "slug": body.slug,
            "title": body.title,
            "scriptureRef": body.scriptureRef,
            "body": body.body,
            "audioUrl": body.audioUrl,
            "sourceAttribution": body.sourceAttribution,
            "publishedAt": published_at,
            "audience": body.audience,
            "schemaVersion": 1,
            "createdBy": user.uid,
        }
    )
    logger.info("devotional created slug=%s actor=%s", body.slug, user.uid)
    return _doc_to_devotional(ref.get())


@router.patch("/api/devotionals/{slug}", response_model=Devotional)
@limiter.limit(DEVOTIONAL_MUTATION)
def update_devotional(
    slug: str,
    request: Request,
    response: Response,
    body: DevotionalUpdateRequest,
    user: CurrentUser = Depends(require_ministry_owner),
) -> Devotional:
    db = _db()
    ref = db.collection("devotionals").document(slug)
    if not ref.get().exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="devotional_not_found",
            message=f"Devotional {slug!r} not found",
        )
    patch: dict[str, Any] = {}
    if body.title is not None:
        patch["title"] = body.title
    if body.scriptureRef is not None:
        patch["scriptureRef"] = body.scriptureRef
    if body.body is not None:
        patch["body"] = body.body
    if "audioUrl" in body.model_fields_set:
        patch["audioUrl"] = body.audioUrl
    if body.sourceAttribution is not None:
        patch["sourceAttribution"] = body.sourceAttribution
    if body.publishedAt is not None:
        parsed = _parse_date_str(body.publishedAt)
        if parsed is not None:
            patch["publishedAt"] = parsed
    if body.audience is not None:
        patch["audience"] = body.audience
    if patch:
        ref.update(patch)
    logger.info("devotional updated slug=%s actor=%s fields=%s", slug, user.uid, list(patch))
    return _doc_to_devotional(ref.get())


@router.delete("/api/devotionals/{slug}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(DEVOTIONAL_MUTATION)
def delete_devotional(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_ministry_owner),
) -> Response:
    db = _db()
    ref = db.collection("devotionals").document(slug)
    if not ref.get().exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="devotional_not_found",
            message=f"Devotional {slug!r} not found",
        )
    ref.delete()
    logger.info("devotional deleted slug=%s actor=%s", slug, user.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.post(
    "/api/reading-plans",
    response_model=ReadingPlan,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(PLAN_MUTATION)
def create_reading_plan(
    body: ReadingPlanCreateRequest,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_admin),
) -> ReadingPlan:
    db = _db()
    existing = db.collection("reading_plans").document(body.slug).get()
    if existing.exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="slug_taken",
            message=f"Reading plan slug {body.slug!r} is already in use",
        )
    days_data = [
        {
            "dayNumber": i + 1,
            "scriptureRef": d.scriptureRef,
            "prompt": d.prompt,
        }
        for i, d in enumerate(body.days)
    ]
    plan_ref = db.collection("reading_plans").document(body.slug)
    plan_ref.set(
        {
            "slug": body.slug,
            "title": body.title,
            "description": body.description,
            "days": days_data,
            "duration": len(body.days),
            "audience": body.audience,
            "publishedAt": fb_firestore.SERVER_TIMESTAMP,
            "schemaVersion": 1,
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="reading_plan_create",
        target_ref=f"reading_plans/{body.slug}",
        payload={"duration": len(body.days), "audience": body.audience},
    )
    return _doc_to_plan(plan_ref.get())


@router.patch("/api/reading-plans/{slug}", response_model=ReadingPlan)
@limiter.limit(PLAN_MUTATION)
def update_reading_plan(
    slug: str,
    body: ReadingPlanUpdateRequest,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_admin),
) -> ReadingPlan:
    db = _db()
    plan_ref = db.collection("reading_plans").document(slug)
    snap = plan_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="plan_not_found",
            message=f"Reading plan {slug!r} not found",
        )
    update: dict[str, Any] = {}
    if body.title is not None:
        update["title"] = body.title
    if body.description is not None:
        update["description"] = body.description
    if body.audience is not None:
        update["audience"] = body.audience
    if body.days is not None:
        update["days"] = [
            {"dayNumber": i + 1, "scriptureRef": d.scriptureRef, "prompt": d.prompt}
            for i, d in enumerate(body.days)
        ]
        update["duration"] = len(body.days)
    if not update:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_update",
            message="No mutable fields supplied",
        )
    plan_ref.update(update)
    write_audit_log(
        actor_uid=user.uid,
        action="reading_plan_update",
        target_ref=f"reading_plans/{slug}",
        payload={"changedKeys": sorted(update.keys())},
    )
    return _doc_to_plan(plan_ref.get())


@router.delete("/api/reading-plans/{slug}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(PLAN_MUTATION)
def delete_reading_plan(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_admin),
) -> Response:
    db = _db()
    plan_ref = db.collection("reading_plans").document(slug)
    snap = plan_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="plan_not_found",
            message=f"Reading plan {slug!r} not found",
        )
    plan_ref.delete()
    write_audit_log(
        actor_uid=user.uid,
        action="reading_plan_delete",
        target_ref=f"reading_plans/{slug}",
        payload={},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
