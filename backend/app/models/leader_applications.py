"""Pydantic models for the leader-application flow (ADR 0015).

A non-owner who wants to lead a group submits a `leader_applications/{appId}`
doc; the ministry owner reviews the queue and either approves (the backend
creates the group with the applicant as leader) or rejects with a reason.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LeaderApplicationStatus = Literal["pending", "approved", "rejected"]


class SubmitLeaderApplicationRequest(BaseModel):
    """`POST /api/leader-applications` body."""

    model_config = ConfigDict(extra="forbid")

    proposedGroupName: str = Field(min_length=1, max_length=80)
    proposedGroupDescription: str = Field(min_length=1, max_length=500)
    proposedAudience: Literal["christian", "general"] = "christian"
    motivation: str = Field(default="", max_length=2000)


class LeaderApplicationView(BaseModel):
    """`GET /api/leader-applications/me` and admin-list response item."""

    appId: str
    applicantUid: str
    applicantDisplayName: str = ""
    applicantEmail: str | None = None
    proposedGroupName: str
    proposedGroupDescription: str
    proposedAudience: Literal["christian", "general"]
    motivation: str = ""
    status: LeaderApplicationStatus
    createdAt: datetime | None = None
    decidedAt: datetime | None = None
    decidedBy: str | None = None
    decisionNotes: str = ""
    createdGroupId: str | None = None


class LeaderApplicationListResponse(BaseModel):
    items: list[LeaderApplicationView]
    nextCursor: str | None = None


class ApproveLeaderApplicationRequest(BaseModel):
    """`POST /api/admin/leader-applications/{appId}/approve` body."""

    model_config = ConfigDict(extra="forbid")

    decisionNotes: str = Field(default="", max_length=2000)
    # Optional override of the proposed audience — useful if the owner
    # wants to redirect a "general" applicant into the "christian" group
    # taxonomy without bouncing the application.
    audienceOverride: Literal["christian", "general"] | None = None


class RejectLeaderApplicationRequest(BaseModel):
    """`POST /api/admin/leader-applications/{appId}/reject` body."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)


class LeaderApplicationDecisionResponse(BaseModel):
    appId: str
    status: LeaderApplicationStatus
    createdGroupId: str | None = None
