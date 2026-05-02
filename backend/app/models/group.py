from __future__ import annotations

from pydantic import BaseModel, Field


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    isPrivate: bool = False


class CreateGroupResponse(BaseModel):
    groupId: str
    inviteCode: str


class JoinGroupRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16)


class JoinGroupResponse(BaseModel):
    groupId: str


class RotateInviteResponse(BaseModel):
    inviteCode: str
