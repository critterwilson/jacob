from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ReportReason = Literal[
    "harassment", "sexual", "violence", "self-harm", "spam", "other", "wellbeing_concern"
]
ResourceType = Literal["message", "profile", "group"]


class SubmitReportRequest(BaseModel):
    resourceType: ResourceType
    resourceId: str = Field(..., min_length=1, max_length=200)
    groupId: str | None = Field(default=None, max_length=200)
    reason: ReportReason
    context: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def _require_group_for_message(self) -> SubmitReportRequest:
        if self.resourceType == "message" and not self.groupId:
            raise ValueError("groupId is required when resourceType == 'message'")
        return self


class SubmitReportResponse(BaseModel):
    reportId: str
    dedup: bool = False
    severity: int
