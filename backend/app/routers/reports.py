"""Reports router: users flag content for moderator review.

POST /api/reports  — authenticated, rate-limited to REPORT_SUBMIT per user.
The report is written to moderation_queue/{reportId} with status "pending".
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user
from app.limits import REPORT_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.report import SubmitReportRequest, SubmitReportResponse
from app.models.user import CurrentUser
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["reports"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SubmitReportResponse)
@limiter.limit(REPORT_SUBMIT)
def submit_report(
    request: Request,
    response: Response,
    body: SubmitReportRequest,
    user: CurrentUser = Depends(get_current_user),
) -> SubmitReportResponse:
    db = _db()
    report_id = str(uuid.uuid4())
    db.collection("moderation_queue").document(report_id).set(
        {
            "resourceRef": body.resourceRef,
            "reason": body.reason,
            "reportedBy": user.uid,
            "status": "pending",
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    logger.info("report_submitted report_id=%s uid=%s", report_id, user.uid)
    return SubmitReportResponse(reportId=report_id)
