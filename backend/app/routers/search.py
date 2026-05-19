"""T28 — full-text message search proxy.

`GET /api/search?q=...&page=...&limit=...`

Authorization model (see ADR 0005):
  1. Caller is signed in.
  2. Backend enumerates the caller's group memberships via the
     `members` collection-group query (ADR 0003).
  3. Typesense query is constrained with `filter_by: groupId:[...]
     && moderationState:!=hidden` so cross-group leakage is impossible
     even if the index is stale.

Feature flag `JACOB_SEARCH_ENABLED` short-circuits the endpoint with
`503 search_disabled` until the index is warm.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.limits import SEARCH_QUERY
from app.middleware.rate_limit import limiter
from app.models.search import SearchResponse
from app.models.user import CurrentUser
from app.services.firebase import init_firebase_admin
from app.services.search import (
    SearchUnavailableError,
    enumerate_memberships,
    get_client,
    normalise,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/search", tags=["search"])

_MAX_QUERY_LEN = 200
_MIN_LIMIT = 1
_MAX_LIMIT = 50
_DEFAULT_LIMIT = 20


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


@router.get("", response_model=SearchResponse)
@limiter.limit(SEARCH_QUERY)
def search_messages(
    request: Request,
    response: Response,
    q: str = Query(default="", max_length=_MAX_QUERY_LEN),
    page: int = Query(default=1, ge=1, le=200),
    limit: int = Query(default=_DEFAULT_LIMIT, ge=_MIN_LIMIT, le=_MAX_LIMIT),
    user: CurrentUser = Depends(get_current_user),
) -> SearchResponse:
    settings = get_settings()
    if not settings.jacob_search_enabled:
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="search_disabled",
            message="Search is currently disabled.",
        )

    trimmed = q.strip()
    if not trimmed:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_query",
            message="Search query must be non-empty.",
        )

    db = _db()
    gids = enumerate_memberships(db, user.uid, cap=settings.typesense_membership_cap)

    if not gids:
        return SearchResponse(hits=[], total=0, page=page, limit=limit)

    client = get_client()
    try:
        raw = client.search(q=trimmed, gids=gids, page=page, per_page=limit)
    except SearchUnavailableError as err:
        logger.warning("search_unavailable uid=%s err=%s", user.uid, err)
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="search_unavailable",
            message="Search is temporarily unavailable.",
        ) from err

    return normalise(raw, page=page, per_page=limit)
