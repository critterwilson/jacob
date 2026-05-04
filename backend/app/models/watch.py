"""Models for the T50 Watch Together surface.

Watch sessions live at `groups/{gid}/watch_sessions/{sessionId}`
(Firestore, lifecycle metadata) plus `/watch/{gid}/{sessionId}`
(RTDB, ephemeral playback state). Per M6 the Firestore writes go
through `/api/groups/{gid}/watch*`; the RTDB writes are direct from
the leader client (gated by RTDB rules + the membership mirror).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class WatchStartRequest(BaseModel):
    videoUrl: str = Field(min_length=1, max_length=500)


class WatchStartResponse(BaseModel):
    sessionId: str
    videoId: str
    title: str | None = None
    thumbnailUrl: str | None = None


class WatchSession(BaseModel):
    sessionId: str
    videoId: str
    sourceUrl: str
    title: str | None
    thumbnailUrl: str | None
    leaderUid: str
    createdBy: str
    createdAt: str | None
    endedAt: str | None
    attendees: list[str]
    durationSec: int | None


class WatchSessionListResponse(BaseModel):
    sessions: list[WatchSession]


class WatchJoinResponse(BaseModel):
    sessionId: str
    attendees: list[str]


class WatchEndResponse(BaseModel):
    sessionId: str
    endedAt: str
    durationSec: int


class WatchTransferRequest(BaseModel):
    newLeaderUid: str = Field(min_length=1, max_length=200)


class WatchTransferResponse(BaseModel):
    sessionId: str
    leaderUid: str
