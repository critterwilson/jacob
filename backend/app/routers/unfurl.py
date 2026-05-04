"""Unfurl router (T53).

`POST /api/unfurl` — signed-in callers; returns OG metadata for the
supplied URL. SSRF-guarded by `services/safe_fetch.py`. Cached for 24
hours at `unfurl_cache/{urlHash}`.

The Cloud Function trigger that persists `unfurls` onto the message
doc is a separate path that calls the service module directly without
HTTP — it's a follow-up. v1 ships the on-demand client-side surface.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from firebase_admin import firestore as fb_firestore

from app.deps import require_not_banned
from app.limits import UNFURL_FETCH
from app.middleware.rate_limit import limiter
from app.models.unfurl import UnfurlRequest, UnfurlResponse
from app.models.user import CurrentUser
from app.services import unfurl as unfurl_service
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["unfurl"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


@router.post("/api/unfurl", response_model=UnfurlResponse)
@limiter.limit(UNFURL_FETCH)
def unfurl_url(
    request: Request,
    response: Response,
    body: UnfurlRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> UnfurlResponse:
    db = _db()
    url = str(body.url)
    metadata = unfurl_service.unfurl(url, db=db)
    return UnfurlResponse(
        url=url,
        title=metadata.get("title"),
        description=metadata.get("description"),
        imageUrl=metadata.get("imageUrl"),
        siteName=metadata.get("siteName"),
    )
