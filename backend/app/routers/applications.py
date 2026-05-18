"""Applications router — admin-approval signup flow (ADR 0012).

Owns the applicant side of the signup queue:

  * `POST /api/applications/me` — create or replace the caller's
    pending application after they have verified their email. The
    server computes `isMinor` from the supplied DOB; under-13 is
    refused outright (the auth user is left in place — the frontend
    deletes it as part of the under-13 path, same as today).
  * `GET /api/applications/me` — return the caller's current
    application status, used by the `/awaiting-approval` poll.

Admin-side endpoints (`list`, `approve`, `reject`) live in
`backend/app/routers/admin.py` next to the existing admin surfaces.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import APPLICATION_POLL, APPLICATION_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.applications import ApplicationView, SubmitApplicationRequest
from app.models.user import CurrentUser
from app.services.applications import (
    MIN_AGE,
    application_doc_to_view,
    compute_age,
    is_minor,
)
from app.services.audit import write_audit_log
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.post("/me", response_model=ApplicationView, status_code=status.HTTP_201_CREATED)
@limiter.limit(APPLICATION_SUBMIT)
def submit_application(
    request: Request,
    response: Response,
    body: SubmitApplicationRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> ApplicationView:
    """Create or replace the caller's application.

    Refuses the call if:
      * the applicant is banned (`require_not_banned`),
      * the applicant is under 13 (`under_minimum_age`),
      * the caller already has an *approved* user doc (`already_approved`).

    The email-verified gate lives on the frontend (the `/verify-email`
    page polls Firebase Auth and routes to `/onboarding` only after the
    `emailVerified` flag flips). Mirroring the existing `POST /api/users/me`
    convention which also trusts the frontend gate here — the backend
    won't see an application submission unless the frontend let the
    user reach the onboarding form, and a determined caller who skips
    the gate would still hit the admin-approval queue before getting
    `users/{uid}` access.

    The endpoint is idempotent across re-submits while the application
    is still `pending`: each call overwrites the prior submission and
    refreshes `submittedAt`. Once decided (approved or rejected) the
    application is immutable from the applicant side.
    """
    age = compute_age(body.dob)
    if age < MIN_AGE:
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="under_minimum_age",
            message="JACOB requires you to be at least 13",
            details={"minimumAge": MIN_AGE},
        )

    db = get_firestore()

    # An approved user is already a member; they shouldn't be hitting
    # this endpoint. Refuse so a buggy client can't accidentally rewind
    # an existing account into a pending state.
    user_snap = db.collection("users").document(user.uid).get()
    if getattr(user_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_approved",
            message="Your account is already active",
        )

    app_ref = db.collection("applications").document(user.uid)
    existing_snap = app_ref.get()
    existing = existing_snap.to_dict() or {} if getattr(existing_snap, "exists", False) else {}
    existing_status = str(existing.get("status") or "")

    if existing_status in ("approved", "rejected"):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="application_decided",
            message="Your application has already been decided",
            details={"status": existing_status},
        )

    minor_flag = is_minor(body.dob)
    payload: dict[str, Any] = {
        "email": user.email,
        "displayName": body.displayName,
        "photoURL": str(body.photoURL) if body.photoURL is not None else None,
        "dob": body.dob.isoformat(),
        "isMinor": minor_flag,
        "phone": body.phone or None,
        "location": body.location or None,
        "faithBackground": body.faithBackground or None,
        "status": "pending",
        "submittedAt": fb_firestore.SERVER_TIMESTAMP,
        # On first submit we also stamp createdAt; on resubmit we leave it.
        "createdAt": existing.get("createdAt") or fb_firestore.SERVER_TIMESTAMP,
        # Decision fields are reset on each submit while pending.
        "decidedAt": None,
        "decidedBy": None,
        "parentalConsentObtained": None,
        "parentalConsentNotes": "",
        "rejectionReason": "",
    }
    app_ref.set(payload)

    write_audit_log(
        actor_uid=user.uid,
        action="application.submit",
        target_ref=f"applications/{user.uid}",
        payload={"isMinor": minor_flag, "resubmit": bool(existing)},
    )

    fresh = app_ref.get()
    return application_doc_to_view(user.uid, fresh.to_dict() or {})


@router.get("/me", response_model=ApplicationView)
@limiter.limit(APPLICATION_POLL)
def get_my_application(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ApplicationView:
    """Return the caller's current application, or 404 if none exists.

    Called by `/awaiting-approval` to poll for an admin decision. A
    404 is the load-bearing signal to the frontend that the user
    hasn't submitted the application form yet.
    """
    db = get_firestore()
    snap = db.collection("applications").document(user.uid).get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="application_not_found",
            message="No application on file",
        )
    return application_doc_to_view(user.uid, snap.to_dict() or {})


__all__ = ["router"]
