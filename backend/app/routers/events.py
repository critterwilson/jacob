"""Scheduled-events router (T49).

Endpoints:

* `GET    /api/groups/{gid}/events`                            — members
* `GET    /api/groups/{gid}/events/{eventId}`                  — members
* `GET    /api/groups/{gid}/events/{eventId}.ics`              — members
* `POST   /api/groups/{gid}/events`                            — leaders
* `PATCH  /api/groups/{gid}/events/{eventId}`                  — leaders
* `DELETE /api/groups/{gid}/events/{eventId}`                  — leaders (soft, cascades)
* `POST   /api/groups/{gid}/events/{eventId}/rsvp`             — members
* `POST   /api/groups/{gid}/events/{eventId}/check-in`         — members
* `POST   /api/groups/{gid}/events/{eventId}/manual-attendance` — leaders
* `GET    /api/groups/{gid}/events/{eventId}/rsvps`            — leaders

Per M6 every doc goes through these endpoints; rules default-deny.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response, status
from fastapi.responses import PlainTextResponse
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    require_leader,
    require_member,
    require_member_not_banned,
)
from app.errors import APIError
from app.limits import EVENT_CREATE, EVENT_RSVP, GROUP_READ
from app.middleware.rate_limit import limiter
from app.models.events import (
    CheckInResponse,
    Event,
    EventCreateRequest,
    EventListResponse,
    EventUpdateRequest,
    ManualAttendanceRequest,
    ManualAttendanceResponse,
    Recurrence,
    Rsvp,
    RsvpListResponse,
    RsvpRequest,
)
from app.services import events as events_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups/{gid}/events", tags=["events"])


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


def _doc_to_event(snap: Any, *, counts: dict[str, int] | None = None) -> Event:
    data: dict[str, Any] = snap.to_dict() or {}
    recurrence = data.get("recurrence")
    rec_model: Recurrence | None = None
    if isinstance(recurrence, dict) and recurrence.get("kind") in {"weekly", "biweekly"}:
        rec_model = Recurrence(kind=recurrence["kind"], count=int(recurrence.get("count") or 1))
    counts = counts or {"going": 0, "maybe": 0, "no": 0, "attended": 0}
    return Event(
        eventId=snap.id,
        title=str(data.get("title", "")),
        description=str(data.get("description", "")),
        startsAt=_ts_to_str(data.get("startsAt")) or "",
        endsAt=_ts_to_str(data.get("endsAt")) or "",
        location=data.get("location"),
        recurrence=rec_model,
        parentEventId=data.get("parentEventId"),
        occurrenceIndex=int(data.get("occurrenceIndex", 0) or 0),
        createdBy=str(data.get("createdBy", "")),
        createdAt=_ts_to_str(data.get("createdAt")),
        deletedAt=_ts_to_str(data.get("deletedAt")),
        reminderSentAt=_ts_to_str(data.get("reminderSentAt")),
        rsvpGoing=counts.get("going", 0),
        rsvpMaybe=counts.get("maybe", 0),
        rsvpNo=counts.get("no", 0),
        attendedCount=counts.get("attended", 0),
    )


def _event_or_404(db: Any, gid: str, event_id: str) -> Any:
    snap = db.collection("groups").document(gid).collection("events").document(event_id).get()
    if not snap.exists or (snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found",
        )
    return snap


# ── list / get ───────────────────────────────────────────────────────────────


@router.get("", response_model=EventListResponse)
@limiter.limit(GROUP_READ)
def list_events(
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> EventListResponse:
    db = _db()
    rows = events_service.list_events(db, gid=gid)
    events: list[Event] = []
    for data in rows:
        rsvps = events_service.list_rsvps(db, gid=gid, event_id=data["eventId"])
        counts = events_service.aggregate_rsvp_counts(rsvps)
        snap = (
            db.collection("groups")
            .document(gid)
            .collection("events")
            .document(data["eventId"])
            .get()
        )
        events.append(_doc_to_event(snap, counts=counts))
    return EventListResponse(events=events)


# `.ics` route MUST be registered before `/{event_id}` — FastAPI matches
# routes in registration order, and `/{event_id}` would otherwise capture
# `e1.ics` as the event_id.
@router.get("/{event_id}.ics")
@limiter.limit(GROUP_READ)
def get_event_ics(
    event_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> PlainTextResponse:
    db = _db()
    snap = _event_or_404(db, gid, event_id)
    data = snap.to_dict() or {}
    ics = events_service.build_ics(
        event_id=event_id,
        title=str(data.get("title", "")),
        description=str(data.get("description", "")),
        starts_at=data["startsAt"],
        ends_at=data["endsAt"],
        location=data.get("location"),
    )
    return PlainTextResponse(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="event-{event_id}.ics"',
        },
    )


@router.get("/{event_id}", response_model=Event)
@limiter.limit(GROUP_READ)
def get_event(
    event_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> Event:
    db = _db()
    snap = _event_or_404(db, gid, event_id)
    rsvps = events_service.list_rsvps(db, gid=gid, event_id=event_id)
    counts = events_service.aggregate_rsvp_counts(rsvps)
    return _doc_to_event(snap, counts=counts)


# ── create / update / delete ─────────────────────────────────────────────────


@router.post(
    "",
    response_model=Event,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(EVENT_CREATE)
def create_event(
    body: EventCreateRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Event:
    db = _db()
    if (membership.group or {}).get("archivedAt"):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="group_archived",
            message="Cannot schedule events on an archived group",
        )
    try:
        starts_at = events_service.parse_iso(body.startsAt)
        ends_at = events_service.parse_iso(body.endsAt)
    except ValueError as exc:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_timestamp",
            message=str(exc),
        ) from exc

    recurrence_payload: dict[str, Any] | None = None
    if body.recurrence is not None:
        recurrence_payload = {
            "kind": body.recurrence.kind,
            "count": body.recurrence.count,
        }

    try:
        ids = events_service.create_events(
            db,
            gid=gid,
            actor_uid=membership.uid,
            title=body.title,
            description=body.description,
            starts_at=starts_at,
            ends_at=ends_at,
            location=body.location,
            recurrence=recurrence_payload,
        )
    except ValueError as exc:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_event",
            message=str(exc),
        ) from exc

    write_audit_log(
        actor_uid=membership.uid,
        action="event_create",
        target_ref=f"groups/{gid}/events/{ids[0]}",
        payload={
            "occurrenceCount": len(ids),
            "recurrence": recurrence_payload,
        },
    )
    snap = db.collection("groups").document(gid).collection("events").document(ids[0]).get()
    return _doc_to_event(snap)


@router.patch("/{event_id}", response_model=Event)
@limiter.limit(EVENT_CREATE)
def update_event(
    event_id: str,
    body: EventUpdateRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Event:
    db = _db()
    snap = _event_or_404(db, gid, event_id)
    update: dict[str, Any] = {}
    if body.title is not None:
        update["title"] = body.title.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.location is not None:
        update["location"] = body.location.strip() or None
    if body.startsAt is not None or body.endsAt is not None:
        existing_data = snap.to_dict() or {}
        try:
            new_start = (
                events_service.parse_iso(body.startsAt)
                if body.startsAt
                else existing_data.get("startsAt")
            )
            new_end = (
                events_service.parse_iso(body.endsAt)
                if body.endsAt
                else existing_data.get("endsAt")
            )
        except ValueError as exc:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_timestamp",
                message=str(exc),
            ) from exc
        if isinstance(new_start, datetime) and isinstance(new_end, datetime):
            if new_end <= new_start:
                raise APIError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    code="invalid_event",
                    message="endsAt must be after startsAt",
                )
        update["startsAt"] = new_start
        update["endsAt"] = new_end

    if not update:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_update",
            message="No mutable fields supplied",
        )

    snap.reference.update(update)
    write_audit_log(
        actor_uid=membership.uid,
        action="event_update",
        target_ref=f"groups/{gid}/events/{event_id}",
        payload={"changedKeys": sorted(update.keys())},
    )
    return _doc_to_event(snap.reference.get())


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(EVENT_CREATE)
def delete_event(
    event_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Response:
    db = _db()
    deleted = events_service.soft_delete_event(db, gid=gid, event_id=event_id)
    if deleted == 0:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found",
        )
    write_audit_log(
        actor_uid=membership.uid,
        action="event_delete",
        target_ref=f"groups/{gid}/events/{event_id}",
        payload={"cascadeCount": deleted},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── RSVP / check-in / manual-attendance ──────────────────────────────────────


@router.post("/{event_id}/rsvp", response_model=Rsvp)
@limiter.limit(EVENT_RSVP)
def rsvp(
    event_id: str,
    body: RsvpRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> Rsvp:
    db = _db()
    _event_or_404(db, gid, event_id)
    events_service.upsert_rsvp(
        db,
        gid=gid,
        event_id=event_id,
        uid=membership.uid,
        status=body.status,
    )
    snap = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
        .document(membership.uid)
        .get()
    )
    data = snap.to_dict() or {}
    return Rsvp(
        uid=membership.uid,
        status=data.get("status", body.status),
        respondedAt=_ts_to_str(data.get("respondedAt")),
        attended=data.get("attended"),
        checkedInAt=_ts_to_str(data.get("checkedInAt")),
    )


@router.post("/{event_id}/check-in", response_model=CheckInResponse)
@limiter.limit(EVENT_RSVP)
def check_in(
    event_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> CheckInResponse:
    db = _db()
    ok, reason = events_service.mark_check_in(db, gid=gid, event_id=event_id, uid=membership.uid)
    if not ok:
        if reason == "outside_window":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="outside_window",
                message="Check-in window is ±15 min around the event start",
            )
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="event_not_found",
            message="Event not found",
        )
    snap = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
        .document(membership.uid)
        .get()
    )
    data = snap.to_dict() or {}
    return CheckInResponse(
        eventId=event_id,
        uid=membership.uid,
        attended=bool(data.get("attended", True)),
        checkedInAt=_ts_to_str(data.get("checkedInAt")) or "",
    )


@router.post(
    "/{event_id}/manual-attendance",
    response_model=ManualAttendanceResponse,
)
@limiter.limit(EVENT_RSVP)
def manual_attendance(
    event_id: str,
    body: ManualAttendanceRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> ManualAttendanceResponse:
    db = _db()
    _event_or_404(db, gid, event_id)
    events_service.mark_manual_attendance(
        db,
        gid=gid,
        event_id=event_id,
        uid=body.uid,
        attended=body.attended,
    )
    write_audit_log(
        actor_uid=membership.uid,
        action="event_manual_attendance",
        target_ref=f"groups/{gid}/events/{event_id}/rsvps/{body.uid}",
        payload={"attended": body.attended},
    )
    return ManualAttendanceResponse(
        eventId=event_id,
        uid=body.uid,
        attended=body.attended,
    )


@router.get("/{event_id}/rsvps", response_model=RsvpListResponse)
@limiter.limit(GROUP_READ)
def list_rsvps_endpoint(
    event_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> RsvpListResponse:
    db = _db()
    _event_or_404(db, gid, event_id)
    rows = events_service.list_rsvps(db, gid=gid, event_id=event_id)
    return RsvpListResponse(
        rsvps=[
            Rsvp(
                uid=r["uid"],
                status=r.get("status", "no"),
                respondedAt=_ts_to_str(r.get("respondedAt")),
                attended=r.get("attended"),
                checkedInAt=_ts_to_str(r.get("checkedInAt")),
            )
            for r in rows
        ]
    )
