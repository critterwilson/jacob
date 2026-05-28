"""Pydantic models for T32 message boards."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BoardAudience = Literal["christian", "general"]


class CreateBoardRequest(BaseModel):
    """Body of `POST /api/admin/boards`.

    Authors do NOT type a slug; the server derives one from `name`
    (lowercased, hyphenated, punctuation stripped, length-capped, and
    collision-suffixed with `-2`/`-3`/…). See
    `app.services.slugs.slugify_title` + `next_available_slug`.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    audience: BoardAudience = "general"


class PatchBoardRequest(BaseModel):
    """Body of `PATCH /api/admin/boards/{id}`. All fields optional; slug is immutable."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    audience: BoardAudience | None = None


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


# ── M4 write request shapes ──────────────────────────────────────────────


class CreateBoardPostRequest(BaseModel):
    """Body of `POST /api/boards/{bid}/posts`.

    Mirrors `firestore.rules:476-505`. Note: stickerIds is REQUIRED with
    at least 1 sticker (the rules require it; the create-post UI surfaces
    a sticker picker so this is a natural constraint).
    """

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)
    stickerIds: list[str] = Field(min_length=1, max_length=5)
    mediaRefs: list[str] = Field(default_factory=list, max_length=4)
    mentions: list[str] = Field(default_factory=list, max_length=10)


class EditBoardPostRequest(BaseModel):
    """Body of `PATCH /api/boards/{bid}/posts/{pid}`."""

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)


class CreateBoardReplyRequest(BaseModel):
    """Body of `POST /api/boards/{bid}/posts/{pid}/replies`.

    Mirrors `firestore.rules:547-566`. stickerIds is optional for replies.
    """

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)
    stickerIds: list[str] = Field(default_factory=list, max_length=5)
    mediaRefs: list[str] = Field(default_factory=list, max_length=4)
    mentions: list[str] = Field(default_factory=list, max_length=10)


class EditBoardReplyRequest(BaseModel):
    """Body of `PATCH /api/boards/{bid}/posts/{pid}/replies/{rid}`."""

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)


class BoardReactionResponse(BaseModel):
    uid: str
    slug: str
    reactedAt: datetime
    reactionCounts: dict[str, int] = Field(default_factory=dict)


class BoardReactionRemovedResponse(BaseModel):
    reactionCounts: dict[str, int] = Field(default_factory=dict)
