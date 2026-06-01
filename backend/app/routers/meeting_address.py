"""Group meeting addresses + visitor discovery.

Owner ask: "Groups register an address that they meet at to welcome
visitors. See a map of local groups we can visit."

Privacy model (load-bearing): a small-group meeting address is often a
member's home, so it is **default-private**. Publishing to `public`
requires ministry-owner approval — a leader's `public` request stores the
address, holds the EFFECTIVE visibility at a safe value (`members_only`,
or the prior value if already public), and sets a pending flag. The owner
approves to flip effective visibility to `public`, or rejects to clear the
pending flag. `private`/`members_only` apply immediately with no approval.

The address fields ride on the `groups/{gid}` document (default-deny for
client access post-M6); all reads/writes flow through these endpoints:

* `PUT    /api/groups/{gid}/meeting-address`   — leader. Geocodes + stores.
* `GET    /api/groups/{gid}/meeting-address`   — visibility-gated read.
* `DELETE /api/groups/{gid}/meeting-address`   — leader. Clears it.
* `GET    /api/admin/meeting-address/pending`  — owner. Approval queue.
* `POST   /api/admin/meeting-address/{gid}/approve` — owner.
* `POST   /api/admin/meeting-address/{gid}/reject`  — owner.
* `GET    /api/groups/discover/nearby`         — public-approved + distance.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    PublicReadContext,
    get_current_user,
    require_leader,
    require_member_or_public,
    require_ministry_owner,
)
from app.errors import APIError
from app.limits import (
    GROUP_READ,
    GROUP_UPDATE,
    MEETING_ADDRESS_NEARBY,
    MEETING_ADDRESS_WRITE,
)
from app.middleware.rate_limit import limiter
from app.models.meeting_address import (
    ApprovalResponse,
    MeetingAddress,
    MeetingAddressInput,
    MeetingAddressResponse,
    MeetingAddressUpdateResponse,
    NearbyGroup,
    NearbyGroupsResponse,
    PendingPublicAddress,
    PendingPublicAddressesResponse,
    Visibility,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin
from app.services.geocoding import geocode

logger = logging.getLogger(__name__)

router = APIRouter(tags=["meeting-address"])
admin_router = APIRouter(prefix="/api/admin/meeting-address", tags=["meeting-address"])

_EARTH_RADIUS_KM = 6371.0088


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


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two lat/lng points, in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _address_from_doc(group: dict[str, Any]) -> MeetingAddress | None:
    raw = group.get("meetingAddress")
    if not isinstance(raw, dict):
        return None
    return MeetingAddress(
        street=str(raw.get("street") or ""),
        city=str(raw.get("city") or ""),
        state=str(raw.get("state") or ""),
        postalCode=str(raw.get("postalCode") or ""),
        country=str(raw.get("country") or ""),
        lat=raw.get("lat"),
        lng=raw.get("lng"),
        geocodedAt=_ts_to_str(raw.get("geocodedAt")),
    )


def _effective_visibility(group: dict[str, Any]) -> Visibility:
    """Resolve effective visibility, defaulting to private for legacy docs."""
    v = group.get("meetingAddressVisibility")
    if v == "members_only":
        return "members_only"
    if v == "public":
        return "public"
    return "private"


# ── PUT /api/groups/{gid}/meeting-address (leader) ───────────────────────────


@router.put("/api/groups/{gid}/meeting-address", response_model=MeetingAddressUpdateResponse)
@limiter.limit(MEETING_ADDRESS_WRITE)
def set_meeting_address(
    gid: str,
    request: Request,
    response: Response,
    body: MeetingAddressInput,
    membership: MembershipContext = Depends(require_leader),
) -> MeetingAddressUpdateResponse:
    """Leader sets/updates the meeting address.

    The server geocodes the address (best-effort — a geocode failure
    stores null coords, never 500s) and caches lat/lng. A `public`
    request enters the pending-owner-approval state: the EFFECTIVE
    visibility is held at the safe current value (or `members_only`) and
    `meetingAddressPendingPublic` is set true. `private`/`members_only`
    apply immediately.
    """
    db = _db()
    group = membership.group

    geo = geocode(
        street=body.street,
        city=body.city,
        state=body.state,
        postal_code=body.postalCode,
        country=body.country,
    )

    address_doc: dict[str, Any] = {
        "street": body.street.strip(),
        "city": body.city.strip(),
        "state": body.state.strip(),
        "postalCode": body.postalCode.strip(),
        "country": body.country.strip(),
        "lat": geo.lat if geo else None,
        "lng": geo.lng if geo else None,
        "geocodedAt": fb_firestore.SERVER_TIMESTAMP if geo else None,
    }

    requested = body.visibility
    prior_effective = _effective_visibility(group)

    if requested == "public":
        # Never default-publish. Hold effective visibility at the safe
        # current value (members_only at most) and queue for the owner.
        # If the address was *already* public, keep it public — re-saving
        # the street while public should not silently un-publish it.
        if prior_effective == "public":
            effective: Visibility = "public"
            pending = False
        else:
            effective = "members_only"
            pending = True
    else:
        effective = requested
        pending = False

    update: dict[str, Any] = {
        "meetingAddress": address_doc,
        "meetingAddressVisibility": effective,
        "meetingAddressPendingPublic": pending,
    }
    db.collection("groups").document(gid).update(update)

    write_audit_log(
        actor_uid=membership.uid,
        action="meeting_address_set",
        target_ref=f"groups/{gid}",
        payload={
            "requestedVisibility": requested,
            "effectiveVisibility": effective,
            "pendingPublic": pending,
            "geocoded": geo is not None,
        },
    )
    logger.info(
        "meeting_address_set gid=%s actor=%s requested=%s effective=%s pending=%s geocoded=%s",
        gid,
        membership.uid,
        requested,
        effective,
        pending,
        geo is not None,
    )

    # Echo back the stored address with an ISO geocodedAt (the write used a
    # sentinel, so re-read isn't worth a round-trip — synthesize "now").
    out_address = MeetingAddress(
        street=address_doc["street"],
        city=address_doc["city"],
        state=address_doc["state"],
        postalCode=address_doc["postalCode"],
        country=address_doc["country"],
        lat=address_doc["lat"],
        lng=address_doc["lng"],
        geocodedAt=datetime.now(UTC).isoformat() if geo else None,
    )
    return MeetingAddressUpdateResponse(
        gid=gid,
        address=out_address,
        visibility=effective,
        pendingPublic=pending,
    )


# ── GET /api/groups/{gid}/meeting-address (visibility-gated) ─────────────────


@router.get("/api/groups/{gid}/meeting-address", response_model=MeetingAddressResponse)
@limiter.limit(GROUP_READ)
def get_meeting_address(
    gid: str,
    request: Request,
    response: Response,
    access: MembershipContext | PublicReadContext = Depends(require_member_or_public),
) -> MeetingAddressResponse:
    """Return the address subject to visibility rules.

    * Leaders/owner: always see the address + pending status + canManage.
    * Members: see `members_only` and `public` addresses.
    * Non-members (public-group readers): see only `public` (+approved).

    `require_member_or_public` already 404s a missing group and 403s a
    non-member of a *private* group, so a non-member only reaches here for
    a public group. A `MembershipContext` means the caller is a member;
    `role == "leader"` means they manage it.
    """
    group = access.group
    address = _address_from_doc(group)
    effective = _effective_visibility(group)
    pending = bool(group.get("meetingAddressPendingPublic", False))

    is_member = isinstance(access, MembershipContext)
    is_leader = is_member and access.role == "leader"  # type: ignore[union-attr]

    if address is None:
        return MeetingAddressResponse(
            address=None,
            visibility=effective,
            pendingPublic=pending if is_leader else False,
            canManage=is_leader,
        )

    # Decide whether this caller may see the address at the effective
    # visibility. Leaders/owner always can.
    visible: bool
    if is_leader:
        visible = True
    elif effective == "public":
        visible = True
    elif effective == "members_only":
        visible = is_member
    else:  # private
        visible = False

    return MeetingAddressResponse(
        address=address if visible else None,
        visibility=effective,
        pendingPublic=pending if is_leader else False,
        canManage=is_leader,
    )


# ── DELETE /api/groups/{gid}/meeting-address (leader) ────────────────────────


@router.delete("/api/groups/{gid}/meeting-address", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(GROUP_UPDATE)
def delete_meeting_address(
    gid: str,
    request: Request,
    response: Response,
    membership: MembershipContext = Depends(require_leader),
) -> Response:
    """Leader clears the meeting address and resets visibility to private."""
    db = _db()
    db.collection("groups").document(gid).update(
        {
            "meetingAddress": None,
            "meetingAddressVisibility": "private",
            "meetingAddressPendingPublic": False,
        }
    )
    write_audit_log(
        actor_uid=membership.uid,
        action="meeting_address_delete",
        target_ref=f"groups/{gid}",
        payload={},
    )
    logger.info("meeting_address_delete gid=%s actor=%s", gid, membership.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── GET /api/admin/meeting-address/pending (owner) ───────────────────────────


@admin_router.get("/pending", response_model=PendingPublicAddressesResponse)
@limiter.limit(GROUP_READ)
def list_pending_public(
    request: Request,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    owner: CurrentUser = Depends(require_ministry_owner),
) -> PendingPublicAddressesResponse:
    """Groups with a pending public meeting-address request, for the owner.

    Uses an equality query on `meetingAddressPendingPublic == true` so the
    owner queue is cheap; no compound index needed for a single-field
    equality filter.
    """
    db = _db()
    snaps = list(
        db.collection("groups")
        .where("meetingAddressPendingPublic", "==", True)
        .limit(limit)
        .stream()
    )

    out: list[PendingPublicAddress] = []
    for snap in snaps:
        g = snap.to_dict() or {}
        address = _address_from_doc(g)
        if address is None:
            continue
        out.append(
            PendingPublicAddress(
                gid=snap.id,
                groupName=str(g.get("name") or ""),
                address=address,
                currentVisibility=_effective_visibility(g),
            )
        )
    return PendingPublicAddressesResponse(requests=out, nextCursor=None)


# ── POST /api/admin/meeting-address/{gid}/approve (owner) ────────────────────


@admin_router.post("/{gid}/approve", response_model=ApprovalResponse)
@limiter.limit(GROUP_UPDATE)
def approve_public(
    gid: str,
    request: Request,
    response: Response,
    owner: CurrentUser = Depends(require_ministry_owner),
) -> ApprovalResponse:
    """Owner approves a pending public request → effective visibility = public."""
    db = _db()
    ref = db.collection("groups").document(gid)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    g = snap.to_dict() or {}
    if not bool(g.get("meetingAddressPendingPublic", False)):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="no_pending_request",
            message="No pending public meeting-address request for this group",
        )

    ref.update(
        {
            "meetingAddressVisibility": "public",
            "meetingAddressPendingPublic": False,
        }
    )
    write_audit_log(
        actor_uid=owner.uid,
        action="meeting_address_approve_public",
        target_ref=f"groups/{gid}",
        payload={},
    )
    logger.info("meeting_address_approve_public gid=%s actor=%s", gid, owner.uid)
    return ApprovalResponse(gid=gid, visibility="public", pendingPublic=False)


# ── POST /api/admin/meeting-address/{gid}/reject (owner) ─────────────────────


@admin_router.post("/{gid}/reject", response_model=ApprovalResponse)
@limiter.limit(GROUP_UPDATE)
def reject_public(
    gid: str,
    request: Request,
    response: Response,
    owner: CurrentUser = Depends(require_ministry_owner),
) -> ApprovalResponse:
    """Owner rejects a pending public request → pending cleared.

    Effective visibility reverts to the safe value it was held at while
    pending (`members_only`), which is what `set_meeting_address` already
    stored — so reject only clears the flag.
    """
    db = _db()
    ref = db.collection("groups").document(gid)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    g = snap.to_dict() or {}
    if not bool(g.get("meetingAddressPendingPublic", False)):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="no_pending_request",
            message="No pending public meeting-address request for this group",
        )

    effective = _effective_visibility(g)
    # Defensive: if somehow still flagged public while pending, drop to
    # members_only on reject so a reject never leaves it published.
    if effective == "public":
        effective = "members_only"

    ref.update(
        {
            "meetingAddressVisibility": effective,
            "meetingAddressPendingPublic": False,
        }
    )
    write_audit_log(
        actor_uid=owner.uid,
        action="meeting_address_reject_public",
        target_ref=f"groups/{gid}",
        payload={"revertedTo": effective},
    )
    logger.info(
        "meeting_address_reject_public gid=%s actor=%s reverted=%s", gid, owner.uid, effective
    )
    return ApprovalResponse(gid=gid, visibility=effective, pendingPublic=False)


# ── GET /api/groups/discover/nearby ──────────────────────────────────────────


@router.get("/api/groups/discover/nearby", response_model=NearbyGroupsResponse)
@limiter.limit(MEETING_ADDRESS_NEARBY)
def discover_nearby(
    request: Request,
    response: Response,
    lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    lng: float | None = Query(default=None, ge=-180.0, le=180.0),
    postalCode: str | None = Query(default=None, max_length=20),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
) -> NearbyGroupsResponse:
    """Public (approved) group meeting addresses, sorted by distance.

    Origin is either `lat`+`lng`, or a `postalCode`/`q` the server
    geocodes. Powers a "find a group near you" text-list-with-distance;
    the map is a later phase. Server-side Admin SDK query over groups
    where effective visibility == public.
    """
    # Resolve the origin.
    if lat is not None and lng is not None:
        origin_lat, origin_lng = lat, lng
    else:
        free = q or postalCode
        if not free:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="origin_required",
                message="Provide lat+lng, or a postalCode/q to geocode",
            )
        geo = geocode(free_text=free) if q else geocode(postal_code=postalCode)
        if geo is None:
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="origin_not_found",
                message="Could not geocode the supplied location",
            )
        origin_lat, origin_lng = geo.lat, geo.lng

    db = _db()
    # Server-side collection query over the `groups` collection (NOT a
    # collection-group query). Filtering on effective visibility == public
    # so only owner-approved addresses surface. The composite index
    # (meetingAddressVisibility ASC, archivedAt ASC) backs the combined
    # filter; see firestore/firestore.indexes.json.
    snaps = list(
        db.collection("groups")
        .where("meetingAddressVisibility", "==", "public")
        .where("archivedAt", "==", None)
        .stream()
    )

    candidates: list[NearbyGroup] = []
    for snap in snaps:
        g = snap.to_dict() or {}
        address = _address_from_doc(g)
        if address is None or address.lat is None or address.lng is None:
            continue
        dist = haversine_km(origin_lat, origin_lng, address.lat, address.lng)
        candidates.append(
            NearbyGroup(
                gid=snap.id,
                name=str(g.get("name") or ""),
                city=address.city,
                state=address.state,
                lat=address.lat,
                lng=address.lng,
                distanceKm=round(dist, 1),
            )
        )

    candidates.sort(key=lambda c: c.distanceKm)
    page = candidates[:limit]
    return NearbyGroupsResponse(
        origin={"lat": origin_lat, "lng": origin_lng},
        groups=page,
        nextCursor=None,
    )


__all__ = ["router", "admin_router", "haversine_km"]
