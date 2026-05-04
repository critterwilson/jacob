"""Pydantic models for T32 message boards."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BoardAudience = Literal["christian", "general"]

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CreateBoardRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    audience: BoardAudience = "general"

    @field_validator("slug")
    @classmethod
    def _slug_is_kebab(cls, v: str) -> str:
        if not _SLUG_RE.match(v):
            raise ValueError("slug must be lowercase kebab (a-z, 0-9, hyphens)")
        return v


class BoardResponse(BaseModel):
    boardId: str
    name: str
    slug: str
    description: str
    audience: BoardAudience
    archivedAt: str | None
    postCount: int


class BoardListResponse(BaseModel):
    boards: list[BoardResponse]


class ArchiveBoardResponse(BaseModel):
    boardId: str
    archivedAt: str


class PinPostResponse(BaseModel):
    boardId: str
    postId: str
    pinnedAt: str | None  # null when unpinning


class PinPostRequest(BaseModel):
    pinned: bool = True


# ── posts and replies (M3 reads) ──────────────────────────────────────────


class BoardPostModeration(BaseModel):
    state: str | None = None
    reasons: list[str] = Field(default_factory=list)


class BoardPost(BaseModel):
    """Wire shape for a board post.

    Mirrors `frontend/lib/hooks/useBoardPosts.ts:BoardPost` and the
    `boards/{boardId}/posts/{postId}` Firestore document.
    """

    model_config = ConfigDict(extra="ignore")

    postId: str
    authorUid: str
    body: str
    stickerIds: list[str] = Field(default_factory=list)
    mediaRefs: list[str] = Field(default_factory=list)
    mentions: list[str] = Field(default_factory=list)
    createdAt: datetime | None = None
    editedAt: datetime | None = None
    deletedAt: datetime | None = None
    pinnedAt: datetime | None = None
    pinnedBy: str | None = None
    reactionCounts: dict[str, int] = Field(default_factory=dict)
    replyCount: int = 0
    moderation: BoardPostModeration | None = None


class BoardPostsResponse(BaseModel):
    posts: list[BoardPost]
    nextCursor: str | None = None


class BoardReply(BaseModel):
    """Wire shape for a reply on a board post."""

    model_config = ConfigDict(extra="ignore")

    replyId: str
    authorUid: str
    body: str
    stickerIds: list[str] = Field(default_factory=list)
    mediaRefs: list[str] = Field(default_factory=list)
    mentions: list[str] = Field(default_factory=list)
    createdAt: datetime | None = None
    editedAt: datetime | None = None
    deletedAt: datetime | None = None
    moderation: BoardPostModeration | None = None


class BoardRepliesResponse(BaseModel):
    replies: list[BoardReply]
    nextCursor: str | None = None
