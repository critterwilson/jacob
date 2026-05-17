"""Account deletion orchestration (T14).

The deletion flow has three phases:

1. **Request** — `request_deletion` stamps `deletionRequestedAt` on the
   user doc and revokes refresh tokens so the client is signed out on
   its next request. The doc remains intact during the 14-day grace
   window so the user can sign back in and cancel.
2. **Cancel** — `cancel_deletion` clears `deletionRequestedAt` if we are
   still within the window. Past the window the user is gone and there
   is nothing to cancel.
3. **Finalize** — `finalize_account` is invoked by the daily Cloud
   Scheduler job (`infra/scheduled/finalize_deletions.py`). It disables
   the Firebase Auth account, tombstones authored messages across all
   groups, deletes the avatar object from GCS, removes the private
   subcollection, and finally deletes the user doc. An audit_log entry
   with `actorUid="system"` records the finalization.

The collection-group query over `messages` is the only place we use
collection-group reads — a CG index for `authorUid` is registered in
`firestore/firestore.indexes.json`. Server-side Admin SDK operations
bypass security rules; client-side CG reads remain forbidden.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import auth as firebase_auth
from firebase_admin import db as firebase_db
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.services.audit import write_audit_log
from app.services.email import send_deletion_confirmation, send_deletion_finalized
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

GRACE_PERIOD_DAYS = 14
TOMBSTONE_UID = "[deleted]"


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_dt(ts: Any) -> datetime | None:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts
    converter = getattr(ts, "ToDatetime", None)
    if converter is None:
        return None
    result = converter(tzinfo=UTC)  # google.protobuf.Timestamp
    return result if isinstance(result, datetime) else None


def _finalize_at(requested_at: datetime) -> datetime:
    return requested_at + timedelta(days=GRACE_PERIOD_DAYS)


def request_deletion(uid: str, *, keep_body: bool) -> dict[str, str]:
    """Stamp the user doc, revoke tokens, audit. Returns the requested/finalize timestamps."""
    db = _db()
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if not snap.exists:
        # Defensive: an authenticated user always has a user doc by T05,
        # but never assume — surface a clear error rather than silently
        # writing into a non-existent doc.
        raise LookupError("user_not_found")

    now = datetime.now(UTC)
    finalize_at = _finalize_at(now)
    user_ref.update(
        {
            "deletionRequestedAt": fb_firestore.SERVER_TIMESTAMP,
            "deletionKeepBody": keep_body,
        }
    )
    # Revoke refresh tokens so the client can no longer mint a fresh ID
    # token; the next request will return 401 and the SPA signs out.
    firebase_auth.revoke_refresh_tokens(uid)

    write_audit_log(
        actor_uid=uid,
        action="account_delete_requested",
        target_ref=f"users/{uid}",
        payload={"keepBody": keep_body},
    )

    logger.info("deletion requested uid=%s keep_body=%s", uid, keep_body)

    user_data = snap.to_dict() or {}
    try:
        send_deletion_confirmation(
            to_email=user_data.get("email", ""),
            display_name=user_data.get("displayName", ""),
            grace_days=GRACE_PERIOD_DAYS,
            finalize_date=finalize_at.strftime("%B %-d, %Y"),
        )
    except Exception:
        logger.exception("deletion_confirmation email failed uid=%s", uid)

    return {
        "deletionRequestedAt": now.isoformat(),
        "finalizeAt": finalize_at.isoformat(),
    }


def cancel_deletion(uid: str) -> bool:
    """Clear deletionRequestedAt if within the grace window. Returns True on cancel."""
    db = _db()
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if not snap.exists:
        return False

    data = snap.to_dict() or {}
    requested_at = _ts_to_dt(data.get("deletionRequestedAt"))
    if requested_at is None:
        return False

    now = datetime.now(UTC)
    # Cancel window is half-open: [requested_at, finalize_at).
    # find_users_due uses <= cutoff so the boundary belongs to finalize.
    if now >= _finalize_at(requested_at):
        # At or past the grace window — finalization may already have run or
        # be about to run. Don't pretend we cancelled it.
        return False

    user_ref.update(
        {
            "deletionRequestedAt": fb_firestore.DELETE_FIELD,
            "deletionKeepBody": fb_firestore.DELETE_FIELD,
        }
    )

    write_audit_log(
        actor_uid=uid,
        action="account_delete_cancelled",
        target_ref=f"users/{uid}",
        payload={},
    )

    logger.info("deletion cancelled uid=%s", uid)
    return True


def get_deletion_status(uid: str) -> dict[str, Any]:
    db = _db()
    snap = db.collection("users").document(uid).get()
    if not snap.exists:
        return {"status": "none"}

    data = snap.to_dict() or {}
    requested_at = _ts_to_dt(data.get("deletionRequestedAt"))
    if requested_at is None:
        return {"status": "none"}

    finalize_at = _finalize_at(requested_at)
    return {
        "status": "pending",
        "deletionRequestedAt": requested_at.isoformat(),
        "finalizeAt": finalize_at.isoformat(),
        "keepBody": bool(data.get("deletionKeepBody", True)),
    }


# ── finalization ─────────────────────────────────────────────────────────────


def _delete_avatar(photo_url: str | None) -> None:
    if not photo_url:
        return
    # The avatar lives in the public bucket as `https://storage.googleapis.com/{bucket}/{path}`.
    # Tolerate any non-GCS URL (e.g. a Google profile picture from Sign-in-with-Google).
    prefix = "https://storage.googleapis.com/"
    if not photo_url.startswith(prefix):
        return
    rest = photo_url[len(prefix) :]
    if "/" not in rest:
        return
    bucket_name, object_name = rest.split("/", 1)

    import importlib

    storage = importlib.import_module("google.cloud.storage")
    try:
        client = storage.Client()
        client.bucket(bucket_name).blob(object_name).delete()
    except Exception as exc:  # noqa: BLE001 — best-effort cleanup
        logger.warning(
            "avatar delete failed bucket=%s object=%s err=%s", bucket_name, object_name, exc
        )


def _tombstone_messages(db: Any, uid: str, *, keep_body: bool) -> int:
    """Replace authorUid with TOMBSTONE_UID across all groups. Returns count.

    When `keep_body=False`, also clears `body` and best-effort deletes any
    GCS objects referenced from `mediaRefs` (the messages were the only
    place that pointed at them; orphaning would just waste storage budget).
    """
    query = db.collection_group("messages").where("authorUid", "==", uid)
    count = 0
    for snap in query.stream():
        data = snap.to_dict() or {}
        update: dict[str, Any] = {"authorUid": TOMBSTONE_UID}
        if not keep_body:
            update["body"] = ""
            update["mediaRefs"] = []
            for media_url in data.get("mediaRefs") or []:
                if isinstance(media_url, str):
                    _delete_gcs_object_by_url(media_url)
        snap.reference.update(update)
        count += 1
    return count


def _delete_gcs_object_by_url(url: str) -> None:
    """Best-effort delete of a public-bucket object referenced by URL."""
    prefix = "https://storage.googleapis.com/"
    if not url.startswith(prefix):
        return
    rest = url[len(prefix) :]
    if "/" not in rest:
        return
    bucket_name, object_name = rest.split("/", 1)
    import importlib

    storage = importlib.import_module("google.cloud.storage")
    try:
        client = storage.Client()
        client.bucket(bucket_name).blob(object_name).delete()
    except Exception as exc:  # noqa: BLE001 — best-effort cleanup
        logger.warning(
            "media delete failed bucket=%s object=%s err=%s", bucket_name, object_name, exc
        )


# ── C1: full subcollection + cross-surface cleanup ──────────────────────────

# Subcollections directly under `users/{uid}`. `private` is handled
# separately because its semantics (PII payload) and audit posture differ.
_USER_SUBCOLLECTIONS = (
    "notifications",
    "devices",
    "mutes",
    "blocks",
    "exports",
    "plan_progress",
    "notificationPrefs",
)


def _delete_user_subcollections(db: Any, uid: str) -> dict[str, int]:
    """Delete every doc under each `users/{uid}/{subcol}` we know about.

    Returns a counter dict keyed by subcollection name so callers can log
    the deletion fanout. Tolerant to missing subcollections (Firestore
    `stream()` over a non-existent path is a no-op).
    """
    counts: dict[str, int] = {}
    for subcol in _USER_SUBCOLLECTIONS:
        col = db.collection("users").document(uid).collection(subcol)
        n = 0
        for snap in col.stream():
            snap.reference.delete()
            n += 1
        counts[subcol] = n
    return counts


def _delete_private_subcollection(db: Any, uid: str) -> None:
    private_col = db.collection("users").document(uid).collection("private")
    for snap in private_col.stream():
        snap.reference.delete()


def _delete_group_memberships(db: Any, uid: str) -> tuple[int, list[str]]:
    """Remove the user's `groups/{gid}/members/{uid}` rows + decrement
    `memberCount` on each parent group.

    The `onMemberWrite` Cloud Function maintains `leaderCount` and
    `leaderUids` automatically, so the in-line decrement here is only for
    `memberCount` (which has no trigger).

    Returns `(count, gids)` so the caller can drive RTDB cleanup
    (`presence/{gid}/{uid}`, `typing/{gid}/{uid}`, `watch/{gid}/*`)
    against exactly the groups the user was a member of without a
    second CG query.
    """
    query = db.collection_group("members").where("uid", "==", uid)
    count = 0
    gids: list[str] = []
    for snap in query.stream():
        # Path: `{collection}/{docId}/members/{uid}`. Only act on group
        # members; org members are handled separately below.
        parent = snap.reference.parent.parent
        if parent is None or parent.parent is None or parent.parent.id != "groups":
            continue
        try:
            parent.update({"memberCount": fb_firestore.Increment(-1)})
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "memberCount decrement failed gid=%s err=%s",
                parent.id,
                exc,
            )
        snap.reference.delete()
        count += 1
        gids.append(parent.id)
    return count, gids


def _delete_org_memberships(db: Any, uid: str) -> int:
    """Remove `orgs/{orgId}/members/{uid}` rows. Org membership has no
    counter to decrement; the doc is the membership."""
    query = db.collection_group("members").where("uid", "==", uid)
    count = 0
    for snap in query.stream():
        parent = snap.reference.parent.parent
        if parent is None or parent.parent is None or parent.parent.id != "orgs":
            continue
        snap.reference.delete()
        count += 1
    return count


def _delete_org_admins(db: Any, uid: str) -> int:
    """Remove `orgs/{orgId}/admins/{uid}` rows.

    Without this the deleted user keeps surfacing in
    `/api/orgs/{orgId}/admins` and inflates the `last_admin` guard in
    `orgs_service.remove_admin` — leaving a real surviving admin unable
    to remove themselves because the zombie row keeps the count above 1.

    The admin doc id is the user's uid, so a CG `__name__` filter is the
    cheapest path; we still verify the parent is an `orgs` doc because
    other collections may name a subcollection `admins` (the catch-all
    keeps this defensive against future schema drift).
    """
    count = 0
    cg = db.collection_group("admins").where("__name__", "==", uid)
    for snap in cg.stream():
        parent = snap.reference.parent.parent
        if parent is None or parent.parent is None or parent.parent.id != "orgs":
            continue
        snap.reference.delete()
        count += 1
    return count


def _delete_reactions_by_user(db: Any, uid: str) -> int:
    """Reaction-user docs live at `groups/{gid}/messages/{mid}/reactions/
    {slug}/users/{uid}`. The `users` subcollection name collides with the
    top-level `users` collection at the collection-group level, and the
    Python Admin SDK doesn't expose a clean by-document-id filter for CG
    queries — so we cannot use a single CG query.

    Tracked as a follow-up: either denormalise a `userUid` field on the
    reaction doc and CG-query by that, or maintain a `users/{uid}/
    reactions` index on every reaction write. For now the reaction docs
    contain only `reactedAt` (no PII beyond a timestamp). The
    reactionCounts on the parent message stay slightly inflated for any
    message the user reacted to until the next re-index; tracked in
    `docs/follow-ups/phase-2-deferred.md`.
    """
    return 0


def _delete_event_rsvps(db: Any, uid: str) -> int:
    """Delete `groups/{gid}/events/{eid}/rsvps/{uid}` rows.

    The RSVP doc id is the user's uid, so a CG filter on `__name__` is
    far cheaper than streaming every RSVP and filtering in Python.
    """
    cg = db.collection_group("rsvps").where("__name__", "==", uid)
    count = 0
    for snap in cg.stream():
        snap.reference.delete()
        count += 1
    return count


def _delete_others_blocks_and_mutes(db: Any, uid: str) -> dict[str, int]:
    """Delete every other user's `users/{otherUid}/blocks/{uid}` and
    `users/{otherUid}/mutes/{uid}` rows so a deleted account no longer
    appears in anyone else's mute/block lists.

    The user's own `blocks` / `mutes` subcollections are removed by
    `_delete_user_subcollections`; this is the inverse direction.
    """
    counts = {"blocks": 0, "mutes": 0}
    for subcol in ("blocks", "mutes"):
        cg = db.collection_group(subcol).where("__name__", "==", uid)
        for snap in cg.stream():
            snap.reference.delete()
            counts[subcol] += 1
    return counts


def _delete_ban(db: Any, uid: str) -> bool:
    """Drop `bans/{uid}` so a re-registered uid (admin-issued, not the
    same person — see auth) doesn't inherit a stale ban.
    """
    ref = db.collection("bans").document(uid)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        return False
    ref.delete()
    return True


def _end_watch_sessions(db: Any, uid: str) -> int:
    """Mark any in-progress watch sessions led by the deleted user as
    ended. Mirrors `end_watch_session` semantics: stamp `endedAt`.
    """
    cg = db.collection_group("watch_sessions").where("leaderUid", "==", uid)
    count = 0
    for snap in cg.stream():
        data = snap.to_dict() or {}
        if data.get("endedAt") is not None:
            continue
        snap.reference.update({"endedAt": fb_firestore.SERVER_TIMESTAMP})
        count += 1
    return count


def _cleanup_rtdb_for_user(uid: str, gids: list[str]) -> dict[str, int]:
    """Remove the deleted user's Realtime Database footprint (M4).

    The Firestore member-doc delete already fires `onMemberWrite` which
    clears `memberships/{uid}/{gid}` — that piece is left to the trigger
    so the same code path handles ordinary leave-group events. Three
    other RTDB locations have no trigger and would otherwise linger:

      - `presence/{gid}/{uid}` — PresenceBar shows phantoms otherwise.
      - `typing/{gid}/{uid}` — "X is typing" indicator for a ghost.
      - `watch/{gid}/{sessionId}` where `leaderUid == uid` — a live
        watch-party session the deleted user was leading.

    The `gids` list comes from `_delete_group_memberships` so we only
    touch groups the user was actually a member of (cheaper than a
    shallow scan of the whole `watch` tree, and covers every legitimate
    case — non-members can't hold presence/typing/leader state for a
    group whose RTDB write rule requires membership).

    Returns a per-key counter so the audit log records the fanout.
    Best-effort: an RTDB error is logged but doesn't fail the
    finalize-account transaction (the rest of the deletion is more
    important than orphaned signal-channel rows).
    """
    counts = {"presence": 0, "typing": 0, "watch": 0}
    if not gids:
        return counts
    url = get_settings().firebase_database_url or None
    if not url:
        logger.info(
            "rtdb cleanup skipped uid=%s — FIREBASE_DATABASE_URL not configured",
            uid,
        )
        return counts

    for gid in gids:
        for kind in ("presence", "typing"):
            try:
                firebase_db.reference(f"{kind}/{gid}/{uid}", url=url).delete()
                counts[kind] += 1
            except Exception as exc:  # noqa: BLE001 — best-effort cleanup
                logger.warning(
                    "rtdb %s delete failed gid=%s uid=%s err=%s",
                    kind,
                    gid,
                    uid,
                    exc,
                )

        try:
            sessions = firebase_db.reference(f"watch/{gid}", url=url).get() or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("rtdb watch read failed gid=%s err=%s", gid, exc)
            continue
        if not isinstance(sessions, dict):
            continue
        for session_id, session in sessions.items():
            if not isinstance(session, dict):
                continue
            if session.get("leaderUid") != uid:
                continue
            try:
                firebase_db.reference(f"watch/{gid}/{session_id}", url=url).delete()
                counts["watch"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "rtdb watch delete failed gid=%s sid=%s err=%s",
                    gid,
                    session_id,
                    exc,
                )
    return counts


def _handle_founder_groups(db: Any, uid: str) -> dict[str, int]:
    """For each group whose `founderUid` matches the deleted user:

    - Pick a remaining leader as the new founder.
    - If no other leader exists, archive the group with a system reason.

    Leader lookup tries the `leaderUids` denorm first (cheap, in-memory).
    If that's empty or only contains the deleted user, fall back to a
    fresh `members where role=="leader"` scan on the group's `members`
    subcollection. The denorm is maintained by `onMemberWrite` but its
    backfill is parked (H3): groups that pre-date the trigger can have
    an empty `leaderUids` while still holding real leader rows, which
    would otherwise cause this helper to archive a group that has
    surviving leaders.

    MUST run before `_delete_group_memberships` so the deleted user's
    membership row is still present for the fallback scan.
    """
    counts = {"transferred": 0, "archived": 0}
    for snap in db.collection("groups").where("founderUid", "==", uid).stream():
        data = snap.to_dict() or {}
        candidates = [lu for lu in (data.get("leaderUids") or []) if lu and lu != uid]
        if not candidates:
            members_q = snap.reference.collection("members").where("role", "==", "leader").stream()
            candidates = [
                m.id
                for m in members_q
                if m.id != uid and (m.to_dict() or {}).get("role") == "leader"
            ]
        if candidates:
            snap.reference.update({"founderUid": candidates[0]})
            counts["transferred"] += 1
        elif data.get("archivedAt") is None:
            snap.reference.update(
                {
                    "archivedAt": fb_firestore.SERVER_TIMESTAMP,
                    "archivedBy": "system",
                    "archiveReason": "founder_deleted",
                }
            )
            counts["archived"] += 1
    return counts


def _tombstone_board_content(db: Any, uid: str, *, keep_body: bool) -> dict[str, int]:
    """Tombstone the user's authored board posts and replies, mirroring
    the message tombstone semantics."""
    counts = {"posts": 0, "replies": 0}
    posts_q = db.collection_group("posts").where("authorUid", "==", uid)
    for snap in posts_q.stream():
        # Skip non-board `posts` collections if any exist outside boards.
        path = snap.reference.path
        if not path.startswith("boards/"):
            continue
        update: dict[str, Any] = {"authorUid": TOMBSTONE_UID}
        if not keep_body:
            update["body"] = ""
        snap.reference.update(update)
        counts["posts"] += 1
    replies_q = db.collection_group("replies").where("authorUid", "==", uid)
    for snap in replies_q.stream():
        path = snap.reference.path
        if not path.startswith("boards/"):
            continue
        update = {"authorUid": TOMBSTONE_UID}
        if not keep_body:
            update["body"] = ""
        snap.reference.update(update)
        counts["replies"] += 1
    return counts


def _delete_reports_by_user(db: Any, uid: str) -> int:
    """Delete `moderation_queue` rows where the user filed the report.

    Authored content + reports about the user are kept (those are
    moderator-facing audit trails). Only reports the user *filed* go.
    """
    query = db.collection("moderation_queue").where("reportedBy", "==", uid)
    count = 0
    for snap in query.stream():
        snap.reference.delete()
        count += 1
    return count


def _delete_typesense_messages(uid: str) -> int:
    """Search-sidecar cleanup is delegated to the existing
    `onMessageWrite` Cloud Function (functions/src/onMessageWrite.ts).

    Tombstoning a message (via `_tombstone_messages` above) fires that
    trigger, which re-indexes the message in Typesense with the
    tombstoned authorUid. No direct delete is needed here. Returns 0.
    """
    return 0


def finalize_account(uid: str) -> dict[str, Any]:
    """Hard-delete a user past their grace window. Idempotent (C1).

    Order matters:
      1. Disable the Firebase Auth account so no fresh tokens can be minted.
      2. Tombstone authored messages + boards posts/replies.
      3. Delete reactions / RSVPs / reports filed by the user.
      4. End in-progress watch sessions the user was leading.
      5. Hand off founder status (or archive groups with no other leader)
         BEFORE removing the user's memberships, so we can read leaderUids
         and fall back to the members subcollection (H3).
      6. Delete group + org memberships (decrementing memberCount; the
         onMemberWrite trigger handles leaderCount + leaderUids). Capture
         the gid list for the RTDB sweep in step 9.
      7. Sweep `orgs/{*}/admins/{uid}` rows (M1) — no trigger maintains
         them, so a deleted org-admin would otherwise inflate the
         `last_admin` guard in `orgs_service.remove_admin`.
      8. Drop the user's `bans/{uid}` row + every other user's
         `blocks/{uid}` / `mutes/{uid}`.
      9. Delete avatar + private-profile + every subcollection under
         `users/{uid}`, then sweep RTDB presence/typing/watch state
         (M4) for the gids captured in step 6 — `onMemberWrite` handles
         `memberships/{uid}/{gid}` but nothing covers the other three.
     10. Best-effort search-sidecar cleanup.
     11. Delete `users/{uid}` doc.
     12. Audit log with actorUid="system".
    """
    db = _db()
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if not snap.exists:
        logger.info("finalize: user already gone uid=%s", uid)
        return {"uid": uid, "status": "already_gone"}

    data = snap.to_dict() or {}
    keep_body = bool(data.get("deletionKeepBody", True))
    photo_url = data.get("photoURL")

    try:
        firebase_auth.update_user(uid, disabled=True)
    except firebase_auth.UserNotFoundError:
        # The auth record is already gone; continue with Firestore cleanup.
        pass

    tombstoned = _tombstone_messages(db, uid, keep_body=keep_body)
    boards = _tombstone_board_content(db, uid, keep_body=keep_body)
    reactions_deleted = _delete_reactions_by_user(db, uid)
    rsvps_deleted = _delete_event_rsvps(db, uid)
    reports_deleted = _delete_reports_by_user(db, uid)
    watch_sessions_ended = _end_watch_sessions(db, uid)
    founder_handoff = _handle_founder_groups(db, uid)
    group_memberships, gids_for_rtdb = _delete_group_memberships(db, uid)
    org_memberships = _delete_org_memberships(db, uid)
    org_admins = _delete_org_admins(db, uid)
    ban_dropped = _delete_ban(db, uid)
    others_blocks_mutes = _delete_others_blocks_and_mutes(db, uid)
    typesense_deleted = _delete_typesense_messages(uid)

    _delete_avatar(photo_url if isinstance(photo_url, str) else None)
    _delete_private_subcollection(db, uid)
    subcol_counts = _delete_user_subcollections(db, uid)
    rtdb_counts = _cleanup_rtdb_for_user(uid, gids_for_rtdb)

    # Capture email/name before the doc disappears.
    to_email = data.get("email", "")
    display_name = data.get("displayName", "")
    user_ref.delete()

    payload: dict[str, Any] = {
        "keepBody": keep_body,
        "messagesTombstoned": tombstoned,
        "boardPostsTombstoned": boards["posts"],
        "boardRepliesTombstoned": boards["replies"],
        "reactionsDeleted": reactions_deleted,
        "rsvpsDeleted": rsvps_deleted,
        "reportsDeleted": reports_deleted,
        "watchSessionsEnded": watch_sessions_ended,
        "founderTransferred": founder_handoff["transferred"],
        "founderArchived": founder_handoff["archived"],
        "groupMemberships": group_memberships,
        "orgMemberships": org_memberships,
        "orgAdmins": org_admins,
        "banDropped": ban_dropped,
        "othersBlocksDeleted": others_blocks_mutes["blocks"],
        "othersMutesDeleted": others_blocks_mutes["mutes"],
        "typesenseDeleted": typesense_deleted,
        "userSubcollections": subcol_counts,
        "rtdbPresenceDeleted": rtdb_counts["presence"],
        "rtdbTypingDeleted": rtdb_counts["typing"],
        "rtdbWatchDeleted": rtdb_counts["watch"],
    }
    write_audit_log(
        actor_uid="system",
        action="account_finalized",
        target_ref=f"users/{uid}",
        payload=payload,
    )

    logger.info(
        "finalize complete uid=%s tombstoned=%d board_posts=%d board_replies=%d "
        "reactions=%d rsvps=%d reports=%d group_members=%d org_members=%d "
        "org_admins=%d watch_sessions=%d founder_transferred=%d founder_archived=%d "
        "ban_dropped=%s others_blocks=%d others_mutes=%d "
        "rtdb_presence=%d rtdb_typing=%d rtdb_watch=%d",
        uid,
        tombstoned,
        boards["posts"],
        boards["replies"],
        reactions_deleted,
        rsvps_deleted,
        reports_deleted,
        group_memberships,
        org_memberships,
        org_admins,
        watch_sessions_ended,
        founder_handoff["transferred"],
        founder_handoff["archived"],
        ban_dropped,
        others_blocks_mutes["blocks"],
        others_blocks_mutes["mutes"],
        rtdb_counts["presence"],
        rtdb_counts["typing"],
        rtdb_counts["watch"],
    )

    try:
        send_deletion_finalized(to_email=to_email, display_name=display_name)
    except Exception:
        logger.exception("deletion_finalized email failed uid=%s", uid)

    return {
        "uid": uid,
        "status": "finalized",
        "messagesTombstoned": tombstoned,
        "boardPostsTombstoned": boards["posts"],
        "boardRepliesTombstoned": boards["replies"],
        "reactionsDeleted": reactions_deleted,
        "rsvpsDeleted": rsvps_deleted,
        "reportsDeleted": reports_deleted,
        "groupMemberships": group_memberships,
        "orgMemberships": org_memberships,
        "orgAdmins": org_admins,
        "watchSessionsEnded": watch_sessions_ended,
        "founderTransferred": founder_handoff["transferred"],
        "founderArchived": founder_handoff["archived"],
        "banDropped": ban_dropped,
        "othersBlocksDeleted": others_blocks_mutes["blocks"],
        "othersMutesDeleted": others_blocks_mutes["mutes"],
        "rtdbPresenceDeleted": rtdb_counts["presence"],
        "rtdbTypingDeleted": rtdb_counts["typing"],
        "rtdbWatchDeleted": rtdb_counts["watch"],
    }


def find_users_due(now: datetime | None = None) -> list[str]:
    """UIDs whose deletionRequestedAt + 14d <= now."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=GRACE_PERIOD_DAYS)
    db = _db()
    query = db.collection("users").where("deletionRequestedAt", "<=", cutoff)
    return [snap.id for snap in query.stream()]
