"""Models for the devotionals + reading-plans surface (T51).

Two top-level content collections (`devotionals/{slug}`,
`reading_plans/{slug}`) and a per-user progress subcollection
(`users/{uid}/plan_progress/{planSlug}`). All reads go through the
backend per M6.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Audience = Literal["christian", "general"]


class Devotional(BaseModel):
    slug: str
    title: str
    scriptureRef: str
    body: str
    audioUrl: str | None
    sourceAttribution: str
    publishedAt: str | None
    audience: Audience
    schemaVersion: int = 1


class DevotionalListResponse(BaseModel):
    devotionals: list[Devotional]


class ReadingPlanDay(BaseModel):
    dayNumber: int
    scriptureRef: str
    prompt: str


class ReadingPlan(BaseModel):
    slug: str
    title: str
    description: str
    days: list[ReadingPlanDay]
    duration: int
    audience: Audience
    publishedAt: str | None
    schemaVersion: int = 1


class ReadingPlanSummary(BaseModel):
    """Index entry — drops the day list for the listing page."""

    slug: str
    title: str
    description: str
    duration: int
    audience: Audience
    publishedAt: str | None


class ReadingPlanListResponse(BaseModel):
    plans: list[ReadingPlanSummary]


class PlanProgress(BaseModel):
    planSlug: str
    startedAt: str | None
    completedDays: list[int] = Field(default_factory=list)
    streak: int = 0
    lastCompletedAt: str | None


class MarkDayCompleteRequest(BaseModel):
    dayNumber: int = Field(ge=1, le=365)


class MarkDayCompleteResponse(BaseModel):
    planSlug: str
    completedDays: list[int]
    streak: int
    lastCompletedAt: str
