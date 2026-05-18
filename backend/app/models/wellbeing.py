from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WellbeingStatus = Literal["open", "in_progress", "resolved"]

_VALID_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress"},
    "in_progress": {"resolved"},
    "resolved": set(),
}


def valid_next_statuses(current: str) -> set[str]:
    return _VALID_TRANSITIONS.get(current, set())


# ── request models ─────────────────────────────────────────────────────────────


class SubmitWellbeingFlagRequest(BaseModel):
    subjectUid: str = Field(..., min_length=1, max_length=200)
    note: str = Field(..., min_length=10, max_length=2000)
    messageId: str | None = Field(default=None, max_length=200)
    groupId: str | None = Field(default=None, max_length=200)


class TransitionStatusRequest(BaseModel):
    status: WellbeingStatus
    note: str = Field(..., min_length=1, max_length=2000)


class GrantModeratorRequest(BaseModel):
    grant: bool = True


# ── response models ────────────────────────────────────────────────────────────


class SubmitWellbeingFlagResponse(BaseModel):
    flagId: str
    dedup: bool = False


class WellbeingQueueItem(BaseModel):
    itemId: str
    reporterUid: str | None
    subjectUid: str | None
    resourceRef: str
    note: str | None
    status: str
    createdAt: str | None
    messageId: str | None = None
    groupId: str | None = None


class WellbeingQueueResponse(BaseModel):
    items: list[WellbeingQueueItem]
    nextCursor: str | None


class StatusHistoryEntry(BaseModel):
    status: str
    note: str
    actorUid: str
    createdAt: str | None


class WellbeingAuditResponse(BaseModel):
    history: list[StatusHistoryEntry]


class ModeratorUser(BaseModel):
    uid: str
    email: str | None
    displayName: str | None


class ModeratorListResponse(BaseModel):
    moderators: list[ModeratorUser]


class GrantModeratorResponse(BaseModel):
    uid: str
    moderator: bool
