"""Org router (T54).

Endpoints:

* `POST   /api/orgs`                              — platform admin create
* `GET    /api/orgs`                              — platform admin list
* `GET    /api/orgs/{orgId}`                      — org member or admin read
* `PATCH  /api/orgs/{orgId}`                      — org admin update
* `GET    /api/orgs/{orgId}/dashboard`            — org admin dashboard
* `GET    /api/orgs/{orgId}/groups`               — org admin list groups
* `GET    /api/orgs/{orgId}/admins`               — org admin list admins
* `POST   /api/orgs/{orgId}/admins`               — org admin add
* `DELETE /api/orgs/{orgId}/admins/{uid}`         — org admin remove
* `POST   /api/orgs/{orgId}/groups/{gid}/attach`  — org admin attach group
* `POST   /api/orgs/{orgId}/groups/{gid}/detach`  — org admin detach group

Authorization is enforced in the handler; per M6 the
`firestore.rules` for `orgs/*` default-deny client access.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin, require_not_banned
from app.errors import APIError
from app.limits import (
    ADMIN_LIST,
    ADMIN_MUTATION,
    ANALYTICS_QUERY,
    DOMAIN_BY_HOST,
    DOMAIN_VERIFY,
    ORG_ADMIN_MUTATION,
    ORG_CREATE,
    ORG_READ,
)
from app.middleware.rate_limit import limiter
from app.models.orgs import (
    AttachRequest,
    AttachResponse,
    CustomDomainStatus,
    CustomDomainStatusResponse,
    DetachResponse,
    DomainReleaseResponse,
    Org,
    OrgAdmin,
    OrgAdminAddRequest,
    OrgAdminAddResponse,
    OrgAdminListResponse,
    OrgAdminRemoveResponse,
    OrgBilling,
    OrgByHostResponse,
    OrgCreateRequest,
    OrgCreateResponse,
    OrgDashboardResponse,
    OrgGroupsResponse,
    OrgGroupSummary,
    OrgListResponse,
    OrgUpdateRequest,
    SubdomainClaimRequest,
    SubdomainClaimResponse,
    VanityClaimRequest,
    VanityClaimResponse,
)
from app.models.user import CurrentUser
from app.services import domains as domains_service
from app.services import orgs as orgs_service
from app.services.audit import write_audit_log
from app.services.email import send_email
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orgs", tags=["orgs"])
# Public host-lookup surface lives at /api/by-host so it doesn't
# collide with `/api/orgs/{org_id}` path matching (FastAPI routes are
# first-match-wins; `/api/orgs/by-host` would otherwise be captured
# as `org_id="by-host"`).
public_router = APIRouter(tags=["orgs"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_str(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        result: str = ts.isoformat()
        return result
    except AttributeError:
        return str(ts)


def _doc_to_org(doc: dict[str, Any]) -> Org:
    billing_data = doc.get("billing") or {}
    return Org(
        orgId=doc["orgId"],
        name=str(doc.get("name", "")),
        slug=str(doc.get("slug", "")),
        description=str(doc.get("description", "")),
        audience=doc.get("audience", "christian"),
        logoUrl=doc.get("logoUrl"),
        primaryColor=doc.get("primaryColor"),
        customDomain=doc.get("customDomain"),
        customSubdomain=doc.get("customSubdomain"),
        createdBy=doc.get("createdBy"),
        createdAt=_ts_to_str(doc.get("createdAt")),
        schemaVersion=int(doc.get("schemaVersion", 1) or 1),
        billing=OrgBilling(
            tier=billing_data.get("tier", "free"),
            customerId=billing_data.get("customerId"),
            status=billing_data.get("status", "active"),
        ),
        llmModerationPolicy=doc.get("llmModerationPolicy", "off"),
        threadSummaryEnabled=bool(doc.get("threadSummaryEnabled", False)),
        semanticSearchEnabled=bool(doc.get("semanticSearchEnabled", False)),
        prayerClusteringEnabled=bool(doc.get("prayerClusteringEnabled", False)),
        transparencyReportEnabled=bool(doc.get("transparencyReportEnabled", False)),
    )


def _require_org_admin(db: Any, org_id: str, user: CurrentUser) -> None:
    """403 unless the caller is an org admin (or platform admin)."""
    if user.claims.get("admin") is True:
        return
    if not orgs_service.org_exists(db, org_id):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="org_not_found",
            message="Org not found",
        )
    if not orgs_service.is_org_admin(db, org_id, user.uid):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Org admin privileges required",
        )


def _require_org_member_or_admin(db: Any, org_id: str, user: CurrentUser) -> None:
    """403 unless the caller is in the org or is admin."""
    if user.claims.get("admin") is True:
        return
    if not orgs_service.org_exists(db, org_id):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="org_not_found",
            message="Org not found",
        )
    if orgs_service.is_org_admin(db, org_id, user.uid):
        return
    member_snap = (
        db.collection("orgs").document(org_id).collection("members").document(user.uid).get()
    )
    if not member_snap.exists:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Not a member of this org",
        )


# ── platform-admin: create + list orgs ───────────────────────────────────────


@router.post(
    "",
    response_model=OrgCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(ORG_CREATE)
def create_org(
    request: Request,
    response: Response,
    body: OrgCreateRequest,
    admin: CurrentUser = Depends(require_admin),
) -> OrgCreateResponse:
    db = _db()
    try:
        org_id = orgs_service.create_org(
            db,
            actor_uid=admin.uid,
            name=body.name,
            slug=body.slug,
            description=body.description,
            audience=body.audience,
            initial_admin_uid=body.initialAdminUid,
        )
    except ValueError as exc:
        if str(exc) == "slug_taken":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="slug_taken",
                message=f"Slug {body.slug!r} is already in use or reserved",
            ) from exc
        raise

    write_audit_log(
        actor_uid=admin.uid,
        action="org_create",
        target_ref=f"orgs/{org_id}",
        payload={
            "slug": body.slug,
            "audience": body.audience,
            "initialAdminUid": body.initialAdminUid,
        },
    )
    return OrgCreateResponse(orgId=org_id, slug=body.slug)


@router.get("", response_model=OrgListResponse)
@limiter.limit(ADMIN_LIST)
def list_orgs(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> OrgListResponse:
    db = _db()
    return OrgListResponse(orgs=[_doc_to_org(d) for d in orgs_service.list_orgs(db)])


# ── per-org read + update ────────────────────────────────────────────────────


@router.get("/{org_id}", response_model=Org)
@limiter.limit(ORG_READ)
def get_org(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> Org:
    db = _db()
    _require_org_member_or_admin(db, org_id, user)
    snap = db.collection("orgs").document(org_id).get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="org_not_found",
            message="Org not found",
        )
    data = snap.to_dict() or {}
    data["orgId"] = snap.id
    return _doc_to_org(data)


@router.patch("/{org_id}", response_model=Org)
@limiter.limit(ORG_ADMIN_MUTATION)
def update_org(
    org_id: str,
    request: Request,
    response: Response,
    body: OrgUpdateRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> Org:
    db = _db()
    _require_org_admin(db, org_id, user)
    update: dict[str, Any] = {}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.audience is not None:
        update["audience"] = body.audience
    if body.primaryColor is not None:
        update["primaryColor"] = body.primaryColor
    if not update:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_update",
            message="No mutable fields supplied",
        )
    org_ref = db.collection("orgs").document(org_id)
    org_ref.update(update)
    write_audit_log(
        actor_uid=user.uid,
        action="org_update",
        target_ref=f"orgs/{org_id}",
        payload={"changedKeys": sorted(update.keys())},
    )
    snap = org_ref.get()
    data = snap.to_dict() or {}
    data["orgId"] = snap.id
    return _doc_to_org(data)


@router.get("/{org_id}/dashboard", response_model=OrgDashboardResponse)
@limiter.limit(ANALYTICS_QUERY)
def get_dashboard(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> OrgDashboardResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    payload = orgs_service.dashboard_for(db, org_id)
    return OrgDashboardResponse(**payload)


# ── groups under the org ─────────────────────────────────────────────────────


@router.get("/{org_id}/groups", response_model=OrgGroupsResponse)
@limiter.limit(ORG_READ)
def list_groups(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> OrgGroupsResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    rows: list[OrgGroupSummary] = []
    for doc in orgs_service.list_org_groups(db, org_id):
        rows.append(
            OrgGroupSummary(
                gid=doc["gid"],
                name=str(doc.get("name", "")),
                memberCount=int(doc.get("memberCount", 0) or 0),
                archivedAt=_ts_to_str(doc.get("archivedAt")),
                createdAt=_ts_to_str(doc.get("createdAt")),
            )
        )
    return OrgGroupsResponse(groups=rows)


@router.post(
    "/{org_id}/groups/{gid}/attach",
    response_model=AttachResponse,
)
@limiter.limit(ORG_ADMIN_MUTATION)
def attach_group(
    org_id: str,
    gid: str,
    request: Request,
    response: Response,
    body: AttachRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> AttachResponse:
    db = _db()
    _require_org_admin(db, org_id, user)

    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )

    existing_org = (group_snap.to_dict() or {}).get("orgId")
    if existing_org == org_id:
        # Idempotent: attaching an already-attached group is a no-op.
        return AttachResponse(orgId=org_id, gid=gid)
    if existing_org:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="group_attached_elsewhere",
            message=f"Group is already attached to org {existing_org}",
        )

    members_col = group_ref.collection("members")
    leader_uids = [snap.id for snap in members_col.where("role", "==", "leader").stream()]
    if not leader_uids:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="no_leaders",
            message="Group has no leaders to grant consent",
        )

    # Path 1: the org admin is also the sole leader of the target group.
    actor_is_only_leader = leader_uids == [user.uid]

    # Path 2: a valid consent token was supplied.
    if body.consentToken:
        ok, reason = orgs_service.consume_consent_token(
            db,
            token=body.consentToken,
            org_id=org_id,
            gid=gid,
        )
        if not ok:
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code=f"consent_{reason}",
                message=f"Consent token rejected: {reason}",
            )
    elif not actor_is_only_leader:
        # Path 3: issue a token, email each leader, return 409. The
        # client polls / tries again with the supplied token.
        token = orgs_service.issue_consent_token(
            db,
            org_id=org_id,
            gid=gid,
            issued_to=leader_uids[0],
            issued_by=user.uid,
        )
        for leader_uid in leader_uids:
            user_snap = db.collection("users").document(leader_uid).get()
            if not user_snap.exists:
                continue
            email_addr = (user_snap.to_dict() or {}).get("email")
            if not email_addr:
                continue
            display_name = (user_snap.to_dict() or {}).get("displayName", "there")
            try:
                send_email(
                    to_email=email_addr,
                    display_name=display_name,
                    template_name="org_consent_request",
                    subject="An organization wants to add your group",
                    context={
                        "displayName": display_name,
                        "orgId": org_id,
                        "gid": gid,
                        "consentToken": token,
                    },
                )
            except Exception:  # noqa: BLE001
                # Email failure is best-effort; the org admin can re-issue.
                logger.exception(
                    "consent_email_failed org=%s gid=%s leader=%s",
                    org_id,
                    gid,
                    leader_uid,
                )
        write_audit_log(
            actor_uid=user.uid,
            action="org_attach_consent_requested",
            target_ref=f"orgs/{org_id}/groups/{gid}",
            payload={"leaderCount": len(leader_uids)},
        )
        return AttachResponse(
            orgId=org_id,
            gid=gid,
            consentRequired=True,
            consentLinkSent=True,
        )

    try:
        orgs_service.attach_group(db, org_id=org_id, gid=gid, actor_uid=user.uid)
    except ValueError as exc:
        if str(exc) == "audience_mismatch":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="audience_mismatch",
                message="Group audience does not match the org's audience",
            ) from exc
        raise

    write_audit_log(
        actor_uid=user.uid,
        action="org_attach_group",
        target_ref=f"orgs/{org_id}/groups/{gid}",
        payload={
            "consentTokenUsed": body.consentToken is not None,
            "actorWasOnlyLeader": actor_is_only_leader,
        },
    )
    return AttachResponse(orgId=org_id, gid=gid)


@router.post(
    "/{org_id}/groups/{gid}/detach",
    response_model=DetachResponse,
)
@limiter.limit(ORG_ADMIN_MUTATION)
def detach_group(
    org_id: str,
    gid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_not_banned),
) -> DetachResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    try:
        orgs_service.detach_group(db, org_id=org_id, gid=gid, actor_uid=user.uid)
    except ValueError as exc:
        msg = str(exc)
        if msg == "group_not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="group_not_found",
                message="Group not found",
            ) from exc
        if msg == "group_not_attached":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="group_not_attached",
                message="Group is not attached to this org",
            ) from exc
        raise

    write_audit_log(
        actor_uid=user.uid,
        action="org_detach_group",
        target_ref=f"orgs/{org_id}/groups/{gid}",
        payload={},
    )
    return DetachResponse(orgId=org_id, gid=gid, detached=True)


# ── admins subcollection ─────────────────────────────────────────────────────


@router.get("/{org_id}/admins", response_model=OrgAdminListResponse)
@limiter.limit(ORG_READ)
def list_admins(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> OrgAdminListResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    rows = orgs_service.list_admins(db, org_id)
    return OrgAdminListResponse(
        admins=[
            OrgAdmin(
                uid=row["uid"],
                addedBy=row.get("addedBy"),
                addedAt=_ts_to_str(row.get("addedAt")),
            )
            for row in rows
        ]
    )


@router.post("/{org_id}/admins", response_model=OrgAdminAddResponse)
@limiter.limit(ORG_ADMIN_MUTATION)
def add_admin(
    org_id: str,
    request: Request,
    response: Response,
    body: OrgAdminAddRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> OrgAdminAddResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    added = orgs_service.add_admin(
        db,
        org_id=org_id,
        uid=body.uid,
        actor_uid=user.uid,
    )
    if added:
        write_audit_log(
            actor_uid=user.uid,
            action="org_admin_add",
            target_ref=f"orgs/{org_id}/admins/{body.uid}",
            payload={},
        )
    return OrgAdminAddResponse(orgId=org_id, uid=body.uid, added=added)


@router.delete(
    "/{org_id}/admins/{uid}",
    response_model=OrgAdminRemoveResponse,
)
@limiter.limit(ORG_ADMIN_MUTATION)
def remove_admin(
    org_id: str,
    uid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_not_banned),
) -> OrgAdminRemoveResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    removed, reason = orgs_service.remove_admin(db, org_id=org_id, uid=uid)
    if not removed:
        if reason == "last_admin":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="last_admin",
                message="Cannot remove the last org admin",
            )
        if reason == "not_admin":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="not_admin",
                message="That user is not an admin of this org",
            )
    if removed:
        write_audit_log(
            actor_uid=user.uid,
            action="org_admin_remove",
            target_ref=f"orgs/{org_id}/admins/{uid}",
            payload={},
        )
    return OrgAdminRemoveResponse(orgId=org_id, uid=uid, removed=removed)


# ── T55 custom domains ──────────────────────────────────────────────────────


def _custom_domain_status(org_data: dict[str, Any]) -> CustomDomainStatus | None:
    raw = org_data.get("customDomain")
    if not raw or not isinstance(raw, dict):
        return None
    hostname = raw.get("hostname")
    if not hostname:
        return None
    return CustomDomainStatus(
        hostname=hostname,
        status=raw.get("status", "pending"),
        certStatus=raw.get("certStatus", "not_started"),
        verifiedAt=_ts_to_str(raw.get("verifiedAt")),
        txtRecord=raw.get("txtRecord"),
    )


def _domain_status_response(
    org_id: str,
    org_data: dict[str, Any],
    *,
    message: str | None = None,
) -> CustomDomainStatusResponse:
    custom_sub = org_data.get("customSubdomain")
    return CustomDomainStatusResponse(
        orgId=org_id,
        customDomain=_custom_domain_status(org_data),
        customSubdomain=custom_sub,
        customSubdomainHostname=(
            f"{custom_sub}.{domains_service.base_domain()}" if custom_sub else None
        ),
        message=message,
    )


@router.post("/{org_id}/subdomain", response_model=SubdomainClaimResponse)
@limiter.limit(ORG_ADMIN_MUTATION)
def claim_subdomain(
    org_id: str,
    request: Request,
    response: Response,
    body: SubdomainClaimRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> SubdomainClaimResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    try:
        hostname = domains_service.claim_subdomain(
            db,
            org_id=org_id,
            subdomain=body.subdomain,
            actor_uid=user.uid,
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "invalid":
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_subdomain",
                message="Subdomain must be 3-40 chars, lowercase letters/digits/hyphens, "
                "starting and ending with letter/digit",
            ) from exc
        if msg == "reserved":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="reserved_subdomain",
                message=f"Subdomain {body.subdomain!r} is reserved",
            ) from exc
        if msg == "taken":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="domain_taken",
                message=f"Subdomain {body.subdomain!r} is already claimed",
            ) from exc
        raise

    write_audit_log(
        actor_uid=user.uid,
        action="org_subdomain_claim",
        target_ref=f"orgs/{org_id}",
        payload={"subdomain": body.subdomain, "hostname": hostname},
    )
    return SubdomainClaimResponse(
        orgId=org_id,
        subdomain=body.subdomain,
        hostname=hostname,
    )


@router.delete("/{org_id}/subdomain", response_model=DomainReleaseResponse)
@limiter.limit(ORG_ADMIN_MUTATION)
def release_subdomain(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_not_banned),
) -> DomainReleaseResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    released = domains_service.release_subdomain(
        db,
        org_id=org_id,
        actor_uid=user.uid,
    )
    if released:
        write_audit_log(
            actor_uid=user.uid,
            action="org_subdomain_release",
            target_ref=f"orgs/{org_id}",
            payload={},
        )
    return DomainReleaseResponse(orgId=org_id, released=released)


@router.post("/{org_id}/custom-domain", response_model=VanityClaimResponse)
@limiter.limit(ORG_ADMIN_MUTATION)
def claim_custom_domain(
    org_id: str,
    request: Request,
    response: Response,
    body: VanityClaimRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> VanityClaimResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    try:
        token = domains_service.begin_vanity_claim(
            db,
            org_id=org_id,
            hostname=body.hostname,
            actor_uid=user.uid,
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "invalid":
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_hostname",
                message="Hostname must look like 'groups.your-domain.org'",
            ) from exc
        if msg == "subdomain_required":
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="subdomain_required",
                message="Use the /subdomain endpoint for *.jacob.app names",
            ) from exc
        if msg == "taken":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="domain_taken",
                message=f"Hostname {body.hostname!r} is already claimed",
            ) from exc
        if msg == "already_active":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_active",
                message=f"Vanity domain {body.hostname!r} is already active for this org",
            ) from exc
        raise

    write_audit_log(
        actor_uid=user.uid,
        action="org_vanity_claim_begin",
        target_ref=f"orgs/{org_id}",
        payload={"hostname": body.hostname},
    )
    return VanityClaimResponse(
        orgId=org_id,
        hostname=body.hostname,
        txtRecord=token,
        instructions=(
            f"Add a DNS TXT record on {body.hostname} with the value above. "
            "DNS propagation can take 5–60 min; once visible, call the "
            "verify endpoint."
        ),
    )


@router.get(
    "/{org_id}/custom-domain/status",
    response_model=CustomDomainStatusResponse,
)
@limiter.limit(DOMAIN_VERIFY)
def verify_custom_domain(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_not_banned),
) -> CustomDomainStatusResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    try:
        status_str, message = domains_service.verify_vanity_claim(
            db,
            org_id=org_id,
            actor_uid=user.uid,
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "no_pending_claim":
            # No pending claim is not an error; just report the current state.
            org_snap = db.collection("orgs").document(org_id).get()
            return _domain_status_response(
                org_id,
                org_snap.to_dict() or {},
                message="No pending vanity domain claim",
            )
        if msg == "org_not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="org_not_found",
                message="Org not found",
            ) from exc
        raise

    if status_str == "verified":
        write_audit_log(
            actor_uid=user.uid,
            action="org_vanity_verified",
            target_ref=f"orgs/{org_id}",
            payload={},
        )

    org_snap = db.collection("orgs").document(org_id).get()
    return _domain_status_response(
        org_id,
        org_snap.to_dict() or {},
        message=message,
    )


@router.delete("/{org_id}/custom-domain", response_model=DomainReleaseResponse)
@limiter.limit(ORG_ADMIN_MUTATION)
def release_custom_domain(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(require_not_banned),
) -> DomainReleaseResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    released = domains_service.release_vanity_claim(
        db,
        org_id=org_id,
        actor_uid=user.uid,
    )
    if released:
        write_audit_log(
            actor_uid=user.uid,
            action="org_vanity_release",
            target_ref=f"orgs/{org_id}",
            payload={},
        )
    return DomainReleaseResponse(orgId=org_id, released=released)


# ── public host -> org lookup (used by frontend middleware) ─────────────────


@public_router.get("/api/by-host", response_model=OrgByHostResponse)
@limiter.limit(DOMAIN_BY_HOST)
def get_org_by_host(
    request: Request,
    response: Response,
    host: str,
) -> OrgByHostResponse:
    """Resolve a hostname (subdomain or vanity) to its org. No auth.

    Only returns the org-public metadata: id, name, audience, logo,
    primary color. Used by the Next.js middleware to scope the
    workspace before any user signs in.
    """
    db = _db()
    org = domains_service.lookup_org_by_host(db, host)
    if not org:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="No org claims that host",
        )
    return OrgByHostResponse(**org)


# ── ADMIN_MUTATION re-export so tests stay terse ──────────────────────────────
# (kept for symmetry with the moderation router)
_ = ADMIN_MUTATION
