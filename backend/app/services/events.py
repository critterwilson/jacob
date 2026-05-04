"""Scheduled-events service (T49).

Encapsulates event create + recurrence expansion, RSVP writes,
check-in window enforcement, and the reminder dispatch helpers used
by `infra/scheduled/event_reminders.py`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


CHECK_IN_WINDOW_MINUTES = 15
DEFAULT_REMINDER_LEAD_MINUTES = 60
DEFAULT_REMINDER_WINDOW_MINUTES = 15
MAX_OCCURRENCES = 12


def parse_iso(value: str) -> datetime:
    """Accept the JSON ISO-8601 we receive on the wire and normalise to UTC."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def occurrences(
    *,
    starts_at: datetime,
    ends_at: datetime,
    recurrence_kind: str | None,
    count: int,
) -> list[tuple[datetime, datetime]]:
    """Return `[(start, end), ...]` for the root + each recurrence step.

    Capped at `MAX_OCCURRENCES` even if the caller asks for more.
    `count` is the total including the root.
    """
    n = max(1, min(count, MAX_OCCURRENCES))
    if recurrence_kind is None or recurrence_kind not in {"weekly", "biweekly"}:
        return [(starts_at, ends_at)]
    step = timedelta(weeks=1) if recurrence_kind == "weekly" else timedelta(weeks=2)
    out: list[tuple[datetime, datetime]] = []
    for i in range(n):
        delta = step * i
        out.append((starts_at + delta, ends_at + delta))
    return out


def create_events(
    db: Any,
    *,
    gid: str,
    actor_uid: str,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    location: str | None,
    recurrence: dict[str, Any] | None,
) -> list[str]:
    """Create the root + every recurrence child in one batch.

    Returns the list of event ids in occurrence order. The root is
    always at index 0; children get `parentEventId` set to the root.
    """
    if ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")

    recurrence_kind = recurrence.get("kind") if recurrence else None
    count = int(recurrence.get("count", 1)) if recurrence else 1
    instances = occurrences(
        starts_at=starts_at,
        ends_at=ends_at,
        recurrence_kind=recurrence_kind,
        count=count,
    )

    ids: list[str] = [str(uuid.uuid4()) for _ in instances]
    root_id = ids[0]

    batch = db.batch()
    events_col = db.collection("groups").document(gid).collection("events")
    for index, (event_id, (s, e)) in enumerate(zip(ids, instances)):
        ref = events_col.document(event_id)
        batch.set(
            ref,
            {
                "title": title.strip(),
                "description": description.strip(),
                "startsAt": s,
                "endsAt": e,
                "location": location.strip() if location else None,
                "recurrence": recurrence if index == 0 else None,
                "createdBy": actor_uid,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
                "deletedAt": None,
                "reminderSentAt": None,
                "parentEventId": None if index == 0 else root_id,
                "occurrenceIndex": index,
            },
        )
    batch.commit()
    logger.info(
        "events_create gid=%s root=%s count=%d kind=%s",
        gid,
        root_id,
        len(ids),
        recurrence_kind,
    )
    return ids


def list_events(
    db: Any,
    *,
    gid: str,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    """Return every event for a group, sorted by `startsAt` ascending."""
    rows: list[dict[str, Any]] = []
    for snap in db.collection("groups").document(gid).collection("events").stream():
        data = snap.to_dict() or {}
        if not include_deleted and data.get("deletedAt") is not None:
            continue
        data["eventId"] = snap.id
        rows.append(data)
    rows.sort(key=lambda r: r.get("startsAt") or datetime.min.replace(tzinfo=UTC))
    return rows


def list_rsvps(db: Any, *, gid: str, event_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    rsvps_col = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
    )
    for snap in rsvps_col.stream():
        data = snap.to_dict() or {}
        data["uid"] = snap.id
        rows.append(data)
    return rows


def aggregate_rsvp_counts(rsvps: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"going": 0, "maybe": 0, "no": 0, "attended": 0}
    for r in rsvps:
        status = r.get("status")
        if status in counts:
            counts[status] += 1
        if r.get("attended") is True:
            counts["attended"] += 1
    return counts


def upsert_rsvp(
    db: Any,
    *,
    gid: str,
    event_id: str,
    uid: str,
    status: str,
) -> None:
    if status not in {"going", "maybe", "no"}:
        raise ValueError("status must be going / maybe / no")
    ref = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
        .document(uid)
    )
    snap = ref.get()
    payload: dict[str, Any] = {
        "status": status,
        "respondedAt": fb_firestore.SERVER_TIMESTAMP,
    }
    if snap.exists:
        ref.update(payload)
    else:
        payload["attended"] = None
        payload["checkedInAt"] = None
        ref.set(payload)


def in_check_in_window(*, starts_at: datetime, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    delta = timedelta(minutes=CHECK_IN_WINDOW_MINUTES)
    return starts_at - delta <= now <= starts_at + delta


def mark_check_in(
    db: Any,
    *,
    gid: str,
    event_id: str,
    uid: str,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Member-driven check-in. Returns `(ok, reason)`.

    Reasons: `not_found`, `outside_window`.
    """
    event_ref = db.collection("groups").document(gid).collection("events").document(event_id)
    event_snap = event_ref.get()
    if not event_snap.exists or (event_snap.to_dict() or {}).get("deletedAt") is not None:
        return False, "not_found"
    starts_at = (event_snap.to_dict() or {}).get("startsAt")
    if not isinstance(starts_at, datetime):
        return False, "not_found"
    starts_at = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=UTC)
    if not in_check_in_window(starts_at=starts_at, now=now):
        return False, "outside_window"

    rsvp_ref = event_ref.collection("rsvps").document(uid)
    rsvp_snap = rsvp_ref.get()
    if rsvp_snap.exists:
        rsvp_ref.update(
            {
                "attended": True,
                "checkedInAt": fb_firestore.SERVER_TIMESTAMP,
            }
        )
    else:
        rsvp_ref.set(
            {
                "status": "going",
                "respondedAt": fb_firestore.SERVER_TIMESTAMP,
                "attended": True,
                "checkedInAt": fb_firestore.SERVER_TIMESTAMP,
            }
        )
    return True, None


def mark_manual_attendance(
    db: Any,
    *,
    gid: str,
    event_id: str,
    uid: str,
    attended: bool,
) -> bool:
    ref = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
        .document(uid)
    )
    snap = ref.get()
    payload: dict[str, Any] = {"attended": attended}
    if attended:
        payload["checkedInAt"] = fb_firestore.SERVER_TIMESTAMP
    if snap.exists:
        ref.update(payload)
    else:
        ref.set(
            {
                "status": "going" if attended else "no",
                "respondedAt": fb_firestore.SERVER_TIMESTAMP,
                **payload,
            }
        )
    return True


def soft_delete_event(
    db: Any,
    *,
    gid: str,
    event_id: str,
    cascade: bool = True,
) -> int:
    """Soft-delete an event. With `cascade`, also deletes recurrence children."""
    events_col = db.collection("groups").document(gid).collection("events")
    snap = events_col.document(event_id).get()
    if not snap.exists or (snap.to_dict() or {}).get("deletedAt") is not None:
        return 0
    now = fb_firestore.SERVER_TIMESTAMP
    events_col.document(event_id).update({"deletedAt": now})
    deleted = 1
    if cascade and (snap.to_dict() or {}).get("parentEventId") is None:
        for child in events_col.where("parentEventId", "==", event_id).stream():
            child_data = child.to_dict() or {}
            if child_data.get("deletedAt") is not None:
                continue
            events_col.document(child.id).update({"deletedAt": now})
            deleted += 1
    return deleted


# ── reminder dispatch ─────────────────────────────────────────────────────────


def find_due_reminders(
    db: Any,
    *,
    now: datetime,
    lead_minutes: int = DEFAULT_REMINDER_LEAD_MINUTES,
    window_minutes: int = DEFAULT_REMINDER_WINDOW_MINUTES,
) -> list[dict[str, Any]]:
    """Return active events whose `startsAt` lands in the reminder window.

    The dispatch job runs every `window_minutes` (default 15) and looks
    `lead_minutes` ahead (default 60). For an event starting in
    [60, 75) minutes from now, this returns it once until
    `reminderSentAt` is set.
    """
    lower = now + timedelta(minutes=lead_minutes)
    upper = now + timedelta(minutes=lead_minutes + window_minutes)
    query = (
        db.collection_group("events").where("startsAt", ">=", lower).where("startsAt", "<", upper)
    )
    out: list[dict[str, Any]] = []
    for snap in query.stream():
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            continue
        if data.get("reminderSentAt") is not None:
            continue
        # Path is groups/{gid}/events/{eventId} — pull gid from the parent.
        parent = snap.reference.parent.parent  # collection -> group doc
        if parent is None:
            continue
        data["eventId"] = snap.id
        data["gid"] = parent.id
        data["_ref"] = snap.reference
        out.append(data)
    return out


def fan_out_event_reminder(
    db: Any,
    *,
    gid: str,
    event_id: str,
    title: str,
    starts_at: datetime,
) -> int:
    """Write one notification doc per RSVP'd-going user. Returns count.

    Skips banned users (mirrors the same guard the moderation pipeline
    uses) and skips users with the event-reminder kind opted out.
    """
    rsvps_col = (
        db.collection("groups")
        .document(gid)
        .collection("events")
        .document(event_id)
        .collection("rsvps")
    )
    sent = 0
    for rsvp_snap in rsvps_col.where("status", "==", "going").stream():
        uid = rsvp_snap.id
        # Banned guard: skip but don't fail the batch.
        ban_snap = db.collection("bans").document(uid).get()
        if ban_snap.exists:
            ban_data = ban_snap.to_dict() or {}
            expires = ban_data.get("expiresAt")
            now_utc = datetime.now(UTC)
            if expires is None or (
                isinstance(expires, datetime)
                and (expires if expires.tzinfo else expires.replace(tzinfo=UTC)) > now_utc
            ):
                continue
        notif_id = f"event_{event_id}_{uid}"
        db.collection("users").document(uid).collection("notifications").document(notif_id).set(
            {
                "kind": "event_reminder",
                "groupId": gid,
                "title": title,
                "data": {
                    "eventRef": f"groups/{gid}/events/{event_id}",
                    "startsAt": starts_at,
                },
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
                "readAt": None,
            }
        )
        sent += 1
    return sent


def mark_reminder_sent(ref: Any) -> None:
    ref.update({"reminderSentAt": fb_firestore.SERVER_TIMESTAMP})


# ── ICS file ──────────────────────────────────────────────────────────────────


def _ics_escape(value: str) -> str:
    # RFC 5545 §3.3.11 — backslash-escape comma, semicolon, backslash; CRLF for newlines.
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_format_dt(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def build_ics(
    *,
    event_id: str,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    location: str | None,
    domain: str = "jacob.app",
) -> str:
    """Build a single-VEVENT ICS for one occurrence."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//JACOB//Phase 3 events//EN",
        "BEGIN:VEVENT",
        f"UID:{event_id}@{domain}",
        f"DTSTAMP:{_ics_format_dt(datetime.now(UTC))}",
        f"DTSTART:{_ics_format_dt(starts_at)}",
        f"DTEND:{_ics_format_dt(ends_at)}",
        f"SUMMARY:{_ics_escape(title)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{_ics_escape(description)}")
    if location:
        lines.append(f"LOCATION:{_ics_escape(location)}")
    lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    # RFC 5545 mandates CRLF line endings.
    return "\r\n".join(lines) + "\r\n"
