"""Weekly-sermon router.

One org-wide video sermon, keyed by ISO week so there is a natural
single-active document (`weekly_sermons/{YYYY-Www}`):

* `GET   /api/weekly-sermon`        — any signed-in member. Returns the
  current ISO week's sermon, or the most-recent one if this week hasn't
  been posted yet. ETag for conditional polling.
* `POST  /api/admin/weekly-sermon`  — owners (`ministry_owner` claim).
  Publishes / overwrites the target week's entry.
* `PATCH /api/admin/weekly-sermon`  — owners. Partial update of an
  existing week's entry.

Per M6 the underlying `weekly_sermons/{weekKey}` collection
default-denies client access; this is the only path in.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, Response, status
from firebase_admin import firestore as fb_firestore
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_ministry_owner
from app.errors import APIError
from app.limits import WEEKLY_SERMON_MUTATION, WEEKLY_SERMON_READ
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.models.weekly_sermon import (
    WeeklySermon,
    WeeklySermonPatchRequest,
    WeeklySermonResponse,
    WeeklySermonUpsertRequest,
)
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

router = APIRouter(tags=["weekly-sermon"])
admin_router = APIRouter(prefix="/api/admin/weekly-sermon", tags=["weekly-sermon"])

_COLLECTION = "weekly_sermons"


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


def current_week_key(now: datetime | None = None) -> str:
    """ISO-week document id, e.g. `2026-W22`. Zero-padded so lexical and
    chronological ordering agree within a year."""
    dt = now or datetime.now(UTC)
    iso = dt.isocalendar()
    return f"{iso[0]:04d}-W{iso[1]:02d}"


def week_start_for_key(week_key: str) -> str | None:
    """Monday (ISO weekday 1) of the given `YYYY-Www` key, as an ISO date."""
    try:
        year_part, week_part = week_key.split("-W", 1)
        monday = datetime.fromisocalendar(int(year_part), int(week_part), 1)
    except (ValueError, TypeError):
        return None
    return monday.date().isoformat()


def _doc_to_sermon(snap: Any) -> WeeklySermon:
    data: dict[str, Any] = snap.to_dict() or {}
    return WeeklySermon(
        weekKey=str(data.get("weekKey") or snap.id),
        videoUrl=str(data.get("videoUrl") or ""),
        title=str(data.get("title") or ""),
        description=str(data.get("description") or ""),
        postedAt=_ts_to_str(data.get("postedAt")),
        postedBy=data.get("postedBy"),
        weekStart=data.get("weekStart"),
    )


@router.get("/api/weekly-sermon", response_model=WeeklySermonResponse)
@limiter.limit(WEEKLY_SERMON_READ)
def get_weekly_sermon(
    request: Request,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: CurrentUser = Depends(get_current_user),
) -> Any:
    """Current week's sermon, falling back to the most-recent posted one.

    The fallback mirrors the daily-verse pattern: if this UTC week's doc
    hasn't been published yet, members still see last week's rather than
    an empty hero.
    """
    db = _db()
    snap = db.collection(_COLLECTION).document(current_week_key()).get()
    if not getattr(snap, "exists", False):
        recent = list(
            db.collection(_COLLECTION)
            .order_by("postedAt", direction=fb_firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )
        snap = recent[0] if recent else None

    sermon = _doc_to_sermon(snap) if snap is not None else None
    payload = WeeklySermonResponse(sermon=sermon)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'
    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return payload


@admin_router.post("", response_model=WeeklySermon, status_code=status.HTTP_201_CREATED)
@limiter.limit(WEEKLY_SERMON_MUTATION)
def publish_weekly_sermon(
    request: Request,
    response: Response,
    body: WeeklySermonUpsertRequest,
    owner: CurrentUser = Depends(require_ministry_owner),
) -> WeeklySermon:
    """Publish (or overwrite) the target week's sermon. Idempotent set —
    a second publish for the same week replaces the entry."""
    db = _db()
    week_key = body.weekKey or current_week_key()
    ref = db.collection(_COLLECTION).document(week_key)
    ref.set(
        {
            "weekKey": week_key,
            "weekStart": week_start_for_key(week_key),
            "videoUrl": str(body.videoUrl),
            "title": body.title.strip(),
            "description": body.description.strip(),
            "postedAt": fb_firestore.SERVER_TIMESTAMP,
            "postedBy": owner.uid,
        }
    )
    write_audit_log(
        actor_uid=owner.uid,
        action="weekly_sermon_publish",
        target_ref=f"{_COLLECTION}/{week_key}",
        payload={"weekKey": week_key},
    )
    logger.info("weekly_sermon_published week=%s actor=%s", week_key, owner.uid)
    return _doc_to_sermon(ref.get())


@admin_router.patch("", response_model=WeeklySermon)
@limiter.limit(WEEKLY_SERMON_MUTATION)
def update_weekly_sermon(
    request: Request,
    response: Response,
    body: WeeklySermonPatchRequest,
    owner: CurrentUser = Depends(require_ministry_owner),
) -> WeeklySermon:
    """Partial update of an existing week's sermon."""
    db = _db()
    week_key = body.weekKey or current_week_key()
    ref = db.collection(_COLLECTION).document(week_key)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="weekly_sermon_not_found",
            message=f"No sermon published for week {week_key!r}",
        )
    update: dict[str, Any] = {}
    if body.videoUrl is not None:
        update["videoUrl"] = str(body.videoUrl)
    if body.title is not None:
        update["title"] = body.title.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if not update:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_update",
            message="No mutable fields supplied",
        )
    update["postedAt"] = fb_firestore.SERVER_TIMESTAMP
    update["postedBy"] = owner.uid
    ref.update(update)
    write_audit_log(
        actor_uid=owner.uid,
        action="weekly_sermon_update",
        target_ref=f"{_COLLECTION}/{week_key}",
        payload={"changedKeys": sorted(k for k in update if k not in ("postedAt", "postedBy"))},
    )
    return _doc_to_sermon(ref.get())


__all__ = ["router", "admin_router", "current_week_key", "week_start_for_key"]
