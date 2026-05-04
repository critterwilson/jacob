"""Transparency report router (T65).

Surface:
* `GET  /api/transparency/latest`               — public, no auth
* `GET  /api/transparency/reports`              — public list of published
* `GET  /api/admin/transparency/drafts`         — platform-admin queue
* `POST /api/admin/transparency/{id}/publish`   — publish a draft
* `POST /api/admin/transparency/generate`       — trigger generation now
* `GET  /api/admin/audit-log.csv`               — audit-log CSV export
* `GET  /api/orgs/{orgId}/transparency/latest`  — per-org variant
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import PlainTextResponse
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, ADMIN_MUTATION
from app.middleware.rate_limit import limiter
from app.models.transparency import (
    PublishResponse,
    TransparencyListResponse,
    TransparencyReport,
)
from app.models.user import CurrentUser
from app.services import transparency as transparency_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
public_router = APIRouter(prefix="/api/transparency", tags=["transparency"])
admin_router = APIRouter(prefix="/api/admin/transparency", tags=["transparency"])
org_router = APIRouter(prefix="/api/orgs", tags=["transparency"])


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


def _row_to_report(row: dict[str, Any]) -> TransparencyReport:
    return TransparencyReport(
        reportId=str(row.get("reportId", "")),
        period=str(row.get("period", "")),
        scope=str(row.get("scope", "platform")),
        payload=row.get("payload") or {},  # type: ignore[arg-type]
        generatedAt=_ts_to_str(row.get("generatedAt")),
        publishedAt=_ts_to_str(row.get("publishedAt")),
    )


# ── public surface ───────────────────────────────────────────────────────


@public_router.get("/latest", response_model=TransparencyReport | None)
@limiter.limit(ADMIN_LIST)
def get_latest(
    request: Request,
    response: Response,
) -> TransparencyReport | None:
    db = _db()
    row = transparency_service.latest_published(db, scope="platform")
    if row is None:
        return None
    return _row_to_report(row)


@public_router.get("/reports", response_model=TransparencyListResponse)
@limiter.limit(ADMIN_LIST)
def list_published(
    request: Request,
    response: Response,
) -> TransparencyListResponse:
    db = _db()
    rows = transparency_service.list_reports(db, scope="platform", published_only=True)
    return TransparencyListResponse(reports=[_row_to_report(r) for r in rows])


# ── admin surface ────────────────────────────────────────────────────────


@admin_router.get("/drafts", response_model=TransparencyListResponse)
@limiter.limit(ADMIN_LIST)
def list_drafts(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> TransparencyListResponse:
    db = _db()
    rows = transparency_service.list_reports(db, scope="platform", published_only=False)
    return TransparencyListResponse(reports=[_row_to_report(r) for r in rows])


@admin_router.post("/generate", response_model=TransparencyReport)
@limiter.limit(ADMIN_MUTATION)
def generate(
    request: Request,
    response: Response,
    period: str | None = None,
    scope: str = "platform",
    admin: CurrentUser = Depends(require_admin),
) -> TransparencyReport:
    db = _db()
    if period is None:
        label, start, end = transparency_service.previous_quarter()
    else:
        # Parse "YYYY-Qn" → (start, end)
        try:
            year_str, q_str = period.split("-Q")
            year = int(year_str)
            q = int(q_str)
            if q < 1 or q > 4:
                raise ValueError
        except ValueError as exc:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="bad_period",
                message="period must be 'YYYY-Qn' (n in 1..4)",
            ) from exc
        start_month = (q - 1) * 3 + 1
        start = datetime(year, start_month, 1, tzinfo=UTC)
        end_year, end_month = (year + 1, 1) if start_month + 3 > 12 else (year, start_month + 3)
        end = datetime(end_year, end_month, 1, tzinfo=UTC)
        label = period
    payload = transparency_service.generate_report(
        db, period=label, start=start, end=end, scope=scope
    )
    try:
        report_id = transparency_service.write_draft(db, period=label, scope=scope, payload=payload)
    except ValueError as exc:
        raise APIError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="payload_pii_leak",
            message=str(exc),
        ) from exc
    write_audit_log(
        actor_uid=admin.uid,
        action="transparency_generate",
        target_ref=f"transparency_reports/{report_id}",
        payload={"period": label, "scope": scope},
    )
    snap = db.collection("transparency_reports").document(report_id).get()
    data = snap.to_dict() or {}
    data["reportId"] = report_id
    return _row_to_report(data)


@admin_router.post("/{report_id}/publish", response_model=PublishResponse)
@limiter.limit(ADMIN_MUTATION)
def publish(
    report_id: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> PublishResponse:
    db = _db()
    ok, reason = transparency_service.publish(db, report_id=report_id)
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="report_not_found",
                message="Transparency report not found",
            )
        if reason == "already_published":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="already_published",
                message="Report has already been published",
            )
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="publish_blocked",
            message=str(reason),
        )
    write_audit_log(
        actor_uid=admin.uid,
        action="transparency_publish",
        target_ref=f"transparency_reports/{report_id}",
        payload={},
    )
    snap = db.collection("transparency_reports").document(report_id).get()
    data = snap.to_dict() or {}
    return PublishResponse(
        reportId=report_id,
        publishedAt=_ts_to_str(data.get("publishedAt")),
    )


@admin_router.get("/audit-log.csv", response_class=PlainTextResponse)
@limiter.limit(ADMIN_LIST)
def export_audit_csv(
    request: Request,
    response: Response,
    days: int = Query(default=90, ge=1, le=730),
    admin: CurrentUser = Depends(require_admin),
) -> PlainTextResponse:
    db = _db()
    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    csv_text = transparency_service.stream_audit_csv(db, start=start, end=end)
    write_audit_log(
        actor_uid=admin.uid,
        action="audit_log_export",
        target_ref="audit_log",
        payload={"days": days},
    )
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="audit_log_{days}d.csv"',
        },
    )


# ── per-org surface ──────────────────────────────────────────────────────


@org_router.get(
    "/{org_id}/transparency/latest",
    response_model=TransparencyReport | None,
)
@limiter.limit(ADMIN_LIST)
def get_org_latest(
    org_id: str,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> TransparencyReport | None:
    db = _db()
    # Org-admin gate: must be in orgs/{orgId}/admins/{uid}
    is_platform_admin = user.claims.get("admin") is True
    is_org_admin = (
        db.collection("orgs").document(org_id).collection("admins").document(user.uid).get().exists
    )
    if not (is_platform_admin or is_org_admin):
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Org transparency reports are visible to org admins only",
        )
    row = transparency_service.latest_published(db, scope=org_id)
    if row is None:
        return None
    return _row_to_report(row)
