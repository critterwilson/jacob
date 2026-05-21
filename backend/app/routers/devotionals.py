"""Devotionals + reading-plans router (T51).

Devotionals (post group-scoping):

* `GET    /api/devotionals` — list, merged across platform + caller's groups
* `GET    /api/devotionals/{slug}` — detail; group-scoped entries require
  membership in the named group (admins bypass).
* `POST   /api/devotionals` — create. Body's optional `groupId` decides
  authorship gate: ministry_owner for platform-wide, group leader for
  group-scoped. Admin can do either.
* `PATCH  /api/devotionals/{slug}` — same role rules as create, applied
  against the existing doc's `groupId`.
* `DELETE /api/devotionals/{slug}` — same.
* `GET    /api/groups/{gid}/devotionals` — list a single group's devotionals
  (members only). Used by the per-group devotionals surface.

Reading plans:

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

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    get_current_user,
    require_admin,
    require_member,
    require_not_banned,
)
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


def _doc_to_devotional(snap: Any, *, group_name: str | None = None) -> Devotional:
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
        groupId=data.get("groupId"),
        groupName=group_name,
        schemaVersion=int(data.get("schemaVersion", 1) or 1),
    )


# Firestore's `in` operator caps at 30 values; chunk longer lists.
_IN_CHUNK = 30


def _user_group_ids(db: Any, uid: str) -> list[str]:
    """Return every group ID the user is a member of.

    Reuses the established `collection_group("members").where("uid","==",uid)`
    pattern (see `users.recent_messages` / `users.my_orgs`). Cheap: one CG
    query bounded by the user's membership count.
    """
    gids: list[str] = []
    for snap in db.collection_group("members").where("uid", "==", uid).stream():
        parent_group = snap.reference.parent.parent
        if parent_group is not None:
            gids.append(parent_group.id)
    return gids


def _is_group_leader(db: Any, gid: str, uid: str) -> bool:
    """True iff the caller has a `members/{uid}` row with `role == "leader"`
    under `groups/{gid}`. Used by the create/update/delete authorization
    path because the body's `groupId` is not in the route, so the
    `require_leader` dep (which reads `gid` from the path) cannot be used."""
    group_snap = db.collection("groups").document(gid).get()
    if not getattr(group_snap, "exists", False):
        return False
    member_snap = db.collection("groups").document(gid).collection("members").document(uid).get()
    if not getattr(member_snap, "exists", False):
        return False
    role = (member_snap.to_dict() or {}).get("role")
    return role == "leader"


def _authorize_devotional_mutation(db: Any, user: CurrentUser, group_id: str | None) -> None:
    """Raise 403 unless the caller can mutate a devotional with this scope.

    Platform-wide (`group_id is None`): require `ministry_owner` or admin.
    Group-scoped: require leadership of that group, or admin (admin bypass
    matches the rest of the moderation surface — admins need to act on any
    group's content).
    """
    if bool(user.claims.get("admin")) is True:
        return
    if group_id is None:
        if user.claims.get("ministry_owner") is True:
            return
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Organization owner privileges required",
        )
    if _is_group_leader(db, group_id, user.uid):
        return
    raise APIError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="not_a_leader",
        message="Only leaders of this group can author devotionals here",
    )


def _group_name(db: Any, gid: str) -> str | None:
    snap = db.collection("groups").document(gid).get()
    if not getattr(snap, "exists", False):
        return None
    return str((snap.to_dict() or {}).get("name") or "") or None


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
    """Merged feed: platform-wide devotionals + devotionals authored in
    groups the caller is a member of. Other groups' devotionals stay
    invisible. One Firestore query per scope (platform = `groupId == None`,
    group = `groupId in [...]`) rather than per-group fan-out.
    """
    db = _db()
    platform_query: Any = db.collection("devotionals").where("groupId", "==", None)
    if audience is not None:
        platform_query = platform_query.where("audience", "==", audience)
    platform_snaps = list(platform_query.stream())
    devotionals: list[Devotional] = [_doc_to_devotional(s) for s in platform_snaps]

    gids = _user_group_ids(db, user.uid)
    if gids:
        # Resolve group names once so we can label each merged entry.
        # Misses (a deleted group) fall through with a null name — the
        # devotional was authored before the group was archived and we
        # don't want to drop it from the feed.
        name_by_gid: dict[str, str | None] = {}
        for chunk_start in range(0, len(gids), _IN_CHUNK):
            chunk = gids[chunk_start : chunk_start + _IN_CHUNK]
            q: Any = db.collection("devotionals").where("groupId", "in", chunk)
            if audience is not None:
                q = q.where("audience", "==", audience)
            for snap in q.stream():
                gid_val = (snap.to_dict() or {}).get("groupId")
                gid = str(gid_val) if gid_val else ""
                if gid and gid not in name_by_gid:
                    name_by_gid[gid] = _group_name(db, gid)
                devotionals.append(_doc_to_devotional(snap, group_name=name_by_gid.get(gid)))

    devotionals.sort(key=lambda d: d.publishedAt or "", reverse=True)
    return DevotionalListResponse(devotionals=devotionals)


@router.get("/api/groups/{gid}/devotionals", response_model=DevotionalListResponse)
@limiter.limit(DEVOTIONAL_LIST)
def list_group_devotionals(
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> DevotionalListResponse:
    """List devotionals authored within this group. Members only; the
    `require_member` dep also 404s when the group doesn't exist."""
    db = _db()
    snaps = list(db.collection("devotionals").where("groupId", "==", gid).stream())
    name = str(membership.group.get("name") or "") or None
    devotionals = [_doc_to_devotional(s, group_name=name) for s in snaps]
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
    data = snap.to_dict() or {}
    group_id = data.get("groupId")
    if group_id:
        # Group-scoped: only members of that group (and admins) can read.
        if bool(user.claims.get("admin")) is not True:
            member_snap = (
                db.collection("groups")
                .document(str(group_id))
                .collection("members")
                .document(user.uid)
                .get()
            )
            if not getattr(member_snap, "exists", False):
                # Treat "not allowed to see" as a 404 so the slug existence
                # isn't probeable by non-members.
                raise APIError(
                    status_code=status.HTTP_404_NOT_FOUND,
                    code="devotional_not_found",
                    message=f"Devotional {slug!r} not found",
                )
        return _doc_to_devotional(snap, group_name=_group_name(db, str(group_id)))
    return _doc_to_devotional(snap)


@router.post("/api/devotionals", response_model=Devotional, status_code=status.HTTP_201_CREATED)
@limiter.limit(DEVOTIONAL_MUTATION)
def create_devotional(
    request: Request,
    response: Response,
    body: DevotionalCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    _ban_check: CurrentUser = Depends(require_not_banned),
) -> Devotional:
    db = _db()
    _authorize_devotional_mutation(db, user, body.groupId)

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
            "groupId": body.groupId,
            "schemaVersion": 1,
            "createdBy": user.uid,
        }
    )
    logger.info(
        "devotional created slug=%s actor=%s scope=%s",
        body.slug,
        user.uid,
        f"group:{body.groupId}" if body.groupId else "platform",
    )
    group_name = _group_name(db, body.groupId) if body.groupId else None
    return _doc_to_devotional(ref.get(), group_name=group_name)


@router.patch("/api/devotionals/{slug}", response_model=Devotional)
@limiter.limit(DEVOTIONAL_MUTATION)
def update_devotional(
    slug: str,
    request: Request,
    response: Response,
    body: DevotionalUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    _ban_check: CurrentUser = Depends(require_not_banned),
) -> Devotional:
    db = _db()
    ref = db.collection("devotionals").document(slug)
    snap = ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="devotional_not_found",
            message=f"Devotional {slug!r} not found",
        )
    existing_group_id = (snap.to_dict() or {}).get("groupId")
    _authorize_devotional_mutation(db, user, existing_group_id)

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
    group_name = _group_name(db, str(existing_group_id)) if existing_group_id else None
    return _doc_to_devotional(ref.get(), group_name=group_name)


@router.delete("/api/devotionals/{slug}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(DEVOTIONAL_MUTATION)
def delete_devotional(
    slug: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    _ban_check: CurrentUser = Depends(require_not_banned),
) -> Response:
    db = _db()
    ref = db.collection("devotionals").document(slug)
    snap = ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="devotional_not_found",
            message=f"Devotional {slug!r} not found",
        )
    existing_group_id = (snap.to_dict() or {}).get("groupId")
    _authorize_devotional_mutation(db, user, existing_group_id)
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
