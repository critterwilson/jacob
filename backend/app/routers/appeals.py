"""Appeals router (T64).

Endpoints:

* `POST /api/appeals`                          — appellant submits
* `GET  /api/appeals/{appealId}`               — appellant or admin reads
* `GET  /api/admin/appeals`                    — admin queue
* `POST /api/admin/appeals/{appealId}/decide`  — admin decides

The "different admin" rule lives in `services/appeals.py`. v1
respects the existing `/api/account/...` ban-check pattern: the
appellant must be signed-in (and not banned, since a banned user
appealing the ban itself is already a permitted state — they sign
in and submit; the ban-not-bannned dep is unfair here).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, ADMIN_MUTATION, APPEAL_SUBMIT
from app.middleware.rate_limit import limiter
from app.models.appeals import (
    Appeal,
    AppealListResponse,
    AppealSubject,
    AppealSubmitRequest,
    AppealSubmitResponse,
    DecideRequest,
    DecideResponse,
)
from app.models.user import CurrentUser
from app.services import appeals as appeals_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
appellant_router = APIRouter(prefix="/api/appeals", tags=["appeals"])
admin_router = APIRouter(prefix="/api/admin/appeals", tags=["appeals"])


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


def _doc_to_appeal(doc: dict[str, Any]) -> Appeal:
    subject = doc.get("subject") or {}
    return Appeal(
        appealId=str(doc.get("appealId", "")),
        subject=AppealSubject(
            type=subject.get("type", "message"),
            ref=str(subject.get("ref", "")),
        ),
        appellantUid=str(doc.get("appellantUid", "")),
        originalActorUid=doc.get("originalActorUid"),
        originalActionAt=_ts_to_str(doc.get("originalActionAt")),
        submittedAt=_ts_to_str(doc.get("submittedAt")),
        body=str(doc.get("body", "")),
        decision=doc.get("decision", "pending"),
        decidedBy=doc.get("decidedBy"),
        decidedAt=_ts_to_str(doc.get("decidedAt")),
        reasoning=doc.get("reasoning"),
        overdue=appeals_service.is_overdue(doc.get("submittedAt")),
    )


# ── appellant surface ────────────────────────────────────────────────────────


@appellant_router.post("", response_model=AppealSubmitResponse)
@limiter.limit(APPEAL_SUBMIT)
def submit_appeal(
    request: Request,
    response: Response,
    body: AppealSubmitRequest,
    user: CurrentUser = Depends(get_current_user),
) -> AppealSubmitResponse:
    db = _db()
    ok, reason, appeal_id = appeals_service.submit_appeal(
        db,
        subject_type=body.subject.type,
        subject_ref=body.subject.ref,
        appellant_uid=user.uid,
        body=body.body,
    )
    if not ok:
        if reason == "appeal_already_decided":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="appeal_already_decided",
                message="An appeal already exists for this subject",
            )
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="appeal_submit_failed",
            message=str(reason),
        )
    write_audit_log(
        actor_uid=user.uid,
        action="appeal_submit",
        target_ref=f"appeals/{appeal_id}",
        payload={
            "subjectType": body.subject.type,
            "subjectRef": body.subject.ref,
        },
    )
    return AppealSubmitResponse(appealId=appeal_id or "", decision="pending")


@appellant_router.get("/{appeal_id}", response_model=Appeal)
@limiter.limit(ADMIN_LIST)
def get_appeal(
    appeal_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> Appeal:
    db = _db()
    data = appeals_service.get_appeal(db, appeal_id)
    if not data:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="appeal_not_found",
            message="Appeal not found",
        )
    is_admin = user.claims.get("admin") is True
    is_appellant = data.get("appellantUid") == user.uid
    if not (is_admin or is_appellant):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Appeals are visible to the appellant or platform admins",
        )
    return _doc_to_appeal(data)


# ── admin surface ────────────────────────────────────────────────────────────


@admin_router.get("", response_model=AppealListResponse)
@limiter.limit(ADMIN_LIST)
def list_appeals(
    request: Request,
    response: Response,
    decision: str | None = None,
    admin: CurrentUser = Depends(require_admin),
) -> AppealListResponse:
    db = _db()
    rows = appeals_service.list_appeals(db, decision=decision)
    return AppealListResponse(appeals=[_doc_to_appeal(r) for r in rows])


@admin_router.post("/{appeal_id}/decide", response_model=DecideResponse)
@limiter.limit(ADMIN_MUTATION)
def decide_appeal(
    appeal_id: str,
    request: Request,
    response: Response,
    body: DecideRequest,
    admin: CurrentUser = Depends(require_admin),
) -> DecideResponse:
    db = _db()
    ok, reason = appeals_service.decide(
        db,
        appeal_id=appeal_id,
        actor_uid=admin.uid,
        decision=body.decision,
        reasoning=body.reasoning,
    )
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="appeal_not_found",
                message="Appeal not found",
            )
        if reason == "already_decided":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_decided",
                message="Appeal has already been decided",
            )
        if reason == "self_review_required":
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="self_review_required",
                message=(
                    "The original actor cannot decide their own appeal. "
                    "Escalate to another admin per docs/community-guidelines.md."
                ),
            )
    write_audit_log(
        actor_uid=admin.uid,
        action="appeal_decide",
        target_ref=f"appeals/{appeal_id}",
        payload={
            "decision": body.decision,
            "reasoning_length": len(body.reasoning),
        },
    )
    snap = db.collection("appeals").document(appeal_id).get()
    data = snap.to_dict() or {}
    return DecideResponse(
        appealId=appeal_id,
        decision=data.get("decision", body.decision),
        decidedAt=_ts_to_str(data.get("decidedAt")),
    )
