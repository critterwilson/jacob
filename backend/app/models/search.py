"""Pydantic models for the search endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    """A single search hit."""

    messageRef: str  # "groups/{gid}/messages/{mid}"
    groupId: str
    authorUid: str
    authorDisplayName: str | None = None
    body: str  # Plain text — frontend escapes for rendering.
    createdAt: str  # ISO 8601 (UTC)
    parentMessageId: str | None = None


class SearchResponse(BaseModel):
    hits: list[SearchResult] = Field(default_factory=list)
    total: int
    page: int
    limit: int
