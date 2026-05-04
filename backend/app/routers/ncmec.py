"""NCMEC reporting router (T63).

Platform-admin-only surface. The HTTPS integration with NCMEC is
stubbed in v1 (see `services/ncmec.py` and ADR 0010); the
operator-gate + audit + queue UI ship now so the on-call has the
mechanism in place when the operator account is provisioned.

Per M6 the underlying `ncmec_cases` collection default-denies
client access; this router is the only path.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import require_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, NCMEC_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.ncmec import (
    NcmecCase,
    NcmecCaseListResponse,
    NcmecEvidence,
    NcmecSubmitConfirmation,
    NcmecSubmitResponse,
    NcmecWithdrawRequest,
    NcmecWithdrawResponse,
)
from app.models.user import CurrentUser
from app.services import ncmec as ncmec_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/ncmec", tags=["ncmec"])


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_str(ts: Any) -> str | None:
    if ts is None:
        return None
    try:
        result: str = ts.isoformat()
        return result
    except AttributeError:
        return str(ts)


def _doc_to_case(doc: dict[str, Any]) -> NcmecCase:
    evidence = doc.get("evidence") or {}
    return NcmecCase(
        caseId=str(doc.get("caseId", "")),
        matchedAt=_ts_to_str(doc.get("matchedAt")),
        hashSource=doc.get("hashSource", "other"),
        hashValue=str(doc.get("hashValue", "")),
        evidence=NcmecEvidence(
            gcsPath=str(evidence.get("gcsPath", "")),
            sha256=str(evidence.get("sha256", "")),
            sizeBytes=int(evidence.get("sizeBytes") or 0),
            contentType=evidence.get("contentType"),
        ),
        reporterUid=doc.get("reporterUid"),
        suspectUid=doc.get("suspectUid"),
        status=doc.get("status", "pending"),
        submittedBy=doc.get("submittedBy"),
        submittedAt=_ts_to_str(doc.get("submittedAt")),
        ncmecReportId=doc.get("ncmecReportId"),
        retainedUntil=_ts_to_str(doc.get("retainedUntil")),
        withdrawnReason=doc.get("withdrawnReason"),
        failureReason=doc.get("failureReason"),
        schemaVersion=int(doc.get("schemaVersion", 1) or 1),
    )


@router.get("/pending", response_model=NcmecCaseListResponse)
@limiter.limit(ADMIN_LIST)
def list_pending(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> NcmecCaseListResponse:
    db = _db()
    rows = ncmec_service.list_cases(db, status="pending")
    return NcmecCaseListResponse(cases=[_doc_to_case(r) for r in rows])


@router.get("", response_model=NcmecCaseListResponse)
@limiter.limit(ADMIN_LIST)
def list_all(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> NcmecCaseListResponse:
    db = _db()
    rows = ncmec_service.list_cases(db, status=None)
    return NcmecCaseListResponse(cases=[_doc_to_case(r) for r in rows])


@router.post("/{case_id}/submit", response_model=NcmecSubmitResponse)
@limiter.limit(NCMEC_SUBMIT)
def submit(
    case_id: str,
    request: Request,
    response: Response,
    body: NcmecSubmitConfirmation,
    admin: CurrentUser = Depends(require_admin),
) -> NcmecSubmitResponse:
    db = _db()
    ok, reason = ncmec_service.submit_case(db, case_id=case_id, operator_uid=admin.uid)
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="case_not_found",
                message="NCMEC case not found",
            )
        if reason == "already_processed":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_processed",
                message="NCMEC case already submitted or withdrawn",
            )
        if reason == "submit_disabled":
            raise APIError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="submit_disabled",
                message="NCMEC submit kill switch is engaged",
            )
        raise APIError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="submit_failed",
            message=f"NCMEC submit failed: {reason}",
        )
    write_audit_log(
        actor_uid=admin.uid,
        action="ncmec_submit",
        target_ref=f"ncmec_cases/{case_id}",
        payload={"confirm": body.confirm},
    )
    snap = db.collection("ncmec_cases").document(case_id).get()
    data = snap.to_dict() or {}
    data["caseId"] = case_id
    return NcmecSubmitResponse(
        caseId=case_id,
        status=data.get("status", "submitted"),
        ncmecReportId=data.get("ncmecReportId"),
        submittedAt=_ts_to_str(data.get("submittedAt")),
    )


@router.post("/{case_id}/withdraw", response_model=NcmecWithdrawResponse)
@limiter.limit(NCMEC_SUBMIT)
def withdraw(
    case_id: str,
    request: Request,
    response: Response,
    body: NcmecWithdrawRequest,
    admin: CurrentUser = Depends(require_admin),
) -> NcmecWithdrawResponse:
    db = _db()
    ok, reason = ncmec_service.withdraw_case(
        db, case_id=case_id, operator_uid=admin.uid, reason=body.reason
    )
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="case_not_found",
                message="NCMEC case not found",
            )
        if reason == "already_processed":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_processed",
                message="Case already withdrawn",
            )
    write_audit_log(
        actor_uid=admin.uid,
        action="ncmec_withdraw",
        target_ref=f"ncmec_cases/{case_id}",
        payload={"reason_length": len(body.reason)},
    )
    return NcmecWithdrawResponse(
        caseId=case_id,
        status="withdrawn",
        withdrawnReason=body.reason,
    )
