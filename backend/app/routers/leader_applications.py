"""Leader-application router (ADR 0015).

A non-owner who wants to lead a group submits one of these via
`POST /api/leader-applications`; the ministry owner reviews and decides
via the admin router. The applicant can poll their own pending
application via `GET /api/leader-applications/me`.

Owner-facing list/approve/reject endpoints live in `app/routers/admin.py`
next to the existing admin surfaces — same pattern as ADR 0012's
applications router.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import LEADER_APPLICATION_POLL, LEADER_APPLICATION_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.leader_applications import (
    LeaderApplicationListResponse,
    LeaderApplicationView,
    SubmitLeaderApplicationRequest,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import get_firestore
from app.services.leader_applications import leader_application_doc_to_view

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/leader-applications", tags=["leader-applications"])


@router.post(
    "",
    response_model=LeaderApplicationView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(LEADER_APPLICATION_SUBMIT)
def submit_leader_application(
    request: Request,
    response: Response,
    body: SubmitLeaderApplicationRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> LeaderApplicationView:
    """Create a pending leader application for the caller.

    Refuses if the caller already has a pending application — one open
    request at a time, mirroring the join-request idempotency pattern.
    A decided application (approved/rejected) does not block re-submit;
    the applicant can iterate after a rejection.

    The applicant's `users/{uid}` doc must exist (they must have
    completed onboarding). This is the trust gate: without a profile
    there's no audit anchor for the application.
    """
    db = get_firestore()
    user_snap = db.collection("users").document(user.uid).get()
    if not getattr(user_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="profile_required",
            message="Complete onboarding before applying to lead a group",
        )
    user_data = user_snap.to_dict() or {}

    # One pending application per user.
    existing = list(
        db.collection("leader_applications")
        .where("applicantUid", "==", user.uid)
        .where("status", "==", "pending")
        .limit(1)
        .stream()
    )
    if existing:
        existing_snap = existing[0]
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="application_pending",
            message="You already have a pending leader application",
            details={"appId": existing_snap.id},
        )

    app_id = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "applicantUid": user.uid,
        "applicantDisplayName": str(user_data.get("displayName") or ""),
        "applicantEmail": user_data.get("email"),
        "proposedGroupName": body.proposedGroupName.strip(),
        "proposedGroupDescription": body.proposedGroupDescription.strip(),
        "proposedAudience": body.proposedAudience,
        "motivation": body.motivation,
        "status": "pending",
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "decidedAt": None,
        "decidedBy": None,
        "decisionNotes": "",
        "createdGroupId": None,
    }
    db.collection("leader_applications").document(app_id).set(payload)

    write_audit_log(
        actor_uid=user.uid,
        action="leader_application.submit",
        target_ref=f"leader_applications/{app_id}",
        payload={
            "proposedAudience": body.proposedAudience,
            "proposedGroupNameLength": len(body.proposedGroupName),
        },
    )

    fresh = db.collection("leader_applications").document(app_id).get()
    return leader_application_doc_to_view(app_id, fresh.to_dict() or {})


@router.get("/me", response_model=LeaderApplicationListResponse)
@limiter.limit(LEADER_APPLICATION_POLL)
def list_my_leader_applications(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> LeaderApplicationListResponse:
    """Return the caller's leader applications, most recent first.

    The frontend uses this to render the "your application is pending"
    banner on `/home` and the "your previous application was decided"
    section on the leader-application page.
    """
    db = get_firestore()
    snaps = list(
        db.collection("leader_applications")
        .where("applicantUid", "==", user.uid)
        .order_by("createdAt", direction=gcf.Query.DESCENDING)
        .limit(20)
        .stream()
    )
    items = [leader_application_doc_to_view(s.id, s.to_dict() or {}) for s in snaps]
    return LeaderApplicationListResponse(items=items)


__all__ = ["router"]
