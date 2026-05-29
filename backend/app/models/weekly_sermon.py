"""Pydantic models for the weekly sermon (org-wide single-active video).

One document per ISO week (`weekly_sermons/{YYYY-Www}`) so there is a
natural single-active entry. Owners (`ministry_owner` claim) publish or
overwrite the current week's video; every signed-in member reads it.
All access flows through `/api/weekly-sermon*`; default-deny rules keep
the direct Firestore path closed.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class WeeklySermon(BaseModel):
    model_config = ConfigDict(extra="ignore")

    weekKey: str
    videoUrl: str
    title: str
    description: str = ""
    # ISO-8601 string (serialised from the Firestore server timestamp).
    postedAt: str | None = None
    postedBy: str | None = None
    weekStart: str | None = None


class WeeklySermonResponse(BaseModel):
    """Wraps the sermon so the absent case is a 200 with `sermon: null`
    rather than a 404 — the home hero renders an empty state, not an
    error, when nothing has been posted yet."""

    sermon: WeeklySermon | None = None


class WeeklySermonUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    videoUrl: HttpUrl
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=8000)
    # Optional override; defaults to the current ISO week. Format `YYYY-Www`.
    weekKey: str | None = Field(default=None, pattern=r"^\d{4}-W\d{2}$")


class WeeklySermonPatchRequest(BaseModel):
    """All fields optional; only those present are updated. Targets the
    current ISO week unless `weekKey` is supplied."""

    model_config = ConfigDict(extra="forbid")

    videoUrl: HttpUrl | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    weekKey: str | None = Field(default=None, pattern=r"^\d{4}-W\d{2}$")
