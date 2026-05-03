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


# ── T38 — self-serve data export (GDPR DSAR) ─────────────────────────────────


class ExportRequest(BaseModel):
    pass


class ExportJobResponse(BaseModel):
    """Response shape for both POST /export and GET /export/status."""

    jobId: str
    status: Literal["queued", "processing", "ready", "failed", "expired", "none"]
    requestedAt: str | None = None
    completedAt: str | None = None
    expiresAt: str | None = None
    failureReason: str | None = None
    byteCount: int | None = None
    schemaVersion: int = 1
    # Only populated when status == "ready" *and* the URL is still within TTL.
    # Returned alongside the in-app "Download" redirect so users who lose the
    # email can still copy/paste the link.
    downloadUrl: str | None = None
