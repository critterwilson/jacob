"""Invites router: create, list, and revoke per-group invite docs.

Each group maintains a subcollection `groups/{gid}/invites/{inviteId}`.
Clients read this collection for display; all writes go through this router
using the Admin SDK (bypassing Firestore Security Rules).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.limits import ADMIN_MUTATION, INVITE_CREATE
from app.middleware.rate_limit import limiter
from app.models.invite import (
    CreateInviteRequest,
    InviteListResponse,
    InviteResponse,
    RevokeInviteResponse,
)
from app.models.user import CurrentUser
from app.routers.groups import _require_leader
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin
from app.services.invites import (
    expiry_datetime,
    generate_invite_code,
    parse_max_uses,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups/{gid}/invites", tags=["invites"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_iso(ts: Any) -> str | None:
    if ts is None:
        return None
    if hasattr(ts, "seconds"):
        return datetime.fromtimestamp(ts.seconds, tz=UTC).isoformat()
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)


def _invite_to_response(doc_id: str, data: dict[str, Any], gid: str) -> InviteResponse:
    settings = get_settings()
    app_url = getattr(settings, "app_url", "http://localhost:3000")
    return InviteResponse(
        inviteId=doc_id,
        code=data["code"],
        url=f"{app_url}/join?code={data['code']}",
        expiresAt=_ts_iso(data.get("expiresAt")),
        maxUses=data.get("maxUses"),
        useCount=data.get("useCount", 0),
        lastUsedAt=_ts_iso(data.get("lastUsedAt")),
        revokedAt=_ts_iso(data.get("revokedAt")),
    )


# ── endpoints ─────────────────────────────────────────────────────────────────


@router.post("", status_code=status.HTTP_201_CREATED, response_model=InviteResponse)
@limiter.limit(INVITE_CREATE)
def create_invite(
    gid: str,
    request: Request,
    response: Response,
    body: CreateInviteRequest,
    user: CurrentUser = Depends(get_current_user),
) -> InviteResponse:
    db = _db()
    _require_leader(db, gid, user.uid)

    code = generate_invite_code(db, gid)
    invite_id = str(uuid.uuid4())
    exp_dt = expiry_datetime(body.expiry)
    max_uses = parse_max_uses(body.maxUses)

    invite_ref = (
        db.collection("groups").document(gid).collection("invites").document(invite_id)
    )
    doc_data: dict[str, Any] = {
        "code": code,
        "createdBy": user.uid,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "expiresAt": exp_dt,
        "maxUses": max_uses,
        "useCount": 0,
        "lastUsedAt": None,
        "lastUsedByUid": None,
        "revokedAt": None,
        "revokedBy": None,
    }
    invite_ref.set(doc_data)

    write_audit_log(
        actor_uid=user.uid,
        action="create_invite",
        target_ref=f"groups/{gid}/invites/{invite_id}",
        payload={"expiry": body.expiry, "maxUses": body.maxUses},
    )
    logger.info("create_invite gid=%s uid=%s invite=%s", gid, user.uid, invite_id)

    doc_data["expiresAt"] = exp_dt
    return _invite_to_response(invite_id, doc_data, gid)


@router.get("", response_model=InviteListResponse)
def list_invites(
    gid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> InviteListResponse:
    db = _db()
    _require_leader(db, gid, user.uid)

    snaps = (
        db.collection("groups")
        .document(gid)
        .collection("invites")
        .order_by("createdAt", direction="DESCENDING")
        .stream()
    )

    invites = [_invite_to_response(s.id, s.to_dict() or {}, gid) for s in snaps]
    return InviteListResponse(invites=invites)


@router.delete("/{invite_id}", response_model=RevokeInviteResponse)
@limiter.limit(ADMIN_MUTATION)
def revoke_invite(
    gid: str,
    invite_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> RevokeInviteResponse:
    db = _db()
    _require_leader(db, gid, user.uid)

    invite_ref = (
        db.collection("groups").document(gid).collection("invites").document(invite_id)
    )
    invite_snap = invite_ref.get()
    if not invite_snap.exists:
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

    now_iso = datetime.now(UTC).isoformat()
    write_audit_log(
        actor_uid=user.uid,
        action="revoke_invite",
        target_ref=f"groups/{gid}/invites/{invite_id}",
        payload={},
    )
    logger.info("revoke_invite gid=%s uid=%s invite=%s", gid, user.uid, invite_id)
    return RevokeInviteResponse(inviteId=invite_id, revokedAt=now_iso)
