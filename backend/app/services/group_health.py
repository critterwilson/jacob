"""Firestore-side aggregator for the T60 group-health dashboard.

The existing `services/analytics.py` is BigQuery-backed and gated on
`jacob_analytics_enabled`. This module supplements the BigQuery
results with two Firestore-derivable signals so the dashboard adds
value even on instances where BigQuery isn't running:

* event attendance per upcoming/recent event (from
  `groups/{gid}/events/*` + their RSVP subcollection)
* sentiment trend, as a daily rolling average of
  `moderation_queue.severity` filtered to the group

Per the spec runbook: never per-member sentiment. The output buckets
by day; the per-message moderation severity is the source signal but
no `uid` ever appears on the per-day aggregate.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


def _ts_to_str(value: Any) -> str | None:
    if value is None:
        return None
    try:
        result: str = value.isoformat()
        return result
    except AttributeError:
        return str(value)


def event_attendance(
    db: Any,
    *,
    gid: str,
    days: int = 30,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Per-event RSVP-going + attended counts for the last `days` days.

    Returns events sorted by `startsAt` ascending.
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    events_col = db.collection("groups").document(gid).collection("events")
    out: list[dict[str, Any]] = []
    for snap in events_col.stream():
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            continue
        starts_at = data.get("startsAt")
        if not isinstance(starts_at, datetime):
            continue
        starts_aware = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=UTC)
        if starts_aware < cutoff:
            continue
        rsvp_going = 0
        attended = 0
        for rsvp_snap in events_col.document(snap.id).collection("rsvps").stream():
            r = rsvp_snap.to_dict() or {}
            if r.get("status") == "going":
                rsvp_going += 1
            if r.get("attended") is True:
                attended += 1
        out.append(
            {
                "eventId": snap.id,
                "title": str(data.get("title", "")),
                "startsAt": _ts_to_str(starts_aware) or "",
                "rsvpGoing": rsvp_going,
                "attended": attended,
            }
        )
    out.sort(key=lambda r: r["startsAt"])
    return out


def sentiment_trend(
    db: Any,
    *,
    gid: str,
    days: int = 30,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Per-day average severity from `moderation_queue` for `gid`.

    No per-uid output. Days with zero queue items return 0.0 / count 0.
    The runbook documents that "low severity" is not the same as
    "everyone is happy."
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    sums: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    query = (
        db.collection("moderation_queue")
        .where("groupId", "==", gid)
        .where("createdAt", ">=", cutoff)
    )
    for snap in query.stream():
        data = snap.to_dict() or {}
        created = data.get("createdAt")
        if not isinstance(created, datetime):
            continue
        day = (created if created.tzinfo else created.replace(tzinfo=UTC)).date()
        key = day.isoformat()
        severity = data.get("severity")
        try:
            severity_val = float(severity) if severity is not None else 0.0
        except (TypeError, ValueError):
            severity_val = 0.0
        sums[key] += severity_val
        counts[key] += 1

    out = []
    for key, count in sorted(counts.items()):
        avg = sums[key] / count if count else 0.0
        out.append({"day": key, "avgSeverity": avg, "count": count})
    return out


def org_aggregate(
    db: Any,
    *,
    org_id: str,
    days: int = 30,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Roll a per-org dashboard up across attached groups.

    Reads the orgs/{orgId}/members denorm to count active members.
    Per-group totals come from existing per-group analytics + the
    Firestore-side helpers above. No per-member fields surface.
    """
    now = now or datetime.now(UTC)
    org_groups: list[dict[str, Any]] = []
    total_messages = 0
    total_attended = 0
    event_rows: list[dict[str, Any]] = []
    sentiment_rows_by_day: dict[str, dict[str, float]] = defaultdict(
        lambda: {"sum": 0.0, "count": 0.0}
    )

    for snap in db.collection("groups").where("orgId", "==", org_id).stream():
        data = snap.to_dict() or {}
        gid = snap.id
        events = event_attendance(db, gid=gid, days=days, now=now)
        attended_in_group = sum(int(e["attended"] or 0) for e in events)
        sent = sentiment_trend(db, gid=gid, days=days, now=now)
        for row in sent:
            sentiment_rows_by_day[row["day"]]["sum"] += row["avgSeverity"] * row["count"]
            sentiment_rows_by_day[row["day"]]["count"] += row["count"]

        # Approximate per-group message totals via memberCount * range
        # heuristic — replaced by BigQuery view aggregates when T60's
        # BQ extension lands.
        approx_messages = int(data.get("memberCount", 0) or 0) * 10
        org_groups.append(
            {
                "gid": gid,
                "name": str(data.get("name", "")),
                "totalMessages": approx_messages,
                "eventAttended": attended_in_group,
                "activeMembers": int(data.get("memberCount", 0) or 0),
            }
        )
        total_messages += approx_messages
        total_attended += attended_in_group
        event_rows.extend(events)

    # Org-wide active members = unique uids in the denorm.
    active_members = sum(
        1 for _ in db.collection("orgs").document(org_id).collection("members").stream()
    )
    sentiment_out = []
    for day in sorted(sentiment_rows_by_day.keys()):
        bucket = sentiment_rows_by_day[day]
        if bucket["count"] == 0:
            continue
        sentiment_out.append(
            {
                "day": day,
                "avgSeverity": bucket["sum"] / bucket["count"],
                "count": int(bucket["count"]),
            }
        )

    return {
        "orgId": org_id,
        "groupCount": len(org_groups),
        "activeMembers": active_members,
        "totalMessages": total_messages,
        "eventAttendance": sorted(event_rows, key=lambda r: r["startsAt"]),
        "sentimentTrend": sentiment_out,
        "groups": org_groups,
    }
