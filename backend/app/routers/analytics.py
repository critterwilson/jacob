"""Analytics router — T29: Sticker analytics for group leaders."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.limits import ANALYTICS_QUERY
from app.middleware.rate_limit import limiter
from app.models.analytics import (
    AnalyticsResponse,
    ContributorItem,
    EventAttendancePoint,
    OrgAnalyticsGroupSlice,
    OrgAnalyticsResponse,
    SentimentPoint,
)
from app.models.user import CurrentUser
from app.services import group_health
from app.services.analytics import query_analytics
from app.services.firebase import init_firebase_admin
from app.services.orgs import is_org_admin, org_exists

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups", tags=["analytics"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _require_leader_or_admin(db: Any, gid: str, user: CurrentUser) -> None:
    """Raise 403 unless user is a platform admin or a leader of gid."""
    if user.claims.get("admin") is True:
        return
    member_snap = (
        db.collection("groups").document(gid).collection("members").document(user.uid).get()
    )
    if not member_snap.exists or (member_snap.to_dict() or {}).get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Only group leaders may view analytics",
        )


@router.get("/{gid}/analytics", response_model=AnalyticsResponse)
@limiter.limit(ANALYTICS_QUERY)
def get_analytics(
    gid: str,
    request: Request,
    response: Response,
    range: Annotated[Literal["7d", "30d"], Query()] = "7d",
    user: CurrentUser = Depends(get_current_user),
) -> AnalyticsResponse:
    settings = get_settings()

    if not settings.jacob_analytics_enabled:
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="analytics_disabled",
            message="Analytics is not enabled on this instance",
        )

    db = _db()

    group_snap = db.collection("groups").document(gid).get()
    if not group_snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message="Group not found",
        )

    _require_leader_or_admin(db, gid, user)

    try:
        result = query_analytics(
            gid=gid,
            range_str=range,
            dataset=settings.bq_analytics_dataset,
            bq_project=settings.bq_project or None,
        )
    except ImportError:
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="not_yet_loaded",
            message="Analytics backend is not configured",
        )
    except Exception as exc:
        logger.exception("analytics_query_failed gid=%s range=%s error=%s", gid, range, exc)
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="not_yet_loaded",
            message="Analytics data is not available yet",
        )

    # Resolve displayNames for top contributors (≤ 5 reads).
    resolved: list[ContributorItem] = []
    for contrib in result.topContributors:
        user_snap = db.collection("users").document(contrib.uid).get()
        display_name = ""
        if user_snap.exists:
            display_name = (user_snap.to_dict() or {}).get("displayName", "") or ""
        resolved.append(contrib.model_copy(update={"displayName": display_name}))

    # T60 — supplement BigQuery output with Firestore-derivable fields.
    # These remain populated even on instances where BigQuery isn't
    # configured because the dashboard surface is the load-bearing
    # piece (the BigQuery numbers are best-effort).
    event_rows = group_health.event_attendance(db, gid=gid)
    sentiment_rows = group_health.sentiment_trend(db, gid=gid)

    result = result.model_copy(
        update={
            "topContributors": resolved,
            "eventAttendance": [EventAttendancePoint(**row) for row in event_rows],
            "sentimentTrend": [SentimentPoint(**row) for row in sentiment_rows],
        }
    )

    logger.info(
        "analytics_served uid=%s gid=%s range=%s total=%d",
        user.uid,
        gid,
        range,
        result.totalMessages,
    )
    return result


# T60 — org-aggregated dashboard. Consumes the per-group helpers from
# `services/group_health.py`; admin authorization is enforced inline
# (we don't rely on the existing `_require_leader_or_admin` because
# that's per-group and an org admin needn't be a group leader).


def _require_org_admin(db: Any, org_id: str, user: CurrentUser) -> None:
    if user.claims.get("admin") is True:
        return
    if not org_exists(db, org_id):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="org_not_found",
            message="Org not found",
        )
    if not is_org_admin(db, org_id, user.uid):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Org admin privileges required",
        )


org_router = APIRouter(prefix="/api/orgs", tags=["analytics"])


@org_router.get("/{org_id}/analytics", response_model=OrgAnalyticsResponse)
@limiter.limit(ANALYTICS_QUERY)
def get_org_analytics(
    org_id: str,
    request: Request,
    response: Response,
    range: Annotated[Literal["7d", "30d"], Query()] = "30d",
    user: CurrentUser = Depends(get_current_user),
) -> OrgAnalyticsResponse:
    db = _db()
    _require_org_admin(db, org_id, user)
    days = 7 if range == "7d" else 30
    payload = group_health.org_aggregate(db, org_id=org_id, days=days)
    now_iso = datetime.now(UTC).isoformat()
    return OrgAnalyticsResponse(
        orgId=org_id,
        range=range,
        groupCount=payload["groupCount"],
        activeMembers=payload["activeMembers"],
        totalMessages=payload["totalMessages"],
        eventAttendance=[EventAttendancePoint(**row) for row in payload["eventAttendance"]],
        sentimentTrend=[SentimentPoint(**row) for row in payload["sentimentTrend"]],
        groups=[OrgAnalyticsGroupSlice(**g) for g in payload["groups"]],
        generatedAt=now_iso,
    )
