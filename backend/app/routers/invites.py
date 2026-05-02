"""Invite router: create, list, and revoke invite links for groups."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.limits import ADMIN_MUTATION, INVITE_CREATE
from app.middleware.rate_limit import limiter
from app.models.invite import CreateInviteRequest, InviteListResponse, InviteResponse
from app.models.user import CurrentUser
from app.routers.groups import _require_leader
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin
from app.services.invites import _to_datetime, create_invite

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/groups", tags=["invites"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _snap_to_response(snap: Any, app_url: str, gid: str) -> InviteResponse:
    d = snap.to_dict() or {}
    expires_dt = _to_datetime(d.get("expiresAt"))
    last_used_dt = _to_datetime(d.get("lastUsedAt"))
    revoked_dt = _to_datetime(d.get("revokedAt"))
    code = d.get("code", "")
    return InviteResponse(
        inviteId=snap.id,
        code=code,
        url=f"{app_url}/join?code={code}",
        expiresAt=expires_dt.isoformat() if expires_dt else None,
        maxUses=d.get("maxUses"),
        useCount=int(d.get("useCount") or 0),
        lastUsedAt=last_used_dt.isoformat() if last_used_dt else None,
        revokedAt=revoked_dt.isoformat() if revoked_dt else None,
    )


@router.post("/{gid}/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(INVITE_CREATE)
def create_group_invite(
    gid: str,
    request: Request,
    response: Response,
    body: CreateInviteRequest,
    user: CurrentUser = Depends(get_current_user),
) -> InviteResponse:
    """Create a new invite link for a group. Leader-only."""
    db = _db()
    _require_leader(db, gid, user.uid)

    settings = get_settings()
    app_url = settings.app_url

    result = create_invite(
        db,
        gid=gid,
        uid=user.uid,
        expiry=body.expiry,
        max_uses=body.maxUses,
        app_url=app_url,
    )
    write_audit_log(
        actor_uid=user.uid,
        action="create_invite",
        target_ref=f"groups/{gid}/invites/{result['inviteId']}",
        payload={"expiry": body.expiry, "maxUses": body.maxUses},
    )
    logger.info("create_invite gid=%s uid=%s invite=%s", gid, user.uid, result["inviteId"])
    return InviteResponse(**result)


@router.get("/{gid}/invites", response_model=InviteListResponse)
def list_group_invites(
    gid: str,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> InviteListResponse:
    """List all invites for a group. Leader-only."""
    db = _db()
    _require_leader(db, gid, user.uid)

    settings = get_settings()
    app_url = settings.app_url

    snaps = (
        db.collection("groups")
        .document(gid)
        .collection("invites")
        .order_by("createdAt", direction=fb_firestore.Query.DESCENDING)
        .stream()
    )
    invites = [_snap_to_response(s, app_url, gid) for s in snaps]
    return InviteListResponse(invites=invites)


@router.delete("/{gid}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(ADMIN_MUTATION)
def revoke_invite(
    gid: str,
    invite_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Revoke an invite link. Soft-delete only — row stays for audit trail."""
    db = _db()
    _require_leader(db, gid, user.uid)

    invite_ref = db.collection("groups").document(gid).collection("invites").document(invite_id)
    snap = invite_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invite_not_found",
            message="Invite not found",
        )
    invite_ref.update(
        {
            "revokedAt": fb_firestore.SERVER_TIMESTAMP,
            "revokedBy": user.uid,
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="revoke_invite",
        target_ref=f"groups/{gid}/invites/{invite_id}",
        payload={},
    )
    logger.info("revoke_invite gid=%s invite=%s uid=%s", gid, invite_id, user.uid)
