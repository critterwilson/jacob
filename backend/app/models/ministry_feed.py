"""Pydantic models for the central ministry feed."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class MinistryPost(BaseModel):
    model_config = ConfigDict(extra="ignore")

    postId: str
    title: str
    body: str
    sermonUrl: str | None = None
    coverImageRef: str | None = None
    authorUid: str
    createdAt: datetime | None = None
    editedAt: datetime | None = None
    deletedAt: datetime | None = None
    pinnedAt: datetime | None = None
    pinnedBy: str | None = None
    reactionCounts: dict[str, int] = Field(default_factory=dict)


class MinistryPostsResponse(BaseModel):
    posts: list[MinistryPost]
    nextCursor: str | None = None


class CreateMinistryPostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    sermonUrl: HttpUrl | None = None
    coverImageRef: str | None = Field(default=None, max_length=1024)


class UpdateMinistryPostRequest(BaseModel):
    """All fields optional; only those present are updated."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=8000)
    sermonUrl: HttpUrl | None = None
    coverImageRef: str | None = Field(default=None, max_length=1024)


class PinMinistryPostResponse(BaseModel):
    postId: str
    pinnedAt: str | None


class MinistryReactionResponse(BaseModel):
    uid: str
    slug: str
    reactedAt: datetime
    reactionCounts: dict[str, int] = Field(default_factory=dict)


class MinistryReactionRemovedResponse(BaseModel):
    reactionCounts: dict[str, int] = Field(default_factory=dict)


class MinistryOwnerGrantResponse(BaseModel):
    uid: str
    ministryOwner: bool
