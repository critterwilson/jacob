"""Transparency report aggregator (T65).

Generates a quarterly bucketed-counts report from
`moderation_queue`, `bans`, `appeals`, `ncmec_cases`, `audit_log`.

Two scopes:
* `platform` — every group on the platform
* `<orgId>` — only groups attached to that org

Privacy contract:
* Payloads are integer counts. No uids, group ids, message ids,
  emails, or free-text fields ever appear in the payload.
* `payload_contains_pii(payload)` is the runtime guard; the
  privacy-guard test calls it on every generated payload.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


# ── period helpers ────────────────────────────────────────────────────────


def quarter_for(dt: datetime) -> str:
    """Return the Qn label for `dt` (e.g. `2026-Q1`)."""
    q = (dt.month - 1) // 3 + 1
    return f"{dt.year}-Q{q}"


def previous_quarter(now: datetime | None = None) -> tuple[str, datetime, datetime]:
    """Return `(label, start, end)` for the quarter prior to `now`.

    `start` is inclusive, `end` is exclusive (start of the next quarter).
    """
    now = now or datetime.now(UTC)
    q = (now.month - 1) // 3 + 1  # current quarter, 1..4
    if q == 1:
        prev_year, prev_q = now.year - 1, 4
    else:
        prev_year, prev_q = now.year, q - 1
    start_month = (prev_q - 1) * 3 + 1
    start = datetime(prev_year, start_month, 1, tzinfo=UTC)
    end_month = start_month + 3
    end_year = prev_year
    if end_month > 12:
        end_month -= 12
        end_year += 1
    end = datetime(end_year, end_month, 1, tzinfo=UTC)
    return f"{prev_year}-Q{prev_q}", start, end


# ── privacy guard ────────────────────────────────────────────────────────


_PII_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Firebase uids are 28-char alphanumeric
    re.compile(r"\b[A-Za-z0-9]{28}\b"),
    # Group / message paths
    re.compile(r"\bgroups?/[A-Za-z0-9_-]+"),
    re.compile(r"\busers?/[A-Za-z0-9_-]+"),
    re.compile(r"\bmessages?/[A-Za-z0-9_-]+"),
    re.compile(r"\bappeals?/[A-Za-z0-9_-]+"),
    re.compile(r"\bbans?/[A-Za-z0-9_-]+"),
    # Email
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
)


def payload_contains_pii(payload: Any) -> str | None:
    """Return the first matching PII fragment, or None if clean.

    Walks lists / dicts recursively and tests every string value.
    """

    def _walk(node: Any) -> str | None:
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(k, str):
                    for pat in _PII_PATTERNS:
                        m = pat.search(k)
                        if m:
                            return m.group(0)
                hit = _walk(v)
                if hit is not None:
                    return hit
        elif isinstance(node, list):
            for v in node:
                hit = _walk(v)
                if hit is not None:
                    return hit
        elif isinstance(node, str):
            for pat in _PII_PATTERNS:
                m = pat.search(node)
                if m:
                    return m.group(0)
        return None

    return _walk(payload)


# ── aggregation ──────────────────────────────────────────────────────────


def _within_window(dt: Any, start: datetime, end: datetime) -> bool:
    if not isinstance(dt, datetime):
        return False
    aware = dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    return start <= aware < end


def _resolve_org_groups(db: Any, org_id: str) -> set[str]:
    """Return the set of group ids attached to `org_id`."""
    out: set[str] = set()
    for snap in db.collection("groups").where("orgId", "==", org_id).stream():
        out.add(snap.id)
    return out


def _ref_in_groups(target_ref: str, group_ids: set[str]) -> bool:
    parts = [p for p in (target_ref or "").strip("/").split("/") if p]
    if len(parts) >= 2 and parts[0] == "groups" and parts[1] in group_ids:
        return True
    return False


def generate_report(
    db: Any,
    *,
    period: str,
    start: datetime,
    end: datetime,
    scope: str = "platform",
) -> dict[str, Any]:
    """Aggregate the prior period into a bucketed-counts payload.

    `scope == "platform"` aggregates everything; `scope == "<orgId>"`
    filters by groups attached to that org.
    """
    org_groups: set[str] | None = None
    if scope != "platform":
        org_groups = _resolve_org_groups(db, scope)

    payload: dict[str, Any] = {
        "reports": {"received": 0, "byCategory": {}},
        "moderationActions": {
            "contentHidden": 0,
            "contentRestored": 0,
            "accountsBanned": 0,
            "accountsUnbanned": 0,
            "groupsArchived": 0,
            "groupsUnarchived": 0,
        },
        "appeals": {
            "submitted": 0,
            "upheld": 0,
            "reversed": 0,
            "pending": 0,
        },
        "ncmec": {"submitted": 0, "withdrawn": 0, "failed": 0},
        "accountActions": {
            "deletionRequested": 0,
            "deletionCancelled": 0,
            "exportRequested": 0,
            "exportCompleted": 0,
        },
    }

    # ── reports (moderation_queue) ──
    for snap in db.collection("moderation_queue").stream():
        data = snap.to_dict() or {}
        if not _within_window(data.get("createdAt"), start, end):
            continue
        if org_groups is not None and data.get("groupId") not in org_groups:
            continue
        payload["reports"]["received"] += 1
        cat = str(data.get("reason") or "other")
        payload["reports"]["byCategory"][cat] = payload["reports"]["byCategory"].get(cat, 0) + 1

    # ── audit-log driven counters ──
    audit_to_bucket: dict[str, tuple[str, str]] = {
        "moderation_approved": ("moderationActions", "contentHidden"),
        "moderation_rejected": ("moderationActions", "contentRestored"),
        "ban_user": ("moderationActions", "accountsBanned"),
        "unban_user": ("moderationActions", "accountsUnbanned"),
        "archive_group": ("moderationActions", "groupsArchived"),
        "unarchive_group": ("moderationActions", "groupsUnarchived"),
        "ncmec_submit": ("ncmec", "submitted"),
        "ncmec_withdraw": ("ncmec", "withdrawn"),
        "appeal_submit": ("appeals", "submitted"),
        "account_delete_requested": ("accountActions", "deletionRequested"),
        "account_delete_cancelled": ("accountActions", "deletionCancelled"),
        "export_request": ("accountActions", "exportRequested"),
        "export_completed": ("accountActions", "exportCompleted"),
    }

    for snap in db.collection("audit_log").stream():
        data = snap.to_dict() or {}
        if not _within_window(data.get("createdAt"), start, end):
            continue
        action = data.get("action")
        bucket = audit_to_bucket.get(str(action))
        if bucket is None:
            continue
        if org_groups is not None and not _ref_in_groups(
            str(data.get("targetRef") or ""), org_groups
        ):
            continue
        payload[bucket[0]][bucket[1]] += 1

    # ── appeals decision counters (read appeals collection directly,
    #    not the audit log, to capture the *outcome* split) ──
    for snap in db.collection("appeals").stream():
        data = snap.to_dict() or {}
        if not _within_window(data.get("submittedAt"), start, end):
            continue
        subject_ref = (data.get("subject") or {}).get("ref") or ""
        if org_groups is not None and not _ref_in_groups(str(subject_ref), org_groups):
            continue
        decision = data.get("decision")
        if decision == "upheld":
            payload["appeals"]["upheld"] += 1
        elif decision == "reversed":
            payload["appeals"]["reversed"] += 1
        elif decision == "pending":
            payload["appeals"]["pending"] += 1

    # ── ncmec failures ──
    for snap in db.collection("ncmec_cases").stream():
        data = snap.to_dict() or {}
        if not _within_window(data.get("matchedAt"), start, end):
            continue
        if data.get("status") == "failed":
            payload["ncmec"]["failed"] += 1

    return payload


def write_draft(
    db: Any,
    *,
    period: str,
    scope: str,
    payload: dict[str, Any],
    now: datetime | None = None,
) -> str:
    """Persist a draft report. Returns the new `reportId`."""
    leak = payload_contains_pii(payload)
    if leak is not None:
        raise ValueError(f"transparency payload would leak identifier: {leak!r}")
    report_id = str(uuid.uuid4())
    db.collection("transparency_reports").document(report_id).set(
        {
            "period": period,
            "scope": scope,
            "payload": payload,
            "generatedAt": now or datetime.now(UTC),
            "publishedAt": None,
            "schemaVersion": 1,
        }
    )
    logger.info(
        "transparency_draft period=%s scope=%s report=%s",
        period,
        scope,
        report_id,
    )
    return report_id


def publish(
    db: Any,
    *,
    report_id: str,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Mark a draft as published. Returns `(ok, reason)`."""
    ref = db.collection("transparency_reports").document(report_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found"
    data = snap.to_dict() or {}
    if data.get("publishedAt") is not None:
        return False, "already_published"
    leak = payload_contains_pii(data.get("payload") or {})
    if leak is not None:
        return False, f"pii_leak:{leak[:32]}"
    ref.update({"publishedAt": now or datetime.now(UTC)})
    return True, None


def latest_published(
    db: Any,
    *,
    scope: str = "platform",
) -> dict[str, Any] | None:
    """Return the most recently published report for `scope`."""
    best: tuple[datetime, dict[str, Any]] | None = None
    for snap in db.collection("transparency_reports").where("scope", "==", scope).stream():
        data = snap.to_dict() or {}
        published = data.get("publishedAt")
        if not isinstance(published, datetime):
            continue
        published_aware = published if published.tzinfo else published.replace(tzinfo=UTC)
        if best is None or published_aware > best[0]:
            data["reportId"] = snap.id
            best = (published_aware, data)
    return best[1] if best else None


def list_reports(
    db: Any,
    *,
    scope: str = "platform",
    published_only: bool = True,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for snap in db.collection("transparency_reports").where("scope", "==", scope).stream():
        data = snap.to_dict() or {}
        if published_only and data.get("publishedAt") is None:
            continue
        data["reportId"] = snap.id
        out.append(data)
    _epoch = datetime.min.replace(tzinfo=UTC)
    out.sort(
        key=lambda r: r.get("publishedAt") or r.get("generatedAt") or _epoch,
        reverse=True,
    )
    return out


# ── audit-log CSV export ─────────────────────────────────────────────────


def stream_audit_csv(
    db: Any,
    *,
    start: datetime,
    end: datetime,
) -> str:
    """Return CSV (RFC 4180) of audit log rows in `[start, end)`.

    Columns: createdAt, action, actorUid, targetRef. We deliberately
    exclude `payload` because it sometimes contains free-text reasoning
    (appeals, NCMEC withdrawals) that would expand the privacy
    surface — operators inspecting payloads should query Firestore
    directly with their own access controls.
    """
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf, dialect="excel")
    writer.writerow(["createdAt", "action", "actorUid", "targetRef"])

    rows: list[tuple[Any, str, str, str]] = []
    for snap in db.collection("audit_log").stream():
        data = snap.to_dict() or {}
        ts = data.get("createdAt")
        if not _within_window(ts, start, end):
            continue
        rows.append(
            (
                ts,
                str(data.get("action") or ""),
                str(data.get("actorUid") or ""),
                str(data.get("targetRef") or ""),
            )
        )
    _epoch = datetime.min.replace(tzinfo=UTC)
    rows.sort(key=lambda r: r[0] if isinstance(r[0], datetime) else _epoch)
    for ts, action, actor, target in rows:
        ts_iso = ts.isoformat() if isinstance(ts, datetime) else ""
        writer.writerow([ts_iso, action, actor, target])
    return buf.getvalue()


def _ensure_aware(dt: datetime) -> datetime:
    """For tests + callers — make naive datetimes UTC-aware."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _firestore_timestamp_now() -> Any:
    return fb_firestore.SERVER_TIMESTAMP
