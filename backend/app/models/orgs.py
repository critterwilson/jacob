"""Org model — pydantic schemas for the multi-tenant T54 surface.

An org is the parent of one or more groups: a church, a ministry
network, a BJJ school. `groups/{gid}.orgId == null` is the
unaffiliated default; any field shape that touches `orgId` MUST
treat null as a first-class value (the entire Phase 1/2 install is
unaffiliated).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# URL-safe slug (also used as the subdomain claim in T55).
_SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$"
# Reserved prefixes that can never become an org slug — they collide
# with infrastructure subdomains (T55).
RESERVED_SLUGS = frozenset(
    {
        "api",
        "www",
        "admin",
        "app",
        "auth",
        "status",
        "help",
        "docs",
        "static",
        "mail",
        "blog",
        "support",
        "internal",
        "platform",
    }
)

OrgAudience = Literal["christian", "bjj", "general"]


class OrgCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: Annotated[str, Field(min_length=2, max_length=64, pattern=_SLUG_PATTERN)]
    description: str = Field(default="", max_length=1000)
    audience: OrgAudience = "christian"
    initialAdminUid: str = Field(min_length=1, max_length=200)


class OrgCreateResponse(BaseModel):
    orgId: str
    slug: str


class OrgBilling(BaseModel):
    tier: Literal["free", "paid_pilot"] = "free"
    customerId: str | None = None
    status: Literal["active", "suspended"] = "active"


class Org(BaseModel):
    orgId: str
    name: str
    slug: str
    description: str
    audience: OrgAudience
    logoUrl: str | None = None
    primaryColor: str | None = None
    customDomain: str | None = None
    customSubdomain: str | None = None
    createdBy: str | None = None
    createdAt: str | None = None
    schemaVersion: int = 1
    billing: OrgBilling = Field(default_factory=OrgBilling)
    # AI policy toggles. The corresponding tickets (T43/T44/T46/T47)
    # are parked; the schema reserves the shape so the doc doesn't
    # need to reshape when AI lands.
    llmModerationPolicy: Literal["off", "advisory", "aggressive"] = "off"
    threadSummaryEnabled: bool = False
    semanticSearchEnabled: bool = False
    prayerClusteringEnabled: bool = False
    transparencyReportEnabled: bool = False


class OrgListResponse(BaseModel):
    orgs: list[Org]


class OrgAdmin(BaseModel):
    uid: str
    addedBy: str | None
    addedAt: str | None


class OrgAdminListResponse(BaseModel):
    admins: list[OrgAdmin]


class OrgAdminAddRequest(BaseModel):
    uid: str = Field(min_length=1, max_length=200)


class OrgAdminAddResponse(BaseModel):
    orgId: str
    uid: str
    added: bool


class OrgAdminRemoveResponse(BaseModel):
    orgId: str
    uid: str
    removed: bool


class OrgGroupSummary(BaseModel):
    gid: str
    name: str
    memberCount: int
    archivedAt: str | None
    createdAt: str | None


class OrgGroupsResponse(BaseModel):
    groups: list[OrgGroupSummary]


class AttachRequest(BaseModel):
    consentToken: str | None = Field(default=None, max_length=64)


class AttachResponse(BaseModel):
    orgId: str
    gid: str
    consentRequired: bool = False
    consentLinkSent: bool = False


class DetachResponse(BaseModel):
    orgId: str
    gid: str
    detached: bool


class OrgDashboardResponse(BaseModel):
    orgId: str
    name: str
    audience: OrgAudience
    groupCount: int
    memberCount: int
    archivedGroupCount: int
    pendingModerationCount: int


class OrgUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    audience: OrgAudience | None = None
    primaryColor: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="CSS hex color, six-digit form (e.g. '#0E5CAB')",
    )


# ── T55 custom domains ───────────────────────────────────────────────────────


class SubdomainClaimRequest(BaseModel):
    subdomain: Annotated[
        str,
        Field(min_length=3, max_length=40, pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"),
    ]


class SubdomainClaimResponse(BaseModel):
    orgId: str
    subdomain: str
    hostname: str


class VanityClaimRequest(BaseModel):
    hostname: Annotated[
        str,
        Field(min_length=4, max_length=253, pattern=r"^[a-z0-9.-]+$"),
    ]


class VanityClaimResponse(BaseModel):
    orgId: str
    hostname: str
    txtRecord: str
    instructions: str


class CustomDomainStatus(BaseModel):
    hostname: str
    status: Literal["pending", "verified", "active", "failed"]
    certStatus: Literal["not_started", "provisioning", "active", "failed"]
    verifiedAt: str | None
    txtRecord: str | None


class CustomDomainStatusResponse(BaseModel):
    orgId: str
    customDomain: CustomDomainStatus | None
    customSubdomain: str | None
    customSubdomainHostname: str | None
    message: str | None = None


class DomainReleaseResponse(BaseModel):
    orgId: str
    released: bool


class OrgByHostResponse(BaseModel):
    orgId: str
    name: str
    audience: OrgAudience
    logoUrl: str | None
    primaryColor: str | None
