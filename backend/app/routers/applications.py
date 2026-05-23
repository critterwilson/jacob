"""Applications router — legacy ADR 0012 admin-approval signup flow.

ADR 0014 supersedes this surface. `POST /api/applications/me` now
returns `410 Gone` unconditionally; new signups create their user
doc directly via `POST /api/users/me`. `GET /api/applications/me`
stays reachable as a read-only legacy surface so the frontend can
detect pre-migration pending applications and route their owner to
the legacy admin queue for manual decision. The admin list/approve/
reject endpoints remain in `routers/admin.py` for backward-compat
queue drainage.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response, status

from app.deps import get_current_user, require_not_banned
from app.errors import APIError
from app.limits import APPLICATION_POLL, APPLICATION_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.applications import ApplicationView, SubmitApplicationRequest
from app.models.user import CurrentUser
from app.services.applications import application_doc_to_view
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.post("/me", response_model=ApplicationView, status_code=status.HTTP_410_GONE)
@limiter.limit(APPLICATION_SUBMIT)
def submit_application(
    request: Request,
    response: Response,
    body: SubmitApplicationRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> ApplicationView:
    """**Deprecated by ADR 0014.** Always returns 410 Gone.

    The platform-wide admin-approval queue has been replaced by the
    delegated, group-based approval model. New signups complete
    onboarding via `POST /api/users/me` and request membership in
    individual groups via the existing join-request flow.
    """
    _ = body  # retained for OpenAPI schema parity with the legacy contract
    raise APIError(
        status_code=status.HTTP_410_GONE,
        code="application_flow_retired",
        message=(
            "The platform-wide application queue has been retired (ADR 0014). "
            "Complete onboarding via POST /api/users/me and request to join groups individually."
        ),
        details={"replacedBy": "/api/users/me"},
    )


@router.get("/me", response_model=ApplicationView)
@limiter.limit(APPLICATION_POLL)
def get_my_application(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> ApplicationView:
    """Read the caller's legacy application doc (ADR 0012 cleanup path).

    Returns 404 if no application exists — the expected response for
    every post-ADR-0014 user. Pre-migration pending applicants still
    have a doc here; the legacy admin queue at /admin/applications
    is where their decision is made.
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
