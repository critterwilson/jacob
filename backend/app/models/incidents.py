"""Models for the T59 active-incidents surface.

Incidents drive the in-app banner the on-call flips during a SEV1/2.
The doc lives at `active_incidents/{incidentId}` and is read by every
client on every page load (single-collection scan, expected ≤ a handful
of docs at any time).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["SEV1", "SEV2", "SEV3"]


class IncidentDeclareRequest(BaseModel):
    severity: Severity
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=2000)
    # How long the banner should stay up before auto-clearing. Min 15
    # minutes (anything shorter is operator error); max 24 hours (after
    # that you're handling an incident, not a flash banner).
    displayMinutes: int = Field(ge=15, le=1440)


class IncidentDeclareResponse(BaseModel):
    incidentId: str
    severity: Severity
    title: str
    displayUntil: str


class IncidentClearResponse(BaseModel):
    incidentId: str
    cleared: bool


class ActiveIncident(BaseModel):
    incidentId: str
    severity: Severity
    title: str
    body: str
    createdBy: str | None
    createdAt: str | None
    displayUntil: str
    acknowledged: bool


class ActiveIncidentsResponse(BaseModel):
    incidents: list[ActiveIncident]
