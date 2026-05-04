"""Models for the T49 scheduled-events surface.

Events live at `groups/{gid}/events/{eventId}`. RSVPs live one level
deeper at `.../rsvps/{uid}`. Per M6 every read and write goes through
`/api/groups/{gid}/events*`.

Recurrence is expanded server-side at create time: a `weekly` /
`biweekly` recurrence generates child docs with `parentEventId` set
to the root, capped at `count` (default 12). Each child carries its
own `reminderSentAt` so the dispatch job idempotency works without
extra coordination.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

RecurrenceKind = Literal["weekly", "biweekly"]
RsvpStatus = Literal["going", "maybe", "no"]


class Recurrence(BaseModel):
    kind: RecurrenceKind
    # Number of occurrences total (including the root). Capped at 12 in
    # the service layer; full RRULE is out of scope for v1.
    count: int = Field(ge=1, le=12)


class EventCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    startsAt: str = Field(description="ISO-8601 with offset; UTC preferred")
    endsAt: str
    location: str | None = Field(default=None, max_length=500)
    recurrence: Recurrence | None = None


class EventUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    startsAt: str | None = None
    endsAt: str | None = None
    location: str | None = Field(default=None, max_length=500)


class Event(BaseModel):
    eventId: str
    title: str
    description: str
    startsAt: str
    endsAt: str
    location: str | None
    recurrence: Recurrence | None
    parentEventId: str | None
    occurrenceIndex: int
    createdBy: str
    createdAt: str | None
    deletedAt: str | None
    reminderSentAt: str | None
    # Aggregated counts for the leader-side roster.
    rsvpGoing: int = 0
    rsvpMaybe: int = 0
    rsvpNo: int = 0
    attendedCount: int = 0


class EventListResponse(BaseModel):
    events: list[Event]


class EventDeleteResponse(BaseModel):
    eventId: str
    deleted: bool
    soft: bool


class RsvpRequest(BaseModel):
    status: RsvpStatus


class CheckInResponse(BaseModel):
    eventId: str
    uid: str
    attended: bool
    checkedInAt: str


class Rsvp(BaseModel):
    uid: str
    status: RsvpStatus
    respondedAt: str | None
    attended: bool | None
    checkedInAt: str | None


class RsvpListResponse(BaseModel):
    rsvps: list[Rsvp]


class ManualAttendanceRequest(BaseModel):
    uid: Annotated[str, Field(min_length=1, max_length=200)]
    attended: bool


class ManualAttendanceResponse(BaseModel):
    eventId: str
    uid: str
    attended: bool
