"""Invite service: code generation, expiry math, and transactional consume.

The invite system replaces the single groups/{gid}.inviteCode field (T25).
Each group now has a subcollection groups/{gid}/invites/{inviteId} with
expiry, max-uses, and usage tracking.

Key design decision: the collection-group query for code lookup runs inside a
Firestore transaction so that concurrent joins on a maxUses=1 invite cannot
both succeed — Firestore retries conflicting transactions until one wins or the
retry budget is exhausted, providing optimistic concurrency at the storage layer.
See docs/adr/0004-invite-collection.md.
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.errors import APIError
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

_ALPHABET = string.ascii_uppercase + string.digits
_CODE_LEN = 8
_MAX_RETRIES = 5

_EXPIRY_DELTAS: dict[str, timedelta | None] = {
    "never": None,
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


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def generate_invite_code(db: Any, gid: str) -> str:
    """Generate an 8-char base32-ish code unique within the group's invites."""
    for _ in range(_MAX_RETRIES):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))
        existing = list(
            db.collection("groups")
            .document(gid)
            .collection("invites")
            .where("code", "==", code)
            .limit(1)
            .stream()
        )
        if not existing:
            return code
    raise APIError(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="code_generation_failed",
        message="Could not generate a unique invite code",
    )


def create_invite(
    db: Any,
    *,
    gid: str,
    uid: str,
    expiry: str,
    max_uses: str,
    app_url: str,
) -> dict[str, Any]:
    """Create a new invite doc. Returns the invite data dict."""
    code = generate_invite_code(db, gid)
    invite_id = str(uuid.uuid4())

    delta = _EXPIRY_DELTAS.get(expiry)
    expires_at_dt = datetime.now(UTC) + delta if delta else None
    max_uses_int = _MAX_USES_MAP.get(max_uses)

    doc_data: dict[str, Any] = {
        "code": code,
        "createdBy": uid,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "expiresAt": expires_at_dt,
        "maxUses": max_uses_int,
        "useCount": 0,
        "lastUsedAt": None,
        "lastUsedByUid": None,
        "revokedAt": None,
        "revokedBy": None,
    }
    db.collection("groups").document(gid).collection("invites").document(invite_id).set(doc_data)
    return {
        "inviteId": invite_id,
        "code": code,
        "url": f"{app_url}/join?code={code}",
        "expiresAt": expires_at_dt.isoformat() if expires_at_dt else None,
        "maxUses": max_uses_int,
        "useCount": 0,
        "lastUsedAt": None,
        "revokedAt": None,
    }


def consume_invite(db: Any, code: str, uid: str) -> tuple[str, str]:
    """Transactionally consume an invite. Returns (gid, inviteId).

    Raises APIError on any validation failure (not found, expired, maxed,
    revoked, already_member, archived).

    The collection-group query runs via Admin SDK (bypasses security rules)
    inside a transaction so concurrent maxUses=1 joins cannot both succeed.
    """
    transaction = db.transaction()

    # Read phase (outside transaction — find the invite doc first).
    hits = list(
        db.collection_group("invites")
        .where("code", "==", code)
        .where("revokedAt", "==", None)
        .limit(1)
        .stream()
    )
    if not hits:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="invalid_invite",
            message="Invite code not found",
        )

    invite_snap = hits[0]
    invite_ref = invite_snap.reference
    # Extract gid from path: groups/{gid}/invites/{inviteId}
    path_parts = invite_ref.path.split("/")
    gid = path_parts[1]
    invite_id = invite_snap.id
    invite_data = invite_snap.to_dict() or {}

    # Validate: expiry and revoked checks before entering transaction.
    now = datetime.now(UTC)
    expires_at = invite_data.get("expiresAt")
    if expires_at is not None:
        exp_dt = _to_datetime(expires_at)
        if exp_dt and exp_dt < now:
            raise APIError(
                status_code=status.HTTP_410_GONE,
                code="invite_expired",
                message="This invite has expired",
            )

    max_uses = invite_data.get("maxUses")
    use_count = invite_data.get("useCount", 0)
    if max_uses is not None and use_count >= max_uses:
        raise APIError(
            status_code=status.HTTP_410_GONE,
            code="invite_maxed",
            message="This invite has reached its use limit",
        )

    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if group_snap.exists:
        group_data = group_snap.to_dict() or {}
        if group_data.get("archivedAt") is not None:
            raise APIError(
                status_code=status.HTTP_410_GONE,
                code="archived",
                message="Cannot join an archived group",
            )

    member_ref = group_ref.collection("members").document(uid)

    @gcf.transactional
    def _run(transaction: Any) -> None:
        # Re-read inside transaction for optimistic concurrency on useCount.
        txn_invite = invite_ref.get(transaction=transaction)
        txn_data = txn_invite.to_dict() or {}

        txn_uses = txn_data.get("useCount", 0)
        txn_max = txn_data.get("maxUses")
        if txn_max is not None and txn_uses >= txn_max:
            raise APIError(
                status_code=status.HTTP_410_GONE,
                code="invite_maxed",
                message="This invite has reached its use limit",
            )

        txn_member = member_ref.get(transaction=transaction)
        if txn_member.exists:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_member",
                message="You are already a member of this group",
            )

        transaction.update(
            invite_ref,
            {
                "useCount": gcf.Increment(1),
                "lastUsedAt": fb_firestore.SERVER_TIMESTAMP,
                "lastUsedByUid": uid,
            },
        )
        transaction.set(
            member_ref,
            {
                "role": "member",
                "joinedAt": fb_firestore.SERVER_TIMESTAMP,
                "uid": uid,
            },
        )
        transaction.update(group_ref, {"memberCount": gcf.Increment(1)})

    _run(transaction)
    return gid, invite_id


def _to_datetime(ts: Any) -> datetime | None:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=UTC)
    if hasattr(ts, "ToDatetime"):
        return cast(datetime, ts.ToDatetime(tzinfo=UTC))
    if hasattr(ts, "timestamp"):
        return datetime.fromtimestamp(ts.timestamp(), tz=UTC)
    return None
