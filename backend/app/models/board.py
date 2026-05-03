"""Pydantic models for T32 message boards."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

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
