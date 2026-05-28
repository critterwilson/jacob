"""Models for the devotionals + reading-plans surface (T51).

Two top-level content collections (`devotionals/{slug}`,
`reading_plans/{slug}`) and a per-user progress subcollection
(`users/{uid}/plan_progress/{planSlug}`). All reads go through the
backend per M6.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Audience = Literal["christian", "general"]


class Devotional(BaseModel):
    # The title-derived slug (e.g. "the-lord-is-my-shepherd"). Doesn't
    # include the scope/author-hash prefix; combine with `path` for the
    # full URL part.
    slug: str
    # Canonical URL path segment under `/devotionals/`:
    #   platform-wide → "org/<slug>"
    #   group-scoped  → "group/<authorHash>/<slug>"
    # Frontend constructs links as `/devotionals/${path}`. Legacy docs
    # written before the rename still expose `path = slug` so the old
    # `/devotionals/[slug]` route keeps resolving.
    path: str
    title: str
    scriptureRef: str
    body: str
    audioUrl: str | None
    sourceAttribution: str
    publishedAt: str | None
    audience: Audience
    # `groupId is None` => platform-wide (ministry-owner-authored).
    # `groupId` set => scoped to that group (leader-authored); visible
    # only to members of the named group.
    groupId: str | None = None
    # Hydrated by list endpoints that merge across groups so the UI can
    # label which group a devotional came from. None on platform-wide
    # entries and on responses where the group context is already
    # implied (e.g. /api/groups/{gid}/devotionals).
    groupName: str | None = None
    # Stable, non-reversible 8-char base32 hash of the author's UID.
    # Set on group-scoped devotionals (used as the second URL segment)
    # and null on platform-wide ones.
    authorHash: str | None = None
    # 1 = legacy (slug-as-doc-ID); 2 = path-based (org__/group__ doc IDs).
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


class ReadingPlanDayInput(BaseModel):
    scriptureRef: str = Field(min_length=1, max_length=200)
    prompt: str = Field(default="", max_length=500)


class ReadingPlanCreateRequest(BaseModel):
    """Authors do NOT type a slug; the server derives one from `title`
    via `app.services.slugs.slugify_title` + `next_available_slug`
    (mirrors the boards + devotionals pattern post-2026-05)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    days: list[ReadingPlanDayInput] = Field(min_length=1, max_length=365)
    audience: Audience = "christian"


class ReadingPlanUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    days: list[ReadingPlanDayInput] | None = Field(default=None, min_length=1, max_length=365)
    audience: Audience | None = None


class MarkDayCompleteRequest(BaseModel):
    dayNumber: int = Field(ge=1, le=365)


class MarkDayCompleteResponse(BaseModel):
    planSlug: str
    completedDays: list[int]
    streak: int
    lastCompletedAt: str


class DevotionalCreateRequest(BaseModel):
    # Slug is derived server-side from the title — the form no longer
    # asks for one. On collision within the (scope, authorHash) doc-ID
    # namespace, a numeric suffix is appended.
    title: str = Field(min_length=1, max_length=200)
    scriptureRef: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    audioUrl: str | None = Field(default=None, max_length=2000)
    sourceAttribution: str = Field(default="", max_length=500)
    publishedAt: str | None = Field(
        default=None, description="ISO date string YYYY-MM-DD; defaults to now."
    )
    audience: Audience = "christian"
    # When present, authoring is gated on the caller being a leader of
    # that group; the resulting devotional is visible only to members of
    # that group. When absent/null, authoring requires `ministry_owner`
    # and the devotional surfaces platform-wide.
    groupId: str | None = Field(default=None, max_length=64)


class DevotionalUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    scriptureRef: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    audioUrl: str | None = None
    sourceAttribution: str | None = Field(default=None, max_length=500)
    publishedAt: str | None = Field(default=None, description="ISO date string YYYY-MM-DD.")
    audience: Audience | None = None


class ActivePlanToday(BaseModel):
    """Composite "today's reading plan" payload for the home surface.

    Picks the user's most-recently-engaged plan from `plan_progress`,
    joins with the plan content, and surfaces the next uncompleted day.
    `plan` is null when the user has no plan_progress at all — the
    frontend uses that to render the "start a plan" empty state.
    """

    plan: ReadingPlanSummary | None
    nextDay: ReadingPlanDay | None
    completedDays: list[int] = Field(default_factory=list)
    streak: int = 0
    lastCompletedAt: str | None = None
    allDaysComplete: bool = False
