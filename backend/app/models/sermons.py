"""Models for the T52 sermon-archive surface.

Sermons live at `groups/{gid}/sermons/{sermonId}`. Group members
read; group leaders / org admins (T54) write. Per M6 every doc goes
through `/api/groups/{gid}/sermons*`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl

SourceType = Literal["youtube", "podcast", "other"]


class SermonCreateRequest(BaseModel):
    sourceUrl: HttpUrl
    title: str | None = Field(default=None, max_length=200)
    preacher: str | None = Field(default=None, max_length=120)
    scripture: str | None = Field(default=None, max_length=200)
    # ISO date the sermon was preached (not added). Backend stores as
    # midnight UTC on that day.
    sermonDate: Annotated[str | None, Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")] = None


class SermonUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    preacher: str | None = Field(default=None, max_length=120)
    scripture: str | None = Field(default=None, max_length=200)
    sermonDate: Annotated[str | None, Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")] = None


class Sermon(BaseModel):
    sermonId: str
    title: str
    preacher: str | None
    scripture: str | None
    sermonDate: str | None
    sourceUrl: str
    sourceType: SourceType
    thumbnail: str | None
    addedBy: str
    addedAt: str | None
    deletedAt: str | None


class SermonListResponse(BaseModel):
    sermons: list[Sermon]
    preachers: list[str]


class SermonDeleteResponse(BaseModel):
    sermonId: str
    deleted: bool
