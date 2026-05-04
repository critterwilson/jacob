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
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import (
    MembershipContext,
    PublicReadContext,
    get_current_user,
    require_member,
    require_member_or_public,
)
from app.errors import APIError
from app.limits import (
    ADMIN_MUTATION,
    GROUP_CREATE,
    GROUP_JOIN,
    GROUP_MEMBERSHIP_READ,
    GROUP_READ,
    INVITE_ROTATE,
    MEMBERS_LIST,
    PINNED_MESSAGES_READ,
)
from app.middleware.rate_limit import limiter
from app.models.admin import ModerationPolicyRequest, ModerationPolicyResponse
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
from app.models.members import (
    GroupDetail,
    Member,
    MembersListResponse,
    MyMembership,
)
from app.models.messages import Message, ModerationFields, PinnedMessagesResponse
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import get_firestore, init_firebase_admin
from app.services.invites import consume_invite
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
    for _ in range(10):
        code = _new_code()
        hits = list(db.collection("groups").where("inviteCode", "==", code).limit(1).stream())
        if not hits:
            return code
    raise APIError(
        status_code=500,
        code="code_generation_failed",
        message="Could not generate a unique invite code; please try again",
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
    gid, invite_id = consume_invite(db, body.code, user.uid)
    write_audit_log(
        actor_uid=user.uid,
        action="join_group",
        target_ref=f"groups/{gid}/members/{user.uid}",
        payload={"inviteId": invite_id},
    )
    logger.info("uid=%s joined gid=%s via invite=%s", user.uid, gid, invite_id)
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

    @gcf.transactional
    def _promote_txn(txn: Any) -> str:
        t_snap = txn.get(target_ref)
        if not t_snap.exists:
            return "not_found"
        if (t_snap.to_dict() or {}).get("role") == "leader":
            return "already_leader"
        txn.update(target_ref, {"role": "leader"})
        return "ok"

    outcome = _promote_txn(db.transaction())
    if outcome == "not_found":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="member_not_found",
            message="Target user is not a member of this group",
        )
    if outcome == "already_leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_leader",
            message="Target user is already a leader",
        )
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

    group_ref = db.collection("groups").document(gid)
    target_ref = _members_collection(db, gid).document(target_uid)

    @gcf.transactional
    def _demote_txn(txn: Any) -> str:
        g_snap = txn.get(group_ref)
        t_snap = txn.get(target_ref)
        if not t_snap.exists:
            return "not_found"
        if (t_snap.to_dict() or {}).get("role") != "leader":
            return "not_a_leader"
        # Re-read leaderCount atomically to prevent concurrent demotes bricking the group.
        lc = (g_snap.to_dict() or {}).get("leaderCount") or 0
        if lc <= 1:
            return "last_leader"
        txn.update(target_ref, {"role": "member"})
        return "ok"

    outcome = _demote_txn(db.transaction())
    if outcome == "not_found":
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="member_not_found",
            message="Target user is not a member of this group",
        )
    if outcome == "not_a_leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_a_leader",
            message="Target user is not a leader",
        )
    if outcome == "last_leader":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="last_leader",
            message="Cannot demote the only remaining leader",
        )
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


@router.post("/{gid}/messages/{mid}/announce", response_model=AnnounceResponse)
@limiter.limit(ADMIN_MUTATION)
def announce_message(
    gid: str,
    mid: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> AnnounceResponse:
    """Pin a message and fan-out an announcement notification to all group members."""
    db = _db()
    group_data = _require_leader(db, gid, user.uid)

    if group_data.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="archived",
            message="Cannot announce in an archived group",
        )

    msg_ref = db.collection("groups").document(gid).collection("messages").document(mid)
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
            message="Message already announced",
        )

    # Pin the message: shift out oldest if already at 5.
    pinned: list[str] = list(group_data.get("pinnedMessageIds") or [])
    if mid not in pinned:
        if len(pinned) >= 5:
            pinned.pop(0)
        pinned.append(mid)

    group_ref = db.collection("groups").document(gid)
    transaction = db.transaction()

    @gcf.transactional
    def _txn(transaction: Any) -> None:
        transaction.update(
            msg_ref,
            {
                "announcedAt": fb_firestore.SERVER_TIMESTAMP,
                "announcedBy": user.uid,
            },
        )
        transaction.update(group_ref, {"pinnedMessageIds": pinned})

    _txn(transaction)

    # Fan-out notifications to all members.
    members_snaps = db.collection("groups").document(gid).collection("members").stream()
    member_uids = [s.id for s in members_snaps]
    body_text = (msg_data.get("body") or "")[:200]
    notified = bulk_write_notifications(
        db,
        recipient_uids=member_uids,
        kind="announcement",
        group_id=gid,
        message_ref=f"groups/{gid}/messages/{mid}",
        from_uid=user.uid,
        body=body_text,
        skip_blocked_by=True,
    )

    write_audit_log(
        actor_uid=user.uid,
        action="announce_message",
        target_ref=f"groups/{gid}/messages/{mid}",
        payload={"messageRef": f"groups/{gid}/messages/{mid}", "notifiedCount": notified},
    )
    logger.info("announce_message gid=%s mid=%s uid=%s notified=%d", gid, mid, user.uid, notified)
    return AnnounceResponse(
        gid=gid,
        mid=mid,
        announcedAt=datetime.now(UTC).isoformat(),
        notifiedCount=notified,
    )


# ── per-group moderation policy (T20) ─────────────────────────────────────────


@router.post("/{gid}/moderation-policy", response_model=ModerationPolicyResponse)
@limiter.limit(ADMIN_MUTATION)
def set_moderation_policy(
    gid: str,
    request: Request,
    response: Response,
    body: ModerationPolicyRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ModerationPolicyResponse:
    """Set per-group text-moderation sensitivity. Auth: group leader or platform admin."""
    db = _db()

    is_platform_admin = user.claims.get("admin") == True  # noqa: E712
    if not is_platform_admin:
        member_snap = (
            db.collection("groups").document(gid).collection("members").document(user.uid).get()
        )
        if not member_snap.exists or (member_snap.to_dict() or {}).get("role") != "leader":
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="forbidden",
                message="Only group leaders may set the moderation policy",
            )

    group_ref = db.collection("groups").document(gid)
    if not group_ref.get().exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )

    group_ref.update({"moderationPolicy": body.policy})
    write_audit_log(
        actor_uid=user.uid,
        action="set_moderation_policy",
        target_ref=f"groups/{gid}",
        payload={"policy": body.policy},
    )
    logger.info("policy uid=%s gid=%s policy=%s", user.uid, gid, body.policy)
    return ModerationPolicyResponse(gid=gid, policy=body.policy)


# ── M3 reads ─────────────────────────────────────────────────────────────


def _ts_to_dt(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    converter = getattr(value, "ToDatetime", None)
    if callable(converter):
        try:
            result = converter(tzinfo=UTC)
        except TypeError:
            result = converter()
        if isinstance(result, datetime):
            return result if result.tzinfo else result.replace(tzinfo=UTC)
    return None


def _group_to_detail(gid: str, data: dict[str, Any], *, include_invite_code: bool) -> GroupDetail:
    return GroupDetail(
        gid=gid,
        name=str(data.get("name") or ""),
        description=str(data.get("description") or ""),
        isPrivate=bool(data.get("isPrivate") or False),
        joinMode=data.get("joinMode"),
        audience=data.get("audience"),
        stickerSet=str(data.get("stickerSet") or "christian"),
        avatarUrl=data.get("avatarUrl"),
        archivedAt=_ts_to_dt(data.get("archivedAt")),
        archivedBy=data.get("archivedBy"),
        archiveReason=data.get("archiveReason"),
        pinnedMessageIds=list(data.get("pinnedMessageIds") or []),
        memberCount=int(data.get("memberCount") or 0),
        leaderCount=int(data.get("leaderCount") or 0),
        founderUid=data.get("founderUid"),
        createdBy=data.get("createdBy"),
        createdAt=_ts_to_dt(data.get("createdAt")),
        inviteCode=(data.get("inviteCode") if include_invite_code else None),
        moderationPolicy=data.get("moderationPolicy"),
    )


def _moderation_to_model(value: Any) -> ModerationFields | None:
    if not value or not isinstance(value, dict):
        return None
    state = value.get("state")
    return ModerationFields(
        state=state if state in {"scored", "flagged", "hidden", "skipped", "errored"} else None,
        reasons=list(value.get("reasons") or []),
        scores=dict(value["scores"]) if isinstance(value.get("scores"), dict) else None,
        scoredAt=_ts_to_dt(value.get("scoredAt")),
        policy=value.get("policy"),
    )


def _doc_to_message(doc_id: str, data: dict[str, Any]) -> Message:
    return Message(
        id=doc_id,
        authorUid=str(data.get("authorUid") or ""),
        body=str(data.get("body") or ""),
        stickerIds=list(data.get("stickerIds") or []),
        mediaRefs=list(data.get("mediaRefs") or []),
        mentions=list(data.get("mentions") or []),
        parentMessageId=data.get("parentMessageId"),
        threadReplyCount=int(data.get("threadReplyCount") or 0),
        createdAt=_ts_to_dt(data.get("createdAt")),
        editedAt=_ts_to_dt(data.get("editedAt")),
        deletedAt=_ts_to_dt(data.get("deletedAt")),
        announcedAt=_ts_to_dt(data.get("announcedAt")),
        announcedBy=data.get("announcedBy"),
        reactionCounts={str(k): int(v) for k, v in (data.get("reactionCounts") or {}).items()},
        moderation=_moderation_to_model(data.get("moderation")),
        repostOfThread=data.get("repostOfThread"),
    )


@router.get("/{gid}", response_model=GroupDetail)
@limiter.limit(GROUP_READ)
def get_group(
    request: Request,
    response: Response,
    gid: str,
    ctx: MembershipContext | PublicReadContext = Depends(require_member_or_public),
) -> GroupDetail:
    """Per-group read. Members see the full doc; public-group non-members
    see the same doc with `inviteCode` redacted to None.
    """
    include_invite_code = isinstance(ctx, MembershipContext)
    return _group_to_detail(gid, ctx.group, include_invite_code=include_invite_code)


@router.get("/{gid}/me", response_model=MyMembership)
@limiter.limit(GROUP_MEMBERSHIP_READ)
def get_my_membership(
    request: Request,
    response: Response,
    gid: str,
    membership: MembershipContext = Depends(require_member),
) -> MyMembership:
    db = get_firestore()
    snap = (
        db.collection("groups").document(gid).collection("members").document(membership.uid).get()
    )
    data = snap.to_dict() or {}
    return MyMembership(
        gid=gid,
        uid=membership.uid,
        role=membership.role,
        joinedAt=_ts_to_dt(data.get("joinedAt")),
    )


@router.get("/{gid}/members", response_model=MembersListResponse)
@limiter.limit(MEMBERS_LIST)
def list_members(
    request: Request,
    response: Response,
    gid: str,
    membership: MembershipContext = Depends(require_member),
) -> MembersListResponse:
    """Members of a group, joined with `users/{uid}` profile fields.

    M3 ships without pagination because group sizes are small in v1
    (<= ~50). The pluggable cursor field reserved by the contract
    remains None until we hit a group big enough to warrant paging.
    """
    db = get_firestore()
    members_col = db.collection("groups").document(gid).collection("members")
    member_snaps = list(members_col.stream())

    # Bulk-read user docs in one round-trip.
    user_refs = [db.collection("users").document(s.id) for s in member_snaps]
    user_docs = list(db.get_all(user_refs)) if user_refs else []
    profiles_by_uid: dict[str, dict[str, Any]] = {}
    for doc in user_docs:
        if getattr(doc, "exists", False):
            profiles_by_uid[doc.id] = doc.to_dict() or {}

    members: list[Member] = []
    for snap in member_snaps:
        data = snap.to_dict() or {}
        role_raw = str(data.get("role") or "member")
        role: Literal["member", "leader"] = "leader" if role_raw == "leader" else "member"
        profile = profiles_by_uid.get(snap.id, {})
        display = str(profile.get("displayName") or "") or snap.id
        members.append(
            Member(
                uid=snap.id,
                role=role,
                joinedAt=_ts_to_dt(data.get("joinedAt")),
                displayName=display,
                photoURL=profile.get("photoURL"),
            )
        )

    return MembersListResponse(members=members)


@router.get("/{gid}/pinned-messages", response_model=PinnedMessagesResponse)
@limiter.limit(PINNED_MESSAGES_READ)
def get_pinned_messages(
    request: Request,
    response: Response,
    gid: str,
    membership: MembershipContext = Depends(require_member),
) -> PinnedMessagesResponse:
    """Resolve the group's `pinnedMessageIds` to full Message docs.

    Replaces the prior pattern of `onSnapshot(group)` + per-id
    `getDoc(message)` round-trips on the frontend.
    """
    db = get_firestore()
    pinned_ids: list[str] = list(membership.group.get("pinnedMessageIds") or [])
    if not pinned_ids:
        return PinnedMessagesResponse(messages=[])

    msg_refs = [
        db.collection("groups").document(gid).collection("messages").document(mid)
        for mid in pinned_ids
    ]
    docs = list(db.get_all(msg_refs))
    by_id: dict[str, dict[str, Any]] = {
        d.id: d.to_dict() or {} for d in docs if getattr(d, "exists", False)
    }
    messages: list[Message] = []
    for mid in pinned_ids:
        data = by_id.get(mid)
        if data is None:
            continue
        msg = _doc_to_message(mid, data)
        if msg.deletedAt is not None:
            continue
        if msg.moderation and msg.moderation.state == "hidden":
            continue
        messages.append(msg)

    return PinnedMessagesResponse(messages=messages)
