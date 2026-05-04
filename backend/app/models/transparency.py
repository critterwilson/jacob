"""Pydantic models for the T65 transparency report surface.

Reports live at `transparency_reports/{reportId}`. Per M6 the
collection default-denies client access. Public surface is via
`GET /api/transparency/latest`; admin surface via
`POST /api/admin/transparency/{reportId}/publish`.

Privacy: payloads are bucketed counts only — no uids, group ids,
or message ids. A privacy-guard test enforces this on every
generated payload.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ReportScope = Literal["platform"] | str
"""`platform` for the global report; an `orgId` string for per-org reports."""


class ReportsBlock(BaseModel):
    received: int = 0
    byCategory: dict[str, int] = Field(default_factory=dict)


class ModerationActionsBlock(BaseModel):
    contentHidden: int = 0
    contentRestored: int = 0
    accountsBanned: int = 0
    accountsUnbanned: int = 0
    groupsArchived: int = 0
    groupsUnarchived: int = 0


class AppealsBlock(BaseModel):
    submitted: int = 0
    upheld: int = 0
    reversed_: int = Field(default=0, alias="reversed")
    pending: int = 0

    model_config = {"populate_by_name": True}


class NcmecBlock(BaseModel):
    submitted: int = 0
    withdrawn: int = 0
    failed: int = 0


class AccountActionsBlock(BaseModel):
    deletionRequested: int = 0
    deletionCancelled: int = 0
    exportRequested: int = 0
    exportCompleted: int = 0


class TransparencyPayload(BaseModel):
    reports: ReportsBlock = Field(default_factory=ReportsBlock)
    moderationActions: ModerationActionsBlock = Field(default_factory=ModerationActionsBlock)
    appeals: AppealsBlock = Field(default_factory=AppealsBlock)
    ncmec: NcmecBlock = Field(default_factory=NcmecBlock)
    accountActions: AccountActionsBlock = Field(default_factory=AccountActionsBlock)


class TransparencyReport(BaseModel):
    reportId: str
    period: str  # e.g. "2026-Q1"
    scope: str  # "platform" or orgId
    payload: TransparencyPayload
    generatedAt: str | None = None
    publishedAt: str | None = None


class TransparencyListResponse(BaseModel):
    reports: list[TransparencyReport]


class PublishResponse(BaseModel):
    reportId: str
    publishedAt: str | None
