from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DiscoverGroup(BaseModel):
    gid: str
    name: str
    description: str
    memberCount: int
    audience: Literal["christian", "bjj", "general"]
    joinMode: Literal["open", "request"]
    leaderUids: list[str]
    stickerMixSnapshot: list[dict[str, object]]


class DiscoverGroupsResponse(BaseModel):
    groups: list[DiscoverGroup]
    nextCursor: str | None


class JoinRequest(BaseModel):
    message: str = Field(default="", max_length=280)


class JoinResponse(BaseModel):
    gid: str
    joined: bool = False
    pending: bool = False
    requestId: str | None = None


class JoinModeRequest(BaseModel):
    joinMode: Literal["open", "request"]


class PendingRequest(BaseModel):
    uid: str
    message: str
    requestedAt: str  # ISO-8601
    status: Literal["pending", "approved", "rejected"]


class PendingRequestsResponse(BaseModel):
    requests: list[PendingRequest]
    nextCursor: str | None


class ReviewResponse(BaseModel):
    gid: str
    uid: str
    status: Literal["approved", "rejected"]
