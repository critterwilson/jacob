"""Groups router: creation, invite-code join, and code rotation.

The backend owns all group writes so the invite code is generated
server-side and collision-checked before being stored.
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import get_current_user
from app.errors import APIError
from app.limits import ADMIN_MUTATION, GROUP_CREATE, GROUP_JOIN, INVITE_ROTATE
from app.middleware.rate_limit import limiter
from app.models.group import (
    AnnounceResponse,
    ArchiveGroupRequest,
    ArchiveResponse,
    CreateGroupRequest,
    CreateGroupResponse,
    FounderTransferRequest,
    FounderTransferResponse,
    JoinGroupRequest,
    JoinGroupResponse,
    LeaderActionResponse,
    RotateInviteResponse,
    UnarchiveResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin
from app.services.notifications import bulk_write_notifications

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
@limiter.limit(GROUP_CREATE)
def create_group(
    request: Request,
    response: Response,
    body: CreateGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> CreateGroupResponse:
    db = _db()
    code = _unique_invite_code(db)
    gid = str(uuid.uuid4())

    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)

    batch = db.batch()
    batch.set(
        group_ref,
        {
            "name": body.name.strip(),
            "description": body.description.strip(),
            "isPrivate": body.isPrivate,
            "createdBy": user.uid,
            "founderUid": user.uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "inviteCode": code,
            "memberCount": 1,
            "stickerSet": "christian",
            "schemaVersion": 1,
        },
    )
    batch.set(
        member_ref,
        {
            "role": "leader",
            "joinedAt": fb_firestore.SERVER_TIMESTAMP,
            "uid": user.uid,
        },
    )
    # M11: memberships are derived from a collection-group query on the
    # `members` subcollection. We no longer mirror them onto `users.groupIds`.
    batch.commit()

    logger.info("created group gid=%s uid=%s", gid, user.uid)
    return CreateGroupResponse(groupId=gid, inviteCode=code)


@router.post("/join", response_model=JoinGroupResponse)
@limiter.limit(GROUP_JOIN)
def join_group(
    request: Request,
    response: Response,
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

    batch = db.batch()
    batch.set(
        member_ref,
        {
            "role": "member",
            "joinedAt": fb_firestore.SERVER_TIMESTAMP,
            "uid": user.uid,
        },
    )
    batch.update(group_ref, {"memberCount": gcf.Increment(1)})
    # M11: see create_group — memberships derive from members subcollection.
    batch.commit()

    logger.info("uid=%s joined gid=%s", user.uid, gid)
    return JoinGroupResponse(groupId=gid)


@router.post("/{gid}/invite/rotate", response_model=RotateInviteResponse)
@limiter.limit(INVITE_ROTATE)
def rotate_invite(
    request: Request,
    response: Response,
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


# ── T22: leader hierarchy ────────────────────────────────────────────────────


def _require_leader(db: Any, gid: str, uid: str) -> dict[str, Any]:
    """Return the group doc data; raise 404/403 if missing or not a leader."""
    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    member_snap = db.collection("groups").document(gid).collection("members").document(uid).get()
    if not member_snap.exists or (member_snap.to_dict() or {}).get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Only group leaders can perform this action",
        )
    return group_snap.to_dict() or {}


def _members_collection(db: Any, gid: str) -> Any:
    return db.collection("groups").document(gid).collection("members")


@router.post(
    "/{gid}/leaders/{target_uid}/promote",
    response_model=LeaderActionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def promote_member(
    gid: str,
    target_uid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> LeaderActionResponse:
    """Promote a member to leader. Caller must be a leader of this group."""
    db = _db()
    _require_leader(db, gid, user.uid)

    target_ref = _members_collection(db, gid).document(target_uid)
    target_snap = target_ref.get()
    if not target_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="member_not_found",
            message="Target user is not a member of this group",
        )
    current_role = (target_snap.to_dict() or {}).get("role", "member")
    if current_role == "leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_leader",
            message="Target user is already a leader",
        )
    target_ref.update({"role": "leader"})
    write_audit_log(
        actor_uid=user.uid,
        action="promote_member",
        target_ref=f"groups/{gid}/members/{target_uid}",
        payload={"newRole": "leader"},
    )
    logger.info("promote gid=%s actor=%s target=%s", gid, user.uid, target_uid)
    return LeaderActionResponse(gid=gid, uid=target_uid, role="leader")


@router.post(
    "/{gid}/leaders/{target_uid}/demote",
    response_model=LeaderActionResponse,
)
@limiter.limit(ADMIN_MUTATION)
def demote_member(
    gid: str,
    target_uid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> LeaderActionResponse:
    """Demote a leader to member. Founder cannot be demoted; self-demote
    requires more than one leader.
    """
    db = _db()
    group_data = _require_leader(db, gid, user.uid)

    if group_data.get("founderUid") == target_uid:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="founder_immutable",
            message="The founder cannot be demoted; transfer first",
        )

    target_ref = _members_collection(db, gid).document(target_uid)
    target_snap = target_ref.get()
    if not target_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="member_not_found",
            message="Target user is not a member of this group",
        )
    current_role = (target_snap.to_dict() or {}).get("role", "member")
    if current_role != "leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_a_leader",
            message="Target user is not a leader",
        )

    leader_count = group_data.get("leaderCount") or 0
    if user.uid == target_uid and leader_count <= 1:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="last_leader",
            message="You are the only leader; promote someone else first",
        )

    target_ref.update({"role": "member"})
    write_audit_log(
        actor_uid=user.uid,
        action="demote_member",
        target_ref=f"groups/{gid}/members/{target_uid}",
        payload={"newRole": "member"},
    )
    logger.info("demote gid=%s actor=%s target=%s", gid, user.uid, target_uid)
    return LeaderActionResponse(gid=gid, uid=target_uid, role="member")


@router.post(
    "/{gid}/founder/transfer",
    response_model=FounderTransferResponse,
)
@limiter.limit(ADMIN_MUTATION)
def transfer_founder(
    gid: str,
    request: Request,
    response: Response,
    body: FounderTransferRequest,
    user: CurrentUser = Depends(get_current_user),
) -> FounderTransferResponse:
    """Transfer founder status. Only the current founder may call this;
    the target must already be a leader.
    """
    db = _db()
    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )
    group_data = group_snap.to_dict() or {}
    if group_data.get("founderUid") != user.uid:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="not_founder",
            message="Only the current founder can transfer founder status",
        )
    if body.targetUid == user.uid:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_target",
            message="Target must differ from the current founder",
        )

    target_ref = _members_collection(db, gid).document(body.targetUid)
    target_snap = target_ref.get()
    if not target_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="member_not_found",
            message="Target user is not a member of this group",
        )
    if (target_snap.to_dict() or {}).get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="target_not_leader",
            message="Target must already be a leader; promote first",
        )

    group_ref.update({"founderUid": body.targetUid})
    write_audit_log(
        actor_uid=user.uid,
        action="transfer_founder",
        target_ref=f"groups/{gid}",
        payload={"newFounderUid": body.targetUid, "previousFounderUid": user.uid},
    )
    logger.info("transfer founder gid=%s from=%s to=%s", gid, user.uid, body.targetUid)
    return FounderTransferResponse(gid=gid, founderUid=body.targetUid)


# ── T23: archive / unarchive ──────────────────────────────────────────────────

_ARCHIVE_HIDE_DAYS = 60


@router.post("/{gid}/archive", response_model=ArchiveResponse)
@limiter.limit(ADMIN_MUTATION)
def archive_group(
    gid: str,
    request: Request,
    response: Response,
    body: ArchiveGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ArchiveResponse:
    """Archive a group. Only the group leader may archive."""
    db = _db()
    group_data = _require_leader(db, gid, user.uid)

    if group_data.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_archived",
            message="Group is already archived",
        )

    group_ref = db.collection("groups").document(gid)
    group_ref.update(
        {
            "archivedAt": fb_firestore.SERVER_TIMESTAMP,
            "archivedBy": user.uid,
            "archiveReason": body.reason,
        }
    )
    archived_at_str = datetime.now(UTC).isoformat()
    write_audit_log(
        actor_uid=user.uid,
        action="archive_group",
        target_ref=f"groups/{gid}",
        payload={"reason": body.reason},
    )
    logger.info("archive_group gid=%s uid=%s", gid, user.uid)
    return ArchiveResponse(gid=gid, archivedAt=archived_at_str)


@router.post("/{gid}/unarchive", response_model=UnarchiveResponse)
@limiter.limit(ADMIN_MUTATION)
def unarchive_group(
    gid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> UnarchiveResponse:
    """Unarchive a group. Only possible within 60 days of archival."""
    db = _db()
    group_data = _require_leader(db, gid, user.uid)

    archived_at = group_data.get("archivedAt")
    if archived_at is None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_archived",
            message="Group is not archived",
        )

    # Firestore Timestamps have a .timestamp_pb() or we can compare as datetime
    archived_dt: datetime
    if hasattr(archived_at, "ToDatetime"):
        archived_dt = archived_at.ToDatetime(tzinfo=UTC)
    elif hasattr(archived_at, "timestamp"):
        archived_dt = datetime.fromtimestamp(archived_at.timestamp(), tz=UTC)
    else:
        archived_dt = archived_at  # already datetime

    cutoff = datetime.now(UTC) - timedelta(days=_ARCHIVE_HIDE_DAYS)
    if archived_dt < cutoff:
        raise APIError(
            status_code=status.HTTP_410_GONE,
            code="archive_too_old",
            message="Archive window expired; contact an admin to restore",
        )

    group_ref = db.collection("groups").document(gid)
    group_ref.update(
        {
            "archivedAt": None,
            "archivedBy": None,
            "archiveReason": None,
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="unarchive_group",
        target_ref=f"groups/{gid}",
        payload={},
    )
    logger.info("unarchive_group gid=%s uid=%s", gid, user.uid)
    return UnarchiveResponse(gid=gid)


# ── T24: announce ────────────────────────────────────────────────────────────


@router.post("/{gid}/messages/{mid}/announce", response_model=AnnounceResponse)
@limiter.limit(ADMIN_MUTATION)
def announce_message(
    gid: str,
    mid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> AnnounceResponse:
    """Pin and announce a message to all group members.

    Pinning via the announce endpoint is allowed to drop the oldest pin when
    the group already has 5 — unlike the client-side rule which rejects a 6th.
    """
    db = _db()
    group_data = _require_leader(db, gid, user.uid)

    if group_data.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="archived",
            message="Cannot announce in an archived group",
        )

    group_ref = db.collection("groups").document(gid)
    msg_ref = group_ref.collection("messages").document(mid)
    msg_snap = msg_ref.get()
    if not msg_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="message_not_found",
            message="Message not found",
        )

    msg_data = msg_snap.to_dict() or {}
    if msg_data.get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="message_deleted",
            message="Cannot announce a deleted message",
        )
    if msg_data.get("announcedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_announced",
            message="This message has already been announced",
        )

    # Update pinnedMessageIds: most-recent-first; cap at 5 by dropping oldest.
    pinned_ids: list[str] = list(group_data.get("pinnedMessageIds") or [])
    if mid not in pinned_ids:
        pinned_ids = [mid] + pinned_ids
        if len(pinned_ids) > 5:
            pinned_ids = pinned_ids[:5]

    batch = db.batch()
    batch.update(msg_ref, {
        "announcedAt": fb_firestore.SERVER_TIMESTAMP,
        "announcedBy": user.uid,
    })
    batch.update(group_ref, {"pinnedMessageIds": pinned_ids})
    batch.commit()

    # Fan out notifications to all group members (skipping blocks).
    members_snap = group_ref.collection("members").stream()
    member_uids = [s.id for s in members_snap]

    body_preview = (msg_data.get("body") or "")[:200].replace("\n", " ")
    notified = bulk_write_notifications(
        db,
        recipient_uids=member_uids,
        kind="announcement",
        group_id=gid,
        message_ref=f"groups/{gid}/messages/{mid}",
        from_uid=user.uid,
        body=body_preview,
    )

    write_audit_log(
        actor_uid=user.uid,
        action="announce_message",
        target_ref=f"groups/{gid}/messages/{mid}",
        payload={"messageRef": f"groups/{gid}/messages/{mid}", "notifiedCount": notified},
    )
    logger.info("announce gid=%s mid=%s uid=%s notified=%d", gid, mid, user.uid, notified)
    return AnnounceResponse(
        gid=gid,
        mid=mid,
        announcedAt=datetime.now(UTC).isoformat(),
        notifiedCount=notified,
    )
