from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class StickerMixItem(BaseModel):
    slug: str
    count: int
    percent: float


class ContributorItem(BaseModel):
    uid: str
    displayName: str
    count: int


class CadencePoint(BaseModel):
    day: str  # ISO date, e.g. "2026-04-25"
    count: int


class EventAttendancePoint(BaseModel):
    """T60 — per-event attendance ratio for the leader-side roster."""

    eventId: str
    title: str
    startsAt: str  # ISO-8601
    rsvpGoing: int
    attended: int


class SentimentPoint(BaseModel):
    """T60 — rolling sentiment indicator from moderation_queue.severity.

    Scope: aggregate only — never per-message. The runbook calls out
    "do not weaponise this against members."
    """

    day: str  # ISO date
    avgSeverity: float
    count: int


class AnalyticsResponse(BaseModel):
    gid: str
    range: Literal["7d", "30d"]
    totalMessages: int
    stickerMix: list[StickerMixItem]
    topContributors: list[ContributorItem]
    cadenceByDay: list[CadencePoint]
    generatedAt: str  # ISO-8601
    # T60 — extensions. Optional so the existing AnalyticsResponse
    # consumers continue to work; populated when the Firestore-side
    # aggregator runs.
    eventAttendance: list[EventAttendancePoint] = []
    sentimentTrend: list[SentimentPoint] = []


class OrgAnalyticsGroupSlice(BaseModel):
    """Per-group slice in an org-aggregated dashboard payload."""

    gid: str
    name: str
    totalMessages: int
    eventAttended: int
    activeMembers: int


class OrgAnalyticsResponse(BaseModel):
    orgId: str
    range: Literal["7d", "30d"]
    groupCount: int
    activeMembers: int
    totalMessages: int
    eventAttendance: list[EventAttendancePoint]
    sentimentTrend: list[SentimentPoint]
    groups: list[OrgAnalyticsGroupSlice]
    generatedAt: str
