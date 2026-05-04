"""Pydantic models for the messages router (M3 reads, M4 writes).

`Message` is the wire shape used by both the chat list endpoint and the
single-message lookup. Fields mirror the Firestore document the
frontend's `useGroupMessages.ts` used to consume directly so callers
don't need to change shape.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ModerationState = Literal["scored", "flagged", "hidden", "skipped", "errored"]


class ModerationFields(BaseModel):
    state: ModerationState | None = None
    reasons: list[str] = Field(default_factory=list)
    scores: dict[str, float] | None = None
    scoredAt: datetime | None = None
    policy: str | None = None


class Message(BaseModel):
    """Wire shape for a chat message.

    Mirrors `frontend/lib/hooks/useGroupMessages.ts:Message` and the
    `groups/{gid}/messages/{mid}` Firestore document. `participants` is
    intentionally omitted — it is bookkeeping for thread fan-out and not
    something clients should see.
    """

    model_config = ConfigDict(extra="ignore")

    id: str
    authorUid: str
    body: str
    stickerIds: list[str] = Field(default_factory=list)
    mediaRefs: list[str] = Field(default_factory=list)
    mentions: list[str] = Field(default_factory=list)
    parentMessageId: str | None = None
    threadReplyCount: int = 0
    createdAt: datetime | None = None
    editedAt: datetime | None = None
    deletedAt: datetime | None = None
    announcedAt: datetime | None = None
    announcedBy: str | None = None
    reactionCounts: dict[str, int] = Field(default_factory=dict)
    moderation: ModerationFields | None = None
    repostOfThread: str | None = None


class MessagesListResponse(BaseModel):
    messages: list[Message]
    nextCursor: str | None = None


class PinnedMessagesResponse(BaseModel):
    messages: list[Message]


class RecentMessage(BaseModel):
    """Wire shape used by `GET /api/users/me/recent-messages` —
    a flat across-groups feed with the group name joined for display."""

    model_config = ConfigDict(extra="ignore")

    id: str
    gid: str
    groupName: str
    authorUid: str
    body: str
    createdAt: datetime | None = None
    deletedAt: datetime | None = None
    mediaRefs: list[str] = Field(default_factory=list)


class RecentMessagesResponse(BaseModel):
    messages: list[RecentMessage]
