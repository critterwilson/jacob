"""Pydantic models for group meeting addresses + visitor discovery.

A group's meeting address (often a member's home) is sensitive, so the
default visibility is `private` and publishing to `public` requires
ministry-owner approval. The fields ride on the `groups/{gid}` document;
see `docs/data-model.md` § `groups/{gid}` for the stored shape.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Effective visibility of a meeting address.
#   private       — only leaders/owner see it (default).
#   members_only  — group members (and leaders/owner) see it.
#   public        — anyone (incl. non-members) sees it + appears in discover.
Visibility = Literal["private", "members_only", "public"]


class MeetingAddressInput(BaseModel):
    """Address fields a leader supplies via `PUT`.

    Coordinates are NOT accepted from the client — the server geocodes
    the address and caches `lat`/`lng` itself, so a client cannot spoof a
    location far from the typed address.
    """

    model_config = ConfigDict(extra="forbid")

    street: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=120)
    state: str = Field(default="", max_length=120)
    postalCode: str = Field(default="", max_length=20)
    country: str = Field(default="", max_length=120)
    # Requested EFFECTIVE visibility. `public` enters the pending-owner-
    # approval state; `private`/`members_only` apply immediately.
    visibility: Visibility = "private"


class MeetingAddress(BaseModel):
    """The stored/returned address object (coords may be null)."""

    model_config = ConfigDict(extra="ignore")

    street: str
    city: str
    state: str = ""
    postalCode: str = ""
    country: str = ""
    lat: float | None = None
    lng: float | None = None
    # ISO-8601 string; when the lat/lng were last resolved.
    geocodedAt: str | None = None


class MeetingAddressResponse(BaseModel):
    """`GET /api/groups/{gid}/meeting-address`.

    `address` is null when the group has no address or the caller is not
    permitted to see it at the current visibility. `visibility` is the
    EFFECTIVE visibility. `pendingPublic` is only populated for
    leaders/owner so the UI can show "public request awaiting approval".
    `canManage` is true for leaders/owner.
    """

    address: MeetingAddress | None = None
    visibility: Visibility = "private"
    pendingPublic: bool = False
    canManage: bool = False


class MeetingAddressUpdateResponse(BaseModel):
    """`PUT /api/groups/{gid}/meeting-address` result.

    `visibility` is the EFFECTIVE visibility after the write — for a
    `public` request this stays at the safe current value (or
    `members_only`) while `pendingPublic` is true, until an owner approves.
    """

    gid: str
    address: MeetingAddress
    visibility: Visibility
    pendingPublic: bool = False


class PendingPublicAddress(BaseModel):
    """One row in the owner approval queue."""

    gid: str
    groupName: str = ""
    address: MeetingAddress
    # The visibility the address currently shows at while the public
    # request is pending (the safe fallback).
    currentVisibility: Visibility


class PendingPublicAddressesResponse(BaseModel):
    requests: list[PendingPublicAddress]
    nextCursor: str | None = None


class ApprovalResponse(BaseModel):
    gid: str
    visibility: Visibility
    pendingPublic: bool


class NearbyGroup(BaseModel):
    """A public-approved group meeting address with computed distance."""

    gid: str
    name: str = ""
    city: str = ""
    state: str = ""
    lat: float
    lng: float
    # Great-circle distance from the origin, in kilometres, rounded.
    distanceKm: float


class NearbyGroupsResponse(BaseModel):
    origin: dict[str, float]
    groups: list[NearbyGroup]
    nextCursor: str | None = None
