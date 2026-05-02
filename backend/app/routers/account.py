"""Account router: deletion request, cancel, and status (T14).

The deletion lifecycle is intentionally split across three endpoints so
the client can drive a confirm → grace-period → cancel-or-finalize flow
without ever holding hard-delete authority itself. Finalization runs as
a daily Cloud Scheduler job (`infra/scheduled/finalize_deletions.py`),
not a request handler — see `services.deletion.finalize_account`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status

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
