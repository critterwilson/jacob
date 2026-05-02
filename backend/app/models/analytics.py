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


class AnalyticsResponse(BaseModel):
    gid: str
    range: Literal["7d", "30d"]
    totalMessages: int
    stickerMix: list[StickerMixItem]
    topContributors: list[ContributorItem]
    cadenceByDay: list[CadencePoint]
    generatedAt: str  # ISO-8601
