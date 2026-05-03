"""Account router: deletion request, cancel, status (T14), and self-serve
data export (T38).

The deletion lifecycle is intentionally split across three endpoints so
the client can drive a confirm → grace-period → cancel-or-finalize flow
without ever holding hard-delete authority itself. Finalization runs as
a daily Cloud Scheduler job (`infra/scheduled/finalize_deletions.py`),
not a request handler — see `services.deletion.finalize_account`.

The export endpoints follow the same shape: the client enqueues a job;
the assembly happens in a Cloud Run Job triggered every 5 minutes by
Cloud Scheduler; the user receives an email with a 7-day signed URL.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse

from app.deps import get_current_user
from app.errors import APIError
from app.limits import EXPORT_REQUEST
from app.middleware.rate_limit import limiter
from app.models.account import (
    CancelDeleteResponse,
    DeleteAccountRequest,
    DeleteAccountResponse,
    DeleteStatusResponse,
    ExportJobResponse,
    ExportRequest,
)
from app.models.user import CurrentUser
from app.services import deletion, export

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/account", tags=["account"])


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


# ── T38 — self-serve data export ─────────────────────────────────────────────


@router.post("/export", response_model=ExportJobResponse)
@limiter.limit(EXPORT_REQUEST)
def request_export(
    request: Request,
    response: Response,
    body: ExportRequest | None = None,
    user: CurrentUser = Depends(get_current_user),
) -> ExportJobResponse:
    """Enqueue a new data-export job for the calling user."""
    del body  # body is currently empty; reserved for format/scope flags
    try:
        result = export.request_export(user.uid)
    except RuntimeError as exc:
        if str(exc) == "export_in_flight":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="export_in_flight",
                message="An export is already in progress for this account",
            ) from None
        if str(exc) == "export_disabled":
            raise APIError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="export_disabled",
                message="Data export is temporarily unavailable",
            ) from None
        raise
    return ExportJobResponse(**result)


@router.get("/export/status", response_model=ExportJobResponse)
def export_status(
    user: CurrentUser = Depends(get_current_user),
) -> ExportJobResponse:
    """Return the most recent export job (or `status="none"` if there isn't one)."""
    info = export.latest_status(user.uid)
    return ExportJobResponse(**info)


@router.get("/export/{job_id}/download")
def export_download(
    job_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> RedirectResponse:
    """302-redirect to the live signed download URL for *job_id*.

    The signed URL itself is also returned by ``/export/status`` and
    embedded in the completion email so users who lose their browser
    session can still retrieve their bundle.
    """
    try:
        url = export.get_download_url(user.uid, job_id)
    except LookupError:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="export_not_found",
            message="Export job not found",
        ) from None
    except RuntimeError as exc:
        code = str(exc)
        if code == "export_not_ready":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="export_not_ready",
                message="Export is not ready for download",
            ) from None
        if code == "export_failed":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="export_failed",
                message="Export job failed; please request a new export",
            ) from None
        if code == "export_expired":
            raise APIError(
                status_code=status.HTTP_410_GONE,
                code="export_expired",
                message="Export download link has expired; please request a new export",
            ) from None
        raise
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)
