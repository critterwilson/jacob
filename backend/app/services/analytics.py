"""BigQuery analytics service for T29 sticker analytics.

Results are cached per (gid, range) for 1 hour to avoid re-running
identical queries within the same Cloud Run instance.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import Settings
from app.models.analytics import (
    AnalyticsResponse,
    CadencePoint,
    ContributorItem,
    StickerMixItem,
)

logger = logging.getLogger(__name__)

# Maximum bytes BigQuery may scan per query (10 GiB safety net).
_MAX_BYTES_BILLED: int = 10 * 1024**3
_CACHE_TTL_SECONDS: int = 3600  # 1 hour

# Simple in-process TTL cache: { key -> (result, expires_at) }
_cache: dict[str, tuple[AnalyticsResponse, float]] = {}


def _get_bq_client() -> Any:
    """Lazy-init BigQuery client; raises ImportError if library absent."""
    try:
        from google.cloud import bigquery
    except ImportError as exc:
        raise ImportError(
            "google-cloud-bigquery is required for analytics. "
            "Add it to pyproject.toml dependencies."
        ) from exc

    settings = Settings()
    project = settings.bq_project or settings.google_cloud_project or None
    return bigquery.Client(project=project)


def _job_config() -> Any:
    from google.cloud import bigquery

    cfg = bigquery.QueryJobConfig()
    cfg.maximum_bytes_billed = _MAX_BYTES_BILLED
    return cfg


def _range_days(range_str: str) -> int:
    return 7 if range_str == "7d" else 30


def query_analytics(
    gid: str,
    range_str: str,
    dataset: str,
    bq_project: str | None,
) -> AnalyticsResponse:
    """Return analytics for a group, using an in-process TTL cache."""
    cache_key = f"{gid}:{range_str}"
    now = time.monotonic()

    cached, expires_at = _cache.get(cache_key, (None, 0.0))
    if cached is not None and now < expires_at:
        logger.info("analytics_cache_hit gid=%s range=%s", gid, range_str)
        return cached

    result = _run_queries(gid, range_str, dataset, bq_project)
    _cache[cache_key] = (result, now + _CACHE_TTL_SECONDS)
    return result


def _run_queries(
    gid: str,
    range_str: str,
    dataset: str,
    bq_project: str | None,
) -> AnalyticsResponse:
    client = _get_bq_client()
    project = bq_project or Settings().google_cloud_project
    if not project:
        raise ValueError("BQ_PROJECT or GOOGLE_CLOUD_PROJECT must be set")

    days = _range_days(range_str)
    date_from = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()
    fq = f"`{project}.{dataset}`"
    cfg = _job_config()

    # ── cadence (messages_daily) ──────────────────────────────────────────
    cadence_sql = f"""
        SELECT day, count
        FROM {fq}.messages_daily
        WHERE groupId = @gid AND day >= @dateFrom
        ORDER BY day ASC
    """
    cadence_params = [
        _param("gid", "STRING", gid),
        _param("dateFrom", "STRING", date_from),
    ]
    cadence_rows = _run(client, cadence_sql, cadence_params, cfg)
    total_messages = sum(int(r["count"]) for r in cadence_rows)
    cadence = [CadencePoint(day=str(r["day"]), count=int(r["count"])) for r in cadence_rows]

    # ── sticker mix (sticker_mix_weekly) ──────────────────────────────────
    mix_sql = f"""
        SELECT stickerSlug, SUM(count) AS count
        FROM {fq}.sticker_mix_weekly
        WHERE groupId = @gid AND weekStart >= @dateFrom
        GROUP BY stickerSlug
        ORDER BY count DESC
    """
    mix_rows = _run(client, mix_sql, cadence_params, cfg)
    total_stickers = sum(int(r["count"]) for r in mix_rows)
    sticker_mix: list[StickerMixItem] = []
    for r in mix_rows:
        cnt = int(r["count"])
        pct = round(cnt / total_stickers * 100, 1) if total_stickers else 0.0
        sticker_mix.append(StickerMixItem(slug=str(r["stickerSlug"]), count=cnt, percent=pct))
    # Fix floating-point rounding so percentages sum exactly to 100
    if sticker_mix:
        diff = round(100.0 - sum(s.percent for s in sticker_mix), 1)
        sticker_mix[0] = sticker_mix[0].model_copy(
            update={"percent": round(sticker_mix[0].percent + diff, 1)}
        )

    # ── top contributors (top_contributors_weekly) ────────────────────────
    contrib_sql = f"""
        SELECT authorUid, SUM(count) AS count
        FROM {fq}.top_contributors_weekly
        WHERE groupId = @gid AND weekStart >= @dateFrom
        GROUP BY authorUid
        ORDER BY count DESC
        LIMIT 5
    """
    contrib_rows = _run(client, contrib_sql, cadence_params, cfg)
    top_contributors = [
        ContributorItem(uid=str(r["authorUid"]), displayName="", count=int(r["count"]))
        for r in contrib_rows
    ]

    generated_at = datetime.now(UTC).isoformat()
    return AnalyticsResponse(
        gid=gid,
        range=range_str,  # type: ignore[arg-type]
        totalMessages=total_messages,
        stickerMix=sticker_mix,
        topContributors=top_contributors,
        cadenceByDay=cadence,
        generatedAt=generated_at,
    )


def _param(name: str, type_: str, value: Any) -> Any:
    from google.cloud.bigquery import ScalarQueryParameter

    return ScalarQueryParameter(name, type_, value)


def _run(client: Any, sql: str, params: list[Any], cfg: Any) -> list[dict[str, Any]]:
    cfg.query_parameters = params
    job = client.query(sql, job_config=cfg)
    return [dict(row) for row in job.result()]
