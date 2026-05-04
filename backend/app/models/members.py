"""Pydantic models for the group-membership read endpoints (M3)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

MemberRole = Literal["member", "leader"]


class Member(BaseModel):
    """Member of a group, joined with the user's public profile fields.

    The `displayName` and `photoURL` fields are looked up server-side
    against `users/{uid}`; if a profile doesn't exist the uid is echoed
    in `displayName` so the UI never renders blanks.
    """

    model_config = ConfigDict(extra="ignore")

    uid: str
    role: MemberRole
    joinedAt: datetime | None = None
    displayName: str
    photoURL: str | None = None


class MembersListResponse(BaseModel):
    members: list[Member]
    nextCursor: str | None = None


class MyMembership(BaseModel):
    """`GET /api/groups/{gid}/me`: the caller's own membership row."""

    gid: str
    uid: str
    role: MemberRole
    joinedAt: datetime | None = None


class GroupSummary(BaseModel):
    """One row in the user's group list (`GET /api/users/me/groups`)."""

    model_config = ConfigDict(extra="ignore")

    gid: str
    name: str
    description: str = ""
    avatarUrl: str | None = None
    isPrivate: bool = False
    archivedAt: datetime | None = None
    role: MemberRole
    joinedAt: datetime | None = None
    memberCount: int = 0
    lastMessageAt: datetime | None = None


class MyGroupsResponse(BaseModel):
    groups: list[GroupSummary]


class GroupDetail(BaseModel):
    """`GET /api/groups/{gid}`: the per-group read response.

    Mirrors the fields the frontend `useGroup` hook used to read off the
    Firestore document directly. `inviteCode` is included for *members*
    (so leaders see it on the invites page) but redacted to `None` for
    public-group non-members. The handler in
    `routers/groups.py` enforces that.
    """

    model_config = ConfigDict(extra="ignore")

    gid: str
    name: str
    description: str = ""
    isPrivate: bool = False
    joinMode: str | None = None
    audience: str | None = None
    stickerSet: str = "christian"
    avatarUrl: str | None = None
    archivedAt: datetime | None = None
    archivedBy: str | None = None
    archiveReason: str | None = None
    pinnedMessageIds: list[str] = []
    memberCount: int = 0
    leaderCount: int = 0
    founderUid: str | None = None
    createdBy: str | None = None
    createdAt: datetime | None = None
    inviteCode: str | None = None
    moderationPolicy: str | None = None
