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
from firebase_admin import firestore as fb_firestore

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
    """Replace authorUid with TOMBSTONE_UID across all groups. Returns count."""
    query = db.collection_group("messages").where("authorUid", "==", uid)
    count = 0
    for snap in query.stream():
        update: dict[str, Any] = {"authorUid": TOMBSTONE_UID}
        if not keep_body:
            update["body"] = ""
        snap.reference.update(update)
        count += 1
    return count


def _delete_private_subcollection(db: Any, uid: str) -> None:
    private_col = db.collection("users").document(uid).collection("private")
    for snap in private_col.stream():
        snap.reference.delete()


def finalize_account(uid: str) -> dict[str, Any]:
    """Hard-delete a user past their grace window. Idempotent.

    Order matters:
      1. Disable the Firebase Auth account so no fresh tokens can be minted.
      2. Tombstone messages (still need the user doc for keepBody).
      3. Delete avatar object from GCS.
      4. Delete `users/{uid}/private/profile`.
      5. Delete `users/{uid}` doc.
      6. Audit log with actorUid="system".
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
    _delete_avatar(photo_url if isinstance(photo_url, str) else None)
    _delete_private_subcollection(db, uid)

    # Capture email/name before the doc disappears.
    to_email = data.get("email", "")
    display_name = data.get("displayName", "")
    user_ref.delete()

    write_audit_log(
        actor_uid="system",
        action="account_finalized",
        target_ref=f"users/{uid}",
        payload={"keepBody": keep_body, "messagesTombstoned": tombstoned},
    )

    logger.info("finalize complete uid=%s tombstoned=%d", uid, tombstoned)

    try:
        send_deletion_finalized(to_email=to_email, display_name=display_name)
    except Exception:
        logger.exception("deletion_finalized email failed uid=%s", uid)

    return {"uid": uid, "status": "finalized", "messagesTombstoned": tombstoned}


def find_users_due(now: datetime | None = None) -> list[str]:
    """UIDs whose deletionRequestedAt + 14d <= now."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=GRACE_PERIOD_DAYS)
    db = _db()
    query = db.collection("users").where("deletionRequestedAt", "<=", cutoff)
    return [snap.id for snap in query.stream()]
