from __future__ import annotations

from pydantic import BaseModel, Field


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    isPrivate: bool = False


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
