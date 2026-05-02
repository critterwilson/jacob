from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class DeleteAccountRequest(BaseModel):
    keepBody: bool = True


class DeleteAccountResponse(BaseModel):
    deletionRequestedAt: str
    finalizeAt: str
    keepBody: bool


class CancelDeleteResponse(BaseModel):
    cancelled: bool


class DeleteStatusResponse(BaseModel):
    status: Literal["none", "pending"]
    deletionRequestedAt: str | None = None
    finalizeAt: str | None = None
    keepBody: bool | None = None
