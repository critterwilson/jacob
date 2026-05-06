"""Org service layer (T54).

Encapsulates org CRUD, the slug-uniqueness reservation, attach/detach
with leader-consent flow, admin-add/remove with last-admin guard, and
the dashboard aggregator.

All Firestore writes go through the Admin SDK. Per M6, the
`firestore.rules` for the new `orgs/*` paths default-deny client
access — clients reach these collections through `/api/orgs/*` only.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.models.orgs import RESERVED_SLUGS, OrgAudience

logger = logging.getLogger(__name__)


CONSENT_TOKEN_TTL_MINUTES = 60


def slug_reserved(slug: str) -> bool:
    return slug in RESERVED_SLUGS


def reserve_slug(db: Any, slug: str, org_id: str) -> bool:
    """Atomically claim a slug for the given org id.

    Returns False if the slug is already taken (or is reserved). Slugs
    are stored in a top-level collection `org_slugs/{slug}` with the
    org id as the value, so a Firestore single-doc write becomes the
    uniqueness primitive. Cheaper and easier to reason about than a
    transaction across `orgs`.
    """
    if slug_reserved(slug):
        return False
    ref = db.collection("org_slugs").document(slug)
    snap = ref.get()
    if snap.exists:
        return False
    ref.create({"orgId": org_id, "createdAt": fb_firestore.SERVER_TIMESTAMP})
    return True


def release_slug(db: Any, slug: str) -> None:
    """Release a slug, used during failed-create rollback or org delete."""
    db.collection("org_slugs").document(slug).delete()


def create_org(
    db: Any,
    *,
    actor_uid: str,
    name: str,
    slug: str,
    description: str,
    audience: OrgAudience,
    initial_admin_uid: str,
) -> str:
    """Create the org doc + initial admin in one batch. Returns orgId.

    Raises `ValueError("slug_taken")` if the slug is already claimed
    or reserved. The caller wraps that into a 409 / 422.
    """
    org_id = str(uuid.uuid4())
    if not reserve_slug(db, slug, org_id):
        raise ValueError("slug_taken")

    org_ref = db.collection("orgs").document(org_id)
    admin_ref = org_ref.collection("admins").document(initial_admin_uid)

    batch = db.batch()
    batch.set(
        org_ref,
        {
            "name": name.strip(),
            "slug": slug,
            "description": description.strip(),
            "audience": audience,
            "logoUrl": None,
            "primaryColor": None,
            "customDomain": None,
            "customSubdomain": None,
            "createdBy": actor_uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "schemaVersion": 1,
            "billing": {
                "tier": "free",
                "customerId": None,
                "status": "active",
            },
            "llmModerationPolicy": "off",
            "threadSummaryEnabled": False,
            "semanticSearchEnabled": False,
            "prayerClusteringEnabled": False,
            "transparencyReportEnabled": False,
        },
    )
    batch.set(
        admin_ref,
        {
            "addedBy": actor_uid,
            "addedAt": fb_firestore.SERVER_TIMESTAMP,
        },
    )
    batch.commit()
    logger.info(
        "org_create org=%s slug=%s by=%s admin=%s",
        org_id,
        slug,
        actor_uid,
        initial_admin_uid,
    )
    return org_id


def is_org_admin(db: Any, org_id: str, uid: str) -> bool:
    snap = db.collection("orgs").document(org_id).collection("admins").document(uid).get()
    return bool(snap.exists)


def org_exists(db: Any, org_id: str) -> bool:
    return bool(db.collection("orgs").document(org_id).get().exists)


def list_orgs(db: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for snap in db.collection("orgs").stream():
        data = snap.to_dict() or {}
        data["orgId"] = snap.id
        out.append(data)
    return out


def list_admins(db: Any, org_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for snap in db.collection("orgs").document(org_id).collection("admins").stream():
        data = snap.to_dict() or {}
        data["uid"] = snap.id
        rows.append(data)
    return rows


def admin_count(db: Any, org_id: str) -> int:
    return sum(1 for _ in db.collection("orgs").document(org_id).collection("admins").stream())


def add_admin(
    db: Any,
    *,
    org_id: str,
    uid: str,
    actor_uid: str,
) -> bool:
    """Add a uid to the org's admin set. Returns False if already present."""
    ref = db.collection("orgs").document(org_id).collection("admins").document(uid)
    if ref.get().exists:
        return False
    ref.set(
        {
            "addedBy": actor_uid,
            "addedAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    return True


def remove_admin(
    db: Any,
    *,
    org_id: str,
    uid: str,
) -> tuple[bool, str | None]:
    """Remove a uid from the org's admin set.

    Returns (removed, reason). Refuses to remove the last admin (the
    last-admin invariant mirrors T22's leader-count rule but lives in
    the service layer because the rule can't enumerate a subcollection).
    """
    admins = list(db.collection("orgs").document(org_id).collection("admins").stream())
    by_uid = {snap.id for snap in admins}
    if uid not in by_uid:
        return False, "not_admin"
    if len(by_uid) <= 1:
        return False, "last_admin"
    db.collection("orgs").document(org_id).collection("admins").document(uid).delete()
    return True, None


def list_org_groups(db: Any, org_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    query = db.collection("groups").where("orgId", "==", org_id)
    for snap in query.stream():
        data = snap.to_dict() or {}
        data["gid"] = snap.id
        out.append(data)
    return out


# ── consent flow ─────────────────────────────────────────────────────────────


def issue_consent_token(
    db: Any,
    *,
    org_id: str,
    gid: str,
    issued_to: str,
    issued_by: str,
    ttl_minutes: int = CONSENT_TOKEN_TTL_MINUTES,
) -> str:
    token = secrets.token_urlsafe(32)
    db.collection("org_consent_tokens").document(token).set(
        {
            "orgId": org_id,
            "gid": gid,
            "issuedTo": issued_to,
            "issuedBy": issued_by,
            "expiresAt": datetime.now(UTC) + timedelta(minutes=ttl_minutes),
            "consumedAt": None,
        }
    )
    return token


def consume_consent_token(
    db: Any,
    *,
    token: str,
    org_id: str,
    gid: str,
) -> tuple[bool, str | None]:
    """Verify a token and mark it consumed in one transaction.

    Returns (ok, reason). Reasons: not_found, expired, mismatch, used.
    """
    ref = db.collection("org_consent_tokens").document(token)

    @gcf.transactional
    def _txn(txn: Any) -> tuple[bool, str | None]:
        snap = txn.get(ref)
        if not snap.exists:
            return False, "not_found"
        data = snap.to_dict() or {}
        if data.get("consumedAt") is not None:
            return False, "used"
        if data.get("orgId") != org_id or data.get("gid") != gid:
            return False, "mismatch"
        expires = data.get("expiresAt")
        if expires is None or (isinstance(expires, datetime) and expires < datetime.now(UTC)):
            return False, "expired"
        txn.update(ref, {"consumedAt": fb_firestore.SERVER_TIMESTAMP})
        return True, None

    result: tuple[bool, str | None] = _txn(db.transaction())
    return result


def attach_group(
    db: Any,
    *,
    org_id: str,
    gid: str,
    actor_uid: str,
) -> None:
    """Set `groups/{gid}.orgId = org_id` and back-fill org members.

    Caller MUST have validated consent or established that the actor is
    the sole leader; this function performs no further authorization.
    """
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        raise ValueError("org_not_found")
    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if not group_snap.exists:
        raise ValueError("group_not_found")
    existing_org = (group_snap.to_dict() or {}).get("orgId")
    if existing_org and existing_org != org_id:
        raise ValueError("group_attached_elsewhere")

    org_audience = (org_snap.to_dict() or {}).get("audience", "christian")
    group_sticker_set = (group_snap.to_dict() or {}).get("stickerSet", "christian")
    # Audience-mismatch guard: a christian-org cannot absorb a bjj group
    # (the sticker set wouldn't make sense in either group).
    if org_audience != "general" and group_sticker_set != org_audience:
        raise ValueError("audience_mismatch")

    group_ref.update({"orgId": org_id})

    # Back-fill org members for everyone already in the group. Each
    # existing member becomes an org member tagged with this group id.
    for member_snap in group_ref.collection("members").stream():
        uid = member_snap.id
        _add_org_member(db, org_id=org_id, uid=uid, gid=gid)
    logger.info(
        "org_attach_group org=%s gid=%s actor=%s",
        org_id,
        gid,
        actor_uid,
    )


def detach_group(
    db: Any,
    *,
    org_id: str,
    gid: str,
    actor_uid: str,
) -> None:
    group_ref = db.collection("groups").document(gid)
    group_snap = group_ref.get()
    if not group_snap.exists:
        raise ValueError("group_not_found")
    if (group_snap.to_dict() or {}).get("orgId") != org_id:
        raise ValueError("group_not_attached")

    group_ref.update({"orgId": None})

    # Pull every member of this group from `orgs/{orgId}/members/{uid}`,
    # mirroring the per-member logic. If a uid drops to zero remaining
    # groups in the org, their org-member doc is deleted.
    for member_snap in group_ref.collection("members").stream():
        _remove_org_member(db, org_id=org_id, uid=member_snap.id, gid=gid)
    logger.info(
        "org_detach_group org=%s gid=%s actor=%s",
        org_id,
        gid,
        actor_uid,
    )


def _add_org_member(
    db: Any,
    *,
    org_id: str,
    uid: str,
    gid: str,
) -> None:
    """Idempotent add: merge `gid` into the user's org-member groupIds."""
    ref = db.collection("orgs").document(org_id).collection("members").document(uid)
    snap = ref.get()
    if not snap.exists:
        ref.set(
            {
                "joinedAt": fb_firestore.SERVER_TIMESTAMP,
                "groupIds": [gid],
            }
        )
        return
    existing = (snap.to_dict() or {}).get("groupIds") or []
    if gid in existing:
        return
    ref.update({"groupIds": fb_firestore.ArrayUnion([gid])})


def _remove_org_member(
    db: Any,
    *,
    org_id: str,
    uid: str,
    gid: str,
) -> None:
    ref = db.collection("orgs").document(org_id).collection("members").document(uid)
    snap = ref.get()
    if not snap.exists:
        return
    remaining = [g for g in ((snap.to_dict() or {}).get("groupIds") or []) if g != gid]
    if not remaining:
        ref.delete()
        return
    ref.update({"groupIds": remaining})


# ── dashboard ────────────────────────────────────────────────────────────────


def dashboard_for(db: Any, org_id: str) -> dict[str, Any]:
    """Aggregate dashboard payload. Reads only org-scoped collections."""
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        raise ValueError("org_not_found")
    org_data = org_snap.to_dict() or {}

    group_count = 0
    archived_count = 0
    member_count = 0
    for snap in db.collection("orgs").document(org_id).collection("members").stream():
        member_count += 1
        del snap

    # H5: walk the org's groups once, gather counts and the gid set in
    # the same pass. The previous code streamed `groups.where(orgId)`
    # twice (once for counts, once for the gid set).
    org_gids: set[str] = set()
    for snap in db.collection("groups").where("orgId", "==", org_id).stream():
        group_count += 1
        org_gids.add(snap.id)
        if (snap.to_dict() or {}).get("archivedAt"):
            archived_count += 1

    pending_mod = 0
    # H5: replace the previous full-scan-and-filter
    # (`stream() ... data["groupId"] in org_gids`) with chunked Firestore
    # `in` queries against (status, groupId). Cost is now O(orgs.groups)
    # instead of O(all-pending-moderation-rows) — the latter scaled with
    # platform load, not org size, which is the wrong sensitivity.
    if org_gids:
        gids = list(org_gids)
        # Firestore `in` operator caps at 30 values per query.
        for i in range(0, len(gids), 30):
            chunk = gids[i : i + 30]
            chunk_query = (
                db.collection("moderation_queue")
                .where("status", "==", "pending")
                .where("groupId", "in", chunk)
            )
            for _snap in chunk_query.stream():
                pending_mod += 1

    return {
        "orgId": org_id,
        "name": org_data.get("name", ""),
        "audience": org_data.get("audience", "christian"),
        "groupCount": group_count,
        "memberCount": member_count,
        "archivedGroupCount": archived_count,
        "pendingModerationCount": pending_mod,
    }
