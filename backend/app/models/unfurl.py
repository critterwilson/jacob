"""Models for the T53 unfurl surface."""

from __future__ import annotations

from pydantic import BaseModel, HttpUrl


class UnfurlRequest(BaseModel):
    url: HttpUrl


class UnfurlResponse(BaseModel):
    url: str
    title: str | None
    description: str | None
    imageUrl: str | None
    siteName: str | None
