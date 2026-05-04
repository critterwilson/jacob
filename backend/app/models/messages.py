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
    # Slugs the *caller* has reacted with on this message. Populated by
    # the messages router for authenticated members so the client can
    # render an "I reacted" affordance after a refresh — see PR4 / C4.
    # Empty for public-read non-members (they cannot react anyway).
    myReactions: list[str] = Field(default_factory=list)
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


# ── M4 write request shapes ──────────────────────────────────────────────


class CreateMessageRequest(BaseModel):
    """Body of `POST /api/groups/{gid}/messages`.

    Mirrors `firestore.rules:323-347` — keys allow-list, types, lengths.
    `extra: forbid` enforces the rules' `keys().hasOnly(...)` predicate.
    """

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)
    stickerIds: list[str] = Field(default_factory=list, max_length=5)
    mediaRefs: list[str] = Field(default_factory=list, max_length=4)
    parentMessageId: str | None = None
    mentions: list[str] = Field(default_factory=list, max_length=10)
    repostOfThread: str | None = None


class EditMessageRequest(BaseModel):
    """Body of `PATCH /api/groups/{gid}/messages/{mid}`."""

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)


class ReactionResponse(BaseModel):
    """Acknowledgement that a reaction was recorded.

    Does not carry `reactionCounts` — those are updated asynchronously
    by a Cloud Function trigger, and any pre-trigger snapshot returned
    here was stale by definition (see PR9 / H7). The next polled
    `/api/groups/{gid}/messages` response is authoritative; the client
    optimistically reflects the toggle in the meantime.
    """

    uid: str
    slug: str
    reactedAt: datetime


class ReactionRemovedResponse(BaseModel):
    """Acknowledgement that a reaction was removed. Same rationale as
    `ReactionResponse` — no `reactionCounts`."""

    ok: bool = True
