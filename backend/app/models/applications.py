"""Pydantic models for the admin-approval signup flow.

See `docs/adr/0011-admin-approval-signup.md` for the design. The
`applications/{uid}` doc is the queueing object; once an admin approves
it, the backend copies the relevant fields into `users/{uid}` and the
application doc records the decision.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

ApplicationStatus = str  # "pending" | "approved" | "rejected"


class SubmitApplicationRequest(BaseModel):
    """`POST /api/applications/me` body.

    Mirrors the previous `CreateProfileRequest` plus the load-bearing
    `dob` field that drives the under-18 detection. The server computes
    `isMinor` from `dob`; client-supplied `isMinor` is ignored on
    purpose (we never trust a self-reported minor flag).
    """

    model_config = ConfigDict(extra="forbid")

    displayName: str = Field(min_length=1, max_length=100)
    dob: date  # ISO YYYY-MM-DD
    photoURL: HttpUrl | None = None
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=100)
    faithBackground: str | None = Field(default=None, max_length=500)


class ApplicationView(BaseModel):
    """`GET /api/applications/me` and admin-list response item."""

    uid: str
    email: str | None
    displayName: str
    photoURL: str | None = None
    dob: date | None = None
    age: int | None = None
    isMinor: bool
    phone: str | None = None
    location: str | None = None
    faithBackground: str | None = None
    status: ApplicationStatus
    createdAt: datetime | None = None
    submittedAt: datetime | None = None
    decidedAt: datetime | None = None
    decidedBy: str | None = None
    parentalConsentObtained: bool | None = None
    parentalConsentNotes: str = ""
    rejectionReason: str = ""
    grandfathered: bool = False


class ApplicationListResponse(BaseModel):
    items: list[ApplicationView]
    nextCursor: str | None = None


class ApproveApplicationRequest(BaseModel):
    """`POST /api/admin/applications/{uid}/approve` body.

    Both fields are admin-supplied. The backend enforces:
    `isMinor === true` ⇒ `parentalConsentObtained === true` (else 422).
    For 18+ applicants, the parental-consent fields are accepted but
    optional and have no enforcement impact.
    """

    model_config = ConfigDict(extra="forbid")

    parentalConsentObtained: bool | None = None
    parentalConsentNotes: str = Field(default="", max_length=2000)


class RejectApplicationRequest(BaseModel):
    """`POST /api/admin/applications/{uid}/reject` body."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)


class ApplicationDecisionResponse(BaseModel):
    uid: str
    status: ApplicationStatus
