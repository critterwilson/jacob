from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DEFAULT_MEMBER_CAP = 20


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    isPrivate: bool = False
    # T56 — audience pins the sticker set + brand voice. Immutable
    # after create (changing it would invalidate the group's sticker
    # history). Defaults to christian for back-compat.
    audience: Literal["christian", "bjj", "general"] = "christian"


class ArchiveGroupRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


class ArchiveResponse(BaseModel):
    gid: str
    archivedAt: str  # ISO-8601


class UnarchiveResponse(BaseModel):
    gid: str


class CreateGroupResponse(BaseModel):
    groupId: str
    inviteCode: str


class JoinGroupRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16)


class JoinGroupResponse(BaseModel):
    groupId: str
    # ADR 0014: an adult arriving via an invite link is auto-joined
    # (`joined=True`). A minor lands in the owner queue with
    # `pendingOwnerReview=True` and `joined=False` — the invite is NOT
    # consumed at this point; the owner approval consumes it.
    joined: bool = True
    pendingOwnerReview: bool = False


class RotateInviteResponse(BaseModel):
    inviteCode: str


class LeaderActionResponse(BaseModel):
    gid: str
    uid: str
    role: str


class FounderTransferRequest(BaseModel):
    targetUid: str = Field(min_length=1, max_length=200)


class FounderTransferResponse(BaseModel):
    gid: str
    founderUid: str


class AnnounceResponse(BaseModel):
    gid: str
    mid: str
    announcedAt: str  # ISO-8601
    notifiedCount: int


class UpdateGroupRequest(BaseModel):
    """`PATCH /api/groups/{gid}` body. Replaces `firestore.rules:217-247`.

    `archivedAt` transitions live on the dedicated `/archive` and
    `/unarchive` endpoints; this endpoint refuses to touch it.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    isPrivate: bool | None = None
    joinMode: Literal["open", "request", "invite"] | None = None
    stickerSet: str | None = Field(default=None, min_length=1, max_length=64)
    avatarUrl: str | None = Field(
        default=None,
        max_length=500,
    )
    pinnedMessageIds: list[str] | None = Field(default=None, max_length=5)
    # T48 — leader-toggleable. Absent / null is treated as the legacy
    # "presence on" default by the frontend so existing groups keep
    # working without a backfill.
    presenceEnabled: bool | None = None
    memberCap: int | None = Field(default=None, ge=1)


class MemberCapRequest(BaseModel):
    """Body for `PATCH /api/groups/{gid}/cap`."""

    memberCap: int = Field(ge=1)


class MemberCapResponse(BaseModel):
    gid: str
    memberCap: int
