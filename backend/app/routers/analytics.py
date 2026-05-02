"""Analytics router — T29: Sticker analytics for group leaders."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.limits import ANALYTICS_QUERY
from app.middleware.rate_limit import limiter
from app.models.analytics import AnalyticsResponse, ContributorItem
from app.models.user import CurrentUser
from app.services.analytics import query_analytics
from app.services.firebase import init_firebase_admin

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

    result = result.model_copy(update={"topContributors": resolved})

    logger.info(
        "analytics_served uid=%s gid=%s range=%s total=%d",
        user.uid,
        gid,
        range,
        result.totalMessages,
    )
    return result
