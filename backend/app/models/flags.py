"""Pydantic models for the feature-flag surface (T58).

Flags are stored at `feature_flags/{flagKey}` and evaluated server-side.
The frontend never reads the raw flag doc — it calls `GET /api/flags`,
which returns a `{flagKey: bool}` map evaluated for the current user.
That fits the M6 backend-mediated architecture and removes the
cross-runtime hash-parity concern from the spec.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

# A short, lowercase, snake_case identifier. Matches the naming convention
# documented in `docs/runbooks/feature-flags.md`. Encoded as a Field
# `pattern` (not a custom validator) so 422s round-trip through the
# project-wide JSON error handler — a custom validator that raises
# ValueError leaves an unserialisable exception in `ctx`.
_FLAG_KEY_PATTERN = r"^[a-z][a-z0-9_]{2,63}$"

CohortRole = Literal["admin", "leader", "member"]


class FeatureFlagCohorts(BaseModel):
    orgIds: list[str] = Field(default_factory=list, max_length=200)
    roles: list[CohortRole] = Field(default_factory=list, max_length=10)
    uids: list[str] = Field(default_factory=list, max_length=500)


class FeatureFlag(BaseModel):
    flagKey: str
    enabled: bool
    rolloutPercentage: int = Field(ge=0, le=100)
    cohorts: FeatureFlagCohorts
    description: str = ""
    updatedBy: str | None = None
    updatedAt: str | None = None
    fullRolloutAt: str | None = None
    schemaVersion: int = 1


class FeatureFlagListResponse(BaseModel):
    flags: list[FeatureFlag]


class FeatureFlagUpsertRequest(BaseModel):
    flagKey: Annotated[str, Field(pattern=_FLAG_KEY_PATTERN)]
    enabled: bool
    rolloutPercentage: int = Field(ge=0, le=100)
    cohorts: FeatureFlagCohorts = Field(default_factory=FeatureFlagCohorts)
    description: str = Field(default="", max_length=500)


class FeatureFlagPercentageRequest(BaseModel):
    rolloutPercentage: int = Field(ge=0, le=100)


class FeatureFlagDeleteResponse(BaseModel):
    flagKey: str
    deleted: bool


class EvaluatedFlagsResponse(BaseModel):
    """Returned by `GET /api/flags`: map of flagKey -> bool for the caller.

    Unknown keys default to `false` on the client (caller should treat a
    missing entry as disabled, same as if the flag did not exist).
    """

    flags: dict[str, bool]


class FlagAuditEntry(BaseModel):
    eventId: str
    actorUid: str
    action: str
    createdAt: str | None
    payload: dict[str, Any]


class FlagAuditResponse(BaseModel):
    flagKey: str
    entries: list[FlagAuditEntry]
