"""Groups router: creation, invite-code join, and code rotation.

The backend owns all group writes so the invite code is generated
server-side and collision-checked before being stored.
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid
from typing import Any

from fastapi import APIRouter, Depends, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import get_current_user
from app.errors import APIError
from app.models.group import (
    CreateGroupRequest,
    CreateGroupResponse,
    JoinGroupRequest,
    JoinGroupResponse,
    RotateInviteResponse,
)
from app.models.user import CurrentUser
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups", tags=["groups"])

_BASE32 = string.ascii_uppercase + "234567"


# ── helpers ───────────────────────────────────────────────────────────────────


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _new_code() -> str:
    return "".join(secrets.choice(_BASE32) for _ in range(8))


def _unique_invite_code(db: Any) -> str:
    for _ in range(5):
        code = _new_code()
        hits = list(db.collection("groups").where("inviteCode", "==", code).limit(1).stream())
        if not hits:
            return code
    raise APIError(
        status_code=500,
        code="internal_error",
        message="Could not generate a unique invite code",
    )


# ── endpoints ─────────────────────────────────────────────────────────────────


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CreateGroupResponse)
def create_group(
    body: CreateGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> CreateGroupResponse:
    db = _db()
    code = _unique_invite_code(db)
    gid = str(uuid.uuid4())

    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)
    user_ref = db.collection("users").document(user.uid)

    batch = db.batch()
    batch.set(
        group_ref,
        {
            "name": body.name.strip(),
            "description": body.description.strip(),
            "isPrivate": body.isPrivate,
            "createdBy": user.uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "inviteCode": code,
            "memberCount": 1,
            "stickerSet": "christian",
            "schemaVersion": 1,
        },
    )
    batch.set(member_ref, {"role": "leader", "joinedAt": fb_firestore.SERVER_TIMESTAMP})
    batch.set(user_ref, {"groupIds": gcf.ArrayUnion([gid])}, merge=True)
    batch.commit()

    logger.info("created group gid=%s uid=%s", gid, user.uid)
    return CreateGroupResponse(groupId=gid, inviteCode=code)


@router.post("/join", response_model=JoinGroupResponse)
def join_group(
    body: JoinGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> JoinGroupResponse:
    db = _db()

    hits = list(db.collection("groups").where("inviteCode", "==", body.code).limit(1).stream())
    if not hits:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invalid_invite",
            message="Invite code not found",
        )

    gid: str = hits[0].id
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)

    if member_ref.get().exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_member",
            message="You are already a member of this group",
        )

    user_ref = db.collection("users").document(user.uid)
    batch = db.batch()
    batch.set(member_ref, {"role": "member", "joinedAt": fb_firestore.SERVER_TIMESTAMP})
    batch.update(group_ref, {"memberCount": gcf.Increment(1)})
    batch.set(user_ref, {"groupIds": gcf.ArrayUnion([gid])}, merge=True)
    batch.commit()

    logger.info("uid=%s joined gid=%s", user.uid, gid)
    return JoinGroupResponse(groupId=gid)


@router.post("/{gid}/invite/rotate", response_model=RotateInviteResponse)
def rotate_invite(
    gid: str,
    user: CurrentUser = Depends(get_current_user),
) -> RotateInviteResponse:
    db = _db()

    group_ref = db.collection("groups").document(gid)
    if not group_ref.get().exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )

    member_snap = group_ref.collection("members").document(user.uid).get()
    if not member_snap.exists or member_snap.get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Only group leaders can rotate the invite code",
        )

    new_code = _unique_invite_code(db)
    group_ref.update({"inviteCode": new_code})

    logger.info("rotated invite gid=%s uid=%s", gid, user.uid)
    return RotateInviteResponse(inviteCode=new_code)
