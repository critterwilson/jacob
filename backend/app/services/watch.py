"""Watch Together service (T50).

Reuses the YouTube videoId extractor and oEmbed helper from
`services/sermons.py` (T52) so the URL classification rules stay in
one place. `safe_fetch` (T53) backs the oEmbed call.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services import sermons as sermons_service

logger = logging.getLogger(__name__)


def extract_youtube_video_id(url: str) -> str | None:
    """Return the 11-char YouTube video id or None."""
    return sermons_service.youtube_video_id(url)


def fetch_oembed_metadata(url: str) -> dict[str, Any] | None:
    return sermons_service.fetch_youtube_oembed(url)


def create_watch_session(
    db: Any,
    *,
    gid: str,
    actor_uid: str,
    source_url: str,
    video_id: str,
    title: str | None,
    thumbnail: str | None,
) -> str:
    session_id = str(uuid.uuid4())
    db.collection("groups").document(gid).collection("watch_sessions").document(session_id).set(
        {
            "videoId": video_id,
            "sourceUrl": source_url,
            "title": title,
            "thumbnailUrl": thumbnail,
            "leaderUid": actor_uid,
            "createdBy": actor_uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "endedAt": None,
            "attendees": [actor_uid],
            "durationSec": None,
        }
    )
    logger.info(
        "watch_session_create gid=%s sid=%s actor=%s video=%s",
        gid,
        session_id,
        actor_uid,
        video_id,
    )
    return session_id


def list_watch_sessions(
    db: Any,
    *,
    gid: str,
    only_active: bool = True,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for snap in db.collection("groups").document(gid).collection("watch_sessions").stream():
        data = snap.to_dict() or {}
        if only_active and data.get("endedAt") is not None:
            continue
        data["sessionId"] = snap.id
        out.append(data)
    out.sort(
        key=lambda r: r.get("createdAt") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return out


def join_watch_session(
    db: Any,
    *,
    gid: str,
    session_id: str,
    uid: str,
) -> tuple[bool, str | None, list[str]]:
    """Append `uid` to attendees if absent. Returns (ok, reason, attendees)."""
    ref = db.collection("groups").document(gid).collection("watch_sessions").document(session_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found", []
    data = snap.to_dict() or {}
    if data.get("endedAt") is not None:
        return False, "already_ended", list(data.get("attendees") or [])
    attendees = list(data.get("attendees") or [])
    if uid in attendees:
        return True, None, attendees
    attendees.append(uid)
    ref.update({"attendees": attendees})
    return True, None, attendees


def end_watch_session(
    db: Any,
    *,
    gid: str,
    session_id: str,
    actor_uid: str,
    now: datetime | None = None,
) -> tuple[bool, str | None, datetime, int]:
    """Mark the session ended. Returns (ok, reason, endedAt, durationSec)."""
    ref = db.collection("groups").document(gid).collection("watch_sessions").document(session_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found", datetime.now(UTC), 0
    data = snap.to_dict() or {}
    if data.get("endedAt") is not None:
        existing = data.get("endedAt")
        if isinstance(existing, datetime):
            tz_aware = existing if existing.tzinfo else existing.replace(tzinfo=UTC)
            return True, "already_ended", tz_aware, int(data.get("durationSec") or 0)
        return True, "already_ended", datetime.now(UTC), int(data.get("durationSec") or 0)
    if actor_uid not in (data.get("attendees") or []):
        return False, "not_attendee", datetime.now(UTC), 0
    now = now or datetime.now(UTC)
    started_at = data.get("createdAt")
    duration = 0
    if isinstance(started_at, datetime):
        started_aware = started_at if started_at.tzinfo else started_at.replace(tzinfo=UTC)
        duration = max(0, int((now - started_aware).total_seconds()))
    ref.update({"endedAt": now, "durationSec": duration})
    return True, None, now, duration


def transfer_leader(
    db: Any,
    *,
    gid: str,
    session_id: str,
    current_leader_uid: str,
    new_leader_uid: str,
) -> tuple[bool, str | None]:
    """Transfer leadership. Only the current leader can transfer."""
    ref = db.collection("groups").document(gid).collection("watch_sessions").document(session_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found"
    data = snap.to_dict() or {}
    if data.get("endedAt") is not None:
        return False, "already_ended"
    if data.get("leaderUid") != current_leader_uid:
        return False, "not_leader"
    if new_leader_uid not in (data.get("attendees") or []):
        return False, "not_attendee"
    ref.update({"leaderUid": new_leader_uid})
    return True, None
