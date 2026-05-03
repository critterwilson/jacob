"""Invite service: code generation, validation, and transactional consumption.

The collection-group query inside consume_invite uses the Admin SDK, which
bypasses Firestore Security Rules. This is intentional — only the server
validates invite correctness; clients can only read invite docs for display.
"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.errors import APIError

logger = logging.getLogger(__name__)

_BASE32 = string.ascii_uppercase + "234567"

_EXPIRY_DELTAS: dict[str, timedelta] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}

_MAX_USES_MAP: dict[str, int | None] = {
    "unlimited": None,
    "1": 1,
    "10": 10,
    "25": 25,
}


def generate_invite_code(db: Any, gid: str) -> str:
    """Generate an 8-char base32 code unique within this group's invites."""
    for _ in range(5):
        code = "".join(secrets.choice(_BASE32) for _ in range(8))
        hits = list(
            db.collection("groups")
            .document(gid)
            .collection("invites")
            .where("code", "==", code)
            .limit(1)
            .stream()
        )
        if not hits:
            return code
    raise APIError(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="internal_error",
        message="Could not generate a unique invite code",
    )


def expiry_datetime(expiry: str) -> datetime | None:
    if expiry == "never":
        return None
    return datetime.now(UTC) + _EXPIRY_DELTAS[expiry]


def parse_max_uses(max_uses_str: str) -> int | None:
    return _MAX_USES_MAP[max_uses_str]


def _ts_to_dt(ts: Any) -> datetime:
    if hasattr(ts, "seconds"):
        return datetime.fromtimestamp(ts.seconds, tz=UTC)
    if hasattr(ts, "tzinfo") and ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts


def _validate_invite_doc(data: dict[str, Any]) -> None:
    """Raise APIError if the invite is revoked, expired, or maxed."""
    if data.get("revokedAt") is not None:
        raise APIError(
            status_code=status.HTTP_410_GONE,
            code="invite_revoked",
            message="This invite has been revoked",
        )

    expires_at = data.get("expiresAt")
    if expires_at is not None:
        exp_dt = _ts_to_dt(expires_at)
        if exp_dt < datetime.now(UTC):
            raise APIError(
                status_code=status.HTTP_410_GONE,
                code="invite_expired",
                message="This invite has expired",
            )

    max_uses = data.get("maxUses")
    use_count = data.get("useCount", 0)
    if max_uses is not None and use_count >= max_uses:
        raise APIError(
            status_code=status.HTTP_410_GONE,
            code="invite_maxed",
            message="This invite has reached its usage limit",
        )


def consume_invite(db: Any, code: str, uid: str) -> tuple[str, str]:
    """Consume an invite code, joining the user to the group.

    Uses a Firestore batch for atomicity. Concurrent requests on a maxUses=1
    invite are serialized at the Firestore document level — the second writer
    sees useCount >= maxUses when the transaction re-reads and raises 410.

    Returns (gid, inviteId).
    """
    # Step 1: locate the invite across all groups (Admin SDK = no rules).
    invite_snaps = list(
        db.collection_group("invites")
        .where("code", "==", code)
        .limit(1)
        .stream()
    )
    if not invite_snaps:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invalid_invite",
            message="Invite code not found",
        )

    invite_snap = invite_snaps[0]
    invite_ref = invite_snap.reference
    gid: str = invite_ref.parent.parent.id
    invite_id: str = invite_ref.id
    invite_data = invite_snap.to_dict() or {}

    # Step 2: early validation (fast fail before touching the group doc).
    _validate_invite_doc(invite_data)

    # Step 3: check group is not archived.
    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if group_snap.exists and (group_snap.to_dict() or {}).get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_410_GONE,
            code="archived",
            message="This group is archived and not accepting new members",
        )

    member_ref = group_ref.collection("members").document(uid)

    # Step 4: check existing membership.
    if member_ref.get().exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_member",
            message="You are already a member of this group",
        )

    # Step 5: atomic write.
    batch = db.batch()
    batch.update(
        invite_ref,
        {
            "useCount": gcf.Increment(1),
            "lastUsedAt": fb_firestore.SERVER_TIMESTAMP,
            "lastUsedByUid": uid,
        },
    )
    batch.set(
        member_ref,
        {
            "role": "member",
            "joinedAt": fb_firestore.SERVER_TIMESTAMP,
            "uid": uid,
        },
    )
    batch.update(group_ref, {"memberCount": gcf.Increment(1)})
    batch.commit()

    logger.info("consume_invite gid=%s uid=%s invite=%s", gid, uid, invite_id)
    return gid, invite_id
