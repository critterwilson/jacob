"""Pydantic models for the T63 NCMEC reporting surface.

Cases live at `ncmec_cases/{caseId}`. Per M6 the collection
default-denies client access — `/api/admin/ncmec*` is the only path.

The full lifecycle:
  pending → (operator approval) → submitted (or failed)
  pending → (operator override) → withdrawn (false positive)

Withdrawal of a *submitted* case files a withdrawal report with
NCMEC; v1 stops short of actually wiring the NCMEC HTTP call (see
ADR 0010 — operator-account onboarding is the gating step).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

CaseStatus = Literal["pending", "submitted", "withdrawn", "failed"]
HashSource = Literal["photodna", "pdq", "other"]


class NcmecEvidence(BaseModel):
    gcsPath: str  # `_held/...` (immutable)
    sha256: str
    sizeBytes: int
    contentType: str | None = None


class NcmecCase(BaseModel):
    caseId: str
    matchedAt: str | None
    hashSource: HashSource
    hashValue: str
    evidence: NcmecEvidence
    reporterUid: str | None
    suspectUid: str | None
    status: CaseStatus
    submittedBy: str | None
    submittedAt: str | None
    ncmecReportId: str | None
    retainedUntil: str | None
    withdrawnReason: str | None
    failureReason: str | None
    schemaVersion: int = 1


class NcmecCaseListResponse(BaseModel):
    cases: list[NcmecCase]


class NcmecSubmitConfirmation(BaseModel):
    """Typed-confirmation guard. The operator types `SUBMIT` to confirm."""

    confirm: Annotated[str, Field(pattern=r"^SUBMIT$")]


class NcmecSubmitResponse(BaseModel):
    caseId: str
    status: CaseStatus
    ncmecReportId: str | None
    submittedAt: str | None


class NcmecWithdrawRequest(BaseModel):
    reason: str = Field(min_length=50, max_length=2000)


class NcmecWithdrawResponse(BaseModel):
    caseId: str
    status: CaseStatus
    withdrawnReason: str
