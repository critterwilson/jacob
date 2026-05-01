from __future__ import annotations

from pydantic import BaseModel, Field


class CurrentUser(BaseModel):
    uid: str
    email: str | None = None
    claims: dict[str, object] = Field(default_factory=dict)
