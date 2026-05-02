from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class CreateInviteRequest(BaseModel):
    expiry: Literal["never", "24h", "7d", "30d"] = "never"
    maxUses: Literal["unlimited", "1", "10", "25"] = "unlimited"


class InviteResponse(BaseModel):
    inviteId: str
    code: str
    url: str
    expiresAt: str | None
    maxUses: int | None
    useCount: int
    lastUsedAt: str | None
    revokedAt: str | None


class InviteListResponse(BaseModel):
    invites: list[InviteResponse]
