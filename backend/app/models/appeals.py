"""Models for the T64 appeals surface."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AppealDecision = Literal["pending", "upheld", "reversed"]
AppealSubjectType = Literal["message", "ban", "group_archive"]


class AppealSubject(BaseModel):
    type: AppealSubjectType
    # Path-style reference to the affected resource. Examples:
    #   "groups/<gid>/messages/<mid>"
    #   "bans/<uid>"
    #   "groups/<gid>"  (for archive actions)
    ref: str = Field(min_length=1, max_length=300)


class AppealSubmitRequest(BaseModel):
    subject: AppealSubject
    body: str = Field(min_length=20, max_length=2000)


class AppealSubmitResponse(BaseModel):
    appealId: str
    decision: AppealDecision


class Appeal(BaseModel):
    appealId: str
    subject: AppealSubject
    appellantUid: str
    originalActorUid: str | None
    originalActionAt: str | None
    submittedAt: str | None
    body: str
    decision: AppealDecision
    decidedBy: str | None
    decidedAt: str | None
    reasoning: str | None
    overdue: bool = False


class AppealListResponse(BaseModel):
    appeals: list[Appeal]


class DecideRequest(BaseModel):
    decision: Literal["upheld", "reversed"]
    reasoning: str = Field(min_length=20, max_length=2000)


class DecideResponse(BaseModel):
    appealId: str
    decision: AppealDecision
    decidedAt: str | None
