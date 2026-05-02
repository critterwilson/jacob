"""Reports router: users flag content for moderator review.

POST /api/reports — authenticated, rate-limited via REPORT_SUBMIT.
The report is written to moderation_queue/{reportId} with status "pending".

Banned users (active row in `bans/{uid}` whose `expiresAt > now`) are
rejected with 403. Anonymous callers get 401 from `get_current_user`.
Dedup: identical (reporterUid, resourceRef, reason) within 24h returns
the existing report id with `dedup=True`.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user
from app.errors import APIError
from app.limits import REPORT_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.report import SubmitReportRequest, SubmitReportResponse
from app.models.user import CurrentUser
from app.services.firebase import init_firebase_admin
from app.services.reports import submit_report

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["reports"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _reject_if_banned(db: Any, uid: str) -> None:
    snap = db.collection("bans").document(uid).get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    expires = data.get("expiresAt")
    if expires is None:
        return
    if isinstance(expires, datetime):
        active = expires > datetime.now(UTC)
    else:
        active = True
    if active:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="banned",
            message="Banned users cannot submit reports",
        )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SubmitReportResponse)
@limiter.limit(REPORT_SUBMIT)
def post_report(
    request: Request,
    response: Response,
    body: SubmitReportRequest,
    user: CurrentUser = Depends(get_current_user),
) -> SubmitReportResponse:
    db = _db()
    _reject_if_banned(db, user.uid)

    result = submit_report(
        reporter_uid=user.uid,
        resource_type=body.resourceType,
        resource_id=body.resourceId,
        group_id=body.groupId,
        reason=body.reason,
        context=body.context,
        db=db,
    )
    return SubmitReportResponse(
        reportId=result.report_id, dedup=result.dedup, severity=result.severity
    )
