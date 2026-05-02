from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# ── request models ─────────────────────────────────────────────────────────────


class BanRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
    duration: Literal["24h", "7d", "permanent"]


class ResolveRequest(BaseModel):
    resolution: Literal["approve", "reject"]


# ── response models ────────────────────────────────────────────────────────────


class BanResponse(BaseModel):
    uid: str
    banned: bool


class UnbanResponse(BaseModel):
    uid: str
    unbanned: bool


class ResolveResponse(BaseModel):
    itemId: str
    status: str


class ModerationItem(BaseModel):
    itemId: str
    resourceRef: str
    reason: str | None
    status: str
    uploaderUid: str | None
    createdAt: str | None
    extra: dict[str, Any]


class ModerationListResponse(BaseModel):
    items: list[ModerationItem]
    nextCursor: str | None


class AdminUser(BaseModel):
    uid: str
    displayName: str | None
    email: str | None
    createdAt: str | None
    isBanned: bool


class AdminUserListResponse(BaseModel):
    users: list[AdminUser]


class AdminGroup(BaseModel):
    gid: str
    name: str
    memberCount: int
    createdAt: str | None


class AdminGroupListResponse(BaseModel):
    groups: list[AdminGroup]
