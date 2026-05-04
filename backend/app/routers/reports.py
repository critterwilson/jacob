"""Reports router: users flag content for moderator review.

POST /api/reports — authenticated, rate-limited via REPORT_SUBMIT.
The report is written to moderation_queue/{reportId} with status "pending".

Banned users (active row in `bans/{uid}` whose `expiresAt > now`) are
rejected with 403 by `require_not_banned`. Anonymous callers get 401
from `get_current_user`. Dedup: identical (reporterUid, resourceRef,
reason) within 24h returns the existing report id with `dedup=True`.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import require_not_banned
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


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SubmitReportResponse)
@limiter.limit(REPORT_SUBMIT)
def post_report(
    request: Request,
    response: Response,
    body: SubmitReportRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> SubmitReportResponse:
    db = _db()

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
