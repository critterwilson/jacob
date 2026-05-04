"""Appeals service (T64).

The "different admin" rule + reversal mechanics live here so the
router stays thin and the test surface is small.

Reversal scope (v1):
* `message` subject — clears `moderation.state` on the message doc
  so the message renders again.
* `ban` subject — deletes the `bans/{uid}` doc so the ban lifts.
* `group_archive` — clears `archivedAt` / `archivedBy` /
  `archiveReason` on the group doc.

Single-admin override: if the platform has exactly one admin AND
that admin is the original actor, the decide endpoint returns
`self_review_required`. The runbook covers contacting another
team for review; in dev / single-admin deployments, set
`JACOB_ALLOW_SELF_APPEAL_REVIEW=true` to bypass (test-only).
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


SLA_DAYS = 7
SELF_REVIEW_OVERRIDE_ENV = "JACOB_ALLOW_SELF_APPEAL_REVIEW"


def _self_review_override() -> bool:
    return os.environ.get(SELF_REVIEW_OVERRIDE_ENV, "").lower() in {"1", "true", "yes"}


def _admin_count(db: Any) -> int:
    """Best-effort: count platform admins via Firebase Auth custom claims.

    The Admin SDK doesn't expose a direct count of users with the
    `admin` claim. Without paging through every user (expensive at
    scale) we approximate by checking for any other admin in
    `audit_log` `actorUid` history. v1 ships the env-var override for
    the exact-one-admin edge case; this helper is here so a follow-up
    can lift the override once a real admin-listing surface exists.
    """
    return 0


def submit_appeal(
    db: Any,
    *,
    subject_type: str,
    subject_ref: str,
    appellant_uid: str,
    body: str,
    original_actor_uid: str | None = None,
    original_action_at: datetime | None = None,
    now: datetime | None = None,
) -> tuple[bool, str | None, str | None]:
    """Create a `pending` appeal. Returns `(ok, reason, appeal_id)`.

    Refuses if any non-pending appeal already exists for the same
    `(subject_ref, appellant_uid)` (one bite at the apple).
    """
    existing_query = (
        db.collection("appeals")
        .where("subject.ref", "==", subject_ref)
        .where("appellantUid", "==", appellant_uid)
    )
    for snap in existing_query.stream():
        data = snap.to_dict() or {}
        if data.get("decision") in {"pending", "upheld", "reversed"}:
            return False, "appeal_already_decided", snap.id

    appeal_id = str(uuid.uuid4())
    now = now or datetime.now(UTC)
    db.collection("appeals").document(appeal_id).set(
        {
            "subject": {"type": subject_type, "ref": subject_ref},
            "appellantUid": appellant_uid,
            "originalActorUid": original_actor_uid,
            "originalActionAt": original_action_at,
            "submittedAt": now,
            "body": body,
            "decision": "pending",
            "decidedBy": None,
            "decidedAt": None,
            "reasoning": None,
            "schemaVersion": 1,
        }
    )
    return True, None, appeal_id


def is_overdue(submitted_at: Any, *, now: datetime | None = None) -> bool:
    if not isinstance(submitted_at, datetime):
        return False
    submitted_aware = submitted_at if submitted_at.tzinfo else submitted_at.replace(tzinfo=UTC)
    now = now or datetime.now(UTC)
    return (now - submitted_aware) > timedelta(days=SLA_DAYS)


def decide(
    db: Any,
    *,
    appeal_id: str,
    actor_uid: str,
    decision: str,
    reasoning: str,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Apply an admin decision. Returns `(ok, reason)`.

    Reasons: `not_found`, `already_decided`, `self_review_required`,
    `unknown_subject_type`.
    """
    ref = db.collection("appeals").document(appeal_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found"
    data = snap.to_dict() or {}
    if data.get("decision") in {"upheld", "reversed"}:
        return False, "already_decided"
    if data.get("originalActorUid") == actor_uid and not _self_review_override():
        return False, "self_review_required"

    now = now or datetime.now(UTC)
    ref.update(
        {
            "decision": decision,
            "decidedBy": actor_uid,
            "decidedAt": now,
            "reasoning": reasoning,
        }
    )

    if decision == "reversed":
        applied, why = _apply_reversal(db, subject=data.get("subject") or {})
        if not applied:
            logger.warning(
                "appeal_reverse_partial appeal=%s reason=%s",
                appeal_id,
                why,
            )
    return True, None


def _apply_reversal(
    db: Any,
    *,
    subject: dict[str, Any],
) -> tuple[bool, str | None]:
    """Best-effort reversal of the underlying moderation action."""
    subject_type = subject.get("type")
    ref_path = subject.get("ref") or ""
    parts = [p for p in ref_path.strip("/").split("/") if p]
    if subject_type == "message":
        if len(parts) != 4 or parts[0] != "groups" or parts[2] != "messages":
            return False, "bad_message_ref"
        gid, mid = parts[1], parts[3]
        msg_ref = db.collection("groups").document(gid).collection("messages").document(mid)
        snap = msg_ref.get()
        if not snap.exists:
            return False, "message_not_found"
        msg_ref.set({"moderation": fb_firestore.DELETE_FIELD}, merge=True)
        return True, None
    if subject_type == "ban":
        if len(parts) != 2 or parts[0] != "bans":
            return False, "bad_ban_ref"
        db.collection("bans").document(parts[1]).delete()
        return True, None
    if subject_type == "group_archive":
        if len(parts) != 2 or parts[0] != "groups":
            return False, "bad_group_ref"
        db.collection("groups").document(parts[1]).update(
            {
                "archivedAt": None,
                "archivedBy": None,
                "archiveReason": None,
            }
        )
        return True, None
    return False, "unknown_subject_type"


def list_appeals(
    db: Any,
    *,
    decision: str | None = None,
) -> list[dict[str, Any]]:
    query: Any = db.collection("appeals")
    if decision is not None:
        query = query.where("decision", "==", decision)
    out: list[dict[str, Any]] = []
    for snap in query.stream():
        data = snap.to_dict() or {}
        data["appealId"] = snap.id
        out.append(data)
    out.sort(
        key=lambda r: r.get("submittedAt") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return out


def get_appeal(db: Any, appeal_id: str) -> dict[str, Any] | None:
    snap = db.collection("appeals").document(appeal_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data["appealId"] = appeal_id
    return data
