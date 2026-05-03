"""Weekly email digest assembly (T35).

Reads the user's group list, queries BigQuery for trailing-7-day stats,
fetches today's Bible verse from Firestore, and returns a DigestPayload.

When `JACOB_DIGEST_ENABLED=false` (default), assembly raises
`DigestDisabledError` so the job exits cleanly without BigQuery calls.

BigQuery views used (T29):
  - `{dataset}.top_stickers_by_group` (columns: gid, sticker_slug, use_count)
  - `{dataset}.new_members_by_group` (columns: gid, count)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


class DigestDisabledError(Exception):
    pass


@dataclass
class StickerUsage:
    slug: str
    count: int


@dataclass
class GroupSummary:
    gid: str
    name: str
    new_members: int
    top_stickers: list[StickerUsage]


@dataclass
class DigestPayload:
    uid: str
    display_name: str
    email: str
    top_stickers: list[StickerUsage]
    missed_replies: int
    new_members: int
    today_verse: dict[str, str] | None
    groups: list[GroupSummary]
    quiet_week: bool


def assemble_user_payload(
    uid: str,
    *,
    db: Any,
    bq_client: Any | None,
    dataset: str,
    now: datetime | None = None,
) -> DigestPayload:
    """Build a DigestPayload for one user. Raises DigestDisabledError if analytics unavailable."""
    if os.environ.get("JACOB_DIGEST_ENABLED", "false").lower() not in {"1", "true", "yes"}:
        raise DigestDisabledError("digest disabled (JACOB_DIGEST_ENABLED not set)")

    now = now or datetime.now(UTC)
    week_ago = now - timedelta(days=7)

    # Resolve display name + email from Firestore.
    user_snap = db.collection("users").document(uid).get()
    user_data = user_snap.to_dict() or {}
    display_name: str = user_data.get("displayName", "Friend")
    private_snap = (
        db.collection("users").document(uid).collection("private").document("profile").get()
    )
    email: str = (private_snap.to_dict() or {}).get("email", "")

    # Load group memberships via sub-collection query (authoritative path).
    gids: list[str] = []
    for snap in db.collection("groups").stream():
        member = db.collection("groups").document(snap.id).collection("members").document(uid).get()
        if member.exists:
            g = snap.to_dict() or {}
            archived_at = g.get("archivedAt")
            if archived_at:
                cutoff = now - timedelta(days=60)
                if hasattr(archived_at, "datetime") and archived_at.datetime < cutoff:
                    continue
            gids.append(snap.id)

    groups: list[GroupSummary] = []
    total_new_members = 0
    all_stickers: dict[str, int] = {}

    for gid in gids:
        g_snap = db.collection("groups").document(gid).get()
        g_data = g_snap.to_dict() or {}
        group_name: str = g_data.get("name", gid)

        new_members = 0
        top_stickers: list[StickerUsage] = []

        if bq_client is not None:
            try:
                nm_rows = bq_client.query(
                    f"SELECT count FROM `{dataset}.new_members_by_group` WHERE gid = @gid",
                    job_config=_params({"gid": gid}),
                ).result()
                for row in nm_rows:
                    new_members = int(row["count"])
                    break

                sticker_rows = bq_client.query(
                    f"""
                    SELECT sticker_slug, use_count
                    FROM `{dataset}.top_stickers_by_group`
                    WHERE gid = @gid
                    ORDER BY use_count DESC LIMIT 3
                    """,
                    job_config=_params({"gid": gid}),
                ).result()
                for row in sticker_rows:
                    s = StickerUsage(slug=str(row["sticker_slug"]), count=int(row["use_count"]))
                    top_stickers.append(s)
                    all_stickers[s.slug] = all_stickers.get(s.slug, 0) + s.count
            except Exception:  # noqa: BLE001
                logger.exception("digest_bq_query_failed gid=%s", gid)

        total_new_members += new_members
        groups.append(
            GroupSummary(
                gid=gid, name=group_name, new_members=new_members, top_stickers=top_stickers
            )
        )

    # Cross-group top 3 stickers.
    cross_top = sorted(all_stickers.items(), key=lambda x: x[1], reverse=True)[:3]
    top_stickers_global = [StickerUsage(slug=s, count=c) for s, c in cross_top]

    # Missed replies — messages in threads the user participated in, created in last 7 days.
    missed_replies = 0
    for gid in gids:
        msgs = (
            db.collection("groups")
            .document(gid)
            .collection("messages")
            .where("participants", "array_contains", uid)
            .stream()
        )
        for msg in msgs:
            m = msg.to_dict() or {}
            created_at = m.get("createdAt")
            if created_at and hasattr(created_at, "datetime") and created_at.datetime > week_ago:
                if m.get("authorUid") != uid:
                    missed_replies += 1

    # Today's verse.
    today_str = now.strftime("%Y-%m-%d")
    verse_snap = db.collection("daily_verse").document(today_str).get()
    today_verse: dict[str, str] | None = None
    if verse_snap.exists:
        v = verse_snap.to_dict() or {}
        today_verse = {
            "reference": str(v.get("reference", "")),
            "text": str(v.get("text", "")),
            "translation": str(v.get("translation", "WEB")),
        }

    quiet_week = not any(g.top_stickers or g.new_members for g in groups) and missed_replies == 0

    return DigestPayload(
        uid=uid,
        display_name=display_name,
        email=email,
        top_stickers=top_stickers_global,
        missed_replies=missed_replies,
        new_members=total_new_members,
        today_verse=today_verse,
        groups=groups,
        quiet_week=quiet_week,
    )


def _params(params: dict[str, str]) -> Any:
    """Build a BigQuery QueryJobConfig with scalar STRING parameters."""
    try:
        from google.cloud import bigquery

        cfg = bigquery.QueryJobConfig()
        cfg.query_parameters = [
            bigquery.ScalarQueryParameter(k, "STRING", v) for k, v in params.items()
        ]
        return cfg
    except ImportError:
        return None
