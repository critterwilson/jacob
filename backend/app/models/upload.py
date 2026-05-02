from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

UploadPurpose = Literal["message", "avatar"]
SupportedMimeType = Literal["image/jpeg", "image/png", "image/webp"]

MAX_PHOTO_BYTES = 8 * 1024 * 1024


class CreateUploadRequest(BaseModel):
    purpose: UploadPurpose
    mimeType: SupportedMimeType
    byteCount: int = Field(gt=0, le=MAX_PHOTO_BYTES)
    groupId: str | None = None


class CreateUploadResponse(BaseModel):
    uploadId: str
    uploadUrl: str
    expiresAt: str


class FinalizeUploadResponse(BaseModel):
    publicUrl: str
