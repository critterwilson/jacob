"""Account router: deletion request, cancel, status (T14) + unsubscribe (T35).

The deletion lifecycle is intentionally split across three endpoints so
the client can drive a confirm → grace-period → cancel-or-finalize flow
without ever holding hard-delete authority itself. Finalization runs as
a daily Cloud Scheduler job (`infra/scheduled/finalize_deletions.py`),
not a request handler — see `services.deletion.finalize_account`.

T35 adds GET /api/unsubscribe?token=... for one-click RFC 8058 compliance.
The token is a short-lived JWT; no session is required.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import get_settings
from app.deps import get_current_user
from app.errors import APIError
from app.models.account import (
    CancelDeleteResponse,
    DeleteAccountRequest,
    DeleteAccountResponse,
    DeleteStatusResponse,
)
from app.models.user import CurrentUser
from app.services import deletion
from app.services import unsubscribe as unsub_svc
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/account", tags=["account"])

_WEB_TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "web"
_web_jinja = Environment(
    loader=FileSystemLoader(str(_WEB_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "j2"]),
)


@router.post("/delete", response_model=DeleteAccountResponse)
def request_delete(
    body: DeleteAccountRequest,
    user: CurrentUser = Depends(get_current_user),
) -> DeleteAccountResponse:
    try:
        result = deletion.request_deletion(user.uid, keep_body=body.keepBody)
    except LookupError:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="User document not found",
        ) from None

    return DeleteAccountResponse(
        deletionRequestedAt=result["deletionRequestedAt"],
        finalizeAt=result["finalizeAt"],
        keepBody=body.keepBody,
    )


@router.post("/delete/cancel", response_model=CancelDeleteResponse)
def cancel_delete(
    user: CurrentUser = Depends(get_current_user),
) -> CancelDeleteResponse:
    cancelled = deletion.cancel_deletion(user.uid)
    if not cancelled:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="not_pending",
            message="No active deletion request to cancel",
        )
    return CancelDeleteResponse(cancelled=True)


@router.get("/delete/status", response_model=DeleteStatusResponse)
def delete_status(
    user: CurrentUser = Depends(get_current_user),
) -> DeleteStatusResponse:
    info = deletion.get_deletion_status(user.uid)
    return DeleteStatusResponse(**info)


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(
    token: str = Query(..., description="JWT unsubscribe token from digest email"),
    request: Request = None,  # type: ignore[assignment]
) -> HTMLResponse:
    """One-click unsubscribe endpoint (RFC 8058). No auth required; token is the auth."""
    settings = get_settings()
    app_url = settings.app_url

    try:
        uid, kind = unsub_svc.verify_unsubscribe_token(token)
    except ValueError as exc:
        logger.warning("unsubscribe_invalid_token reason=%s", exc)
        html = _web_jinja.get_template("unsubscribe.html.j2").render(
            success=False,
            error_message=(
                "This unsubscribe link is invalid or has expired. "
                "Please use the link from your most recent digest email."
            ),
            app_url=app_url,
        )
        return HTMLResponse(content=html, status_code=400)

    db = get_firestore()
    prefs_ref = (
        db.collection("users").document(uid).collection("notificationPrefs").document("main")
    )
    prefs_ref.set({kind: False}, merge=True)
    logger.info("unsubscribe_success uid=%s kind=%s", uid, kind)

    html = _web_jinja.get_template("unsubscribe.html.j2").render(
        success=True,
        app_url=app_url,
    )
    return HTMLResponse(content=html, status_code=200)
