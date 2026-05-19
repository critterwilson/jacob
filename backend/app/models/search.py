"""Pydantic models for the T28 search endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    """A single search hit, normalised from a Typesense document."""

    messageRef: str  # "groups/{gid}/messages/{mid}"
    groupId: str
    authorUid: str
    authorDisplayName: str | None = None
    body: str  # snippet (HTML allowed; <mark> only — sanitised on frontend)
    createdAt: str  # ISO 8601 (UTC)
    parentMessageId: str | None = None


class SearchResponse(BaseModel):
    hits: list[SearchResult] = Field(default_factory=list)
    total: int
    page: int
    limit: int
