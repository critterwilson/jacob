"""Active-incident router (T59).

Two surfaces:

* `GET  /api/incidents` — any signed-in user; returns the currently
  active incidents. Cached client-side and revalidated on a 60s
  interval (mirrors `useFlag`); the banner reads from this.
* `POST /api/admin/incidents` / `POST /api/admin/incidents/{id}/clear`
  — platform-admin only. Every declare and clear writes an
  `audit_log` row.

Per M6, the underlying `active_incidents/{incidentId}` collection
default-denies client access; this is the only path in.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, Response, status
from firebase_admin import firestore as fb_firestore
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, ADMIN_MUTATION, FLAG_READ
from app.middleware.rate_limit import limiter
from app.models.incidents import (
    ActiveIncident,
    ActiveIncidentsResponse,
    IncidentClearResponse,
    IncidentDeclareRequest,
    IncidentDeclareResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["incidents"])
admin_router = APIRouter(prefix="/api/admin/incidents", tags=["incidents"])


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


def _doc_to_incident(snap: Any) -> ActiveIncident:
    data: dict[str, Any] = snap.to_dict() or {}
    return ActiveIncident(
        incidentId=snap.id,
        severity=data.get("severity", "SEV3"),
        title=str(data.get("title", "")),
        body=str(data.get("body", "")),
        createdBy=data.get("createdBy"),
        createdAt=_ts_to_str(data.get("createdAt")),
        displayUntil=_ts_to_str(data.get("displayUntil")) or "",
        acknowledged=bool(data.get("acknowledged", False)),
    )


# ── client-facing read ─────────────────────────────────────────────────────


@router.get("/api/incidents", response_model=ActiveIncidentsResponse)
@limiter.limit(FLAG_READ)
def list_active_incidents(
    request: Request,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: CurrentUser = Depends(get_current_user),
) -> ActiveIncidentsResponse:
    db = _db()
    now = datetime.now(UTC)
    incidents: list[ActiveIncident] = []
    # `active_incidents` is small (∼0–5 docs typical). One full scan per
    # caller is acceptable; the 60-second client revalidation keeps total
    # QPS bounded.
    for snap in db.collection("active_incidents").stream():
        data = snap.to_dict() or {}
        display_until = data.get("displayUntil")
        if isinstance(display_until, datetime) and display_until <= now:
            continue
        incidents.append(_doc_to_incident(snap))
    incidents.sort(key=lambda i: i.displayUntil, reverse=True)
    payload = ActiveIncidentsResponse(incidents=incidents)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'
    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return payload


# ── admin: declare + clear ─────────────────────────────────────────────────


@admin_router.post("", response_model=IncidentDeclareResponse)
@limiter.limit(ADMIN_MUTATION)
def declare_incident(
    request: Request,
    response: Response,
    body: IncidentDeclareRequest,
    admin: CurrentUser = Depends(require_admin),
) -> IncidentDeclareResponse:
    db = _db()
    incident_id = str(uuid.uuid4())
    display_until = datetime.now(UTC) + timedelta(minutes=body.displayMinutes)
    db.collection("active_incidents").document(incident_id).set(
        {
            "severity": body.severity,
            "title": body.title.strip(),
            "body": body.body.strip(),
            "createdBy": admin.uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "displayUntil": display_until,
            "acknowledged": False,
        }
    )
    write_audit_log(
        actor_uid=admin.uid,
        action="incident_declare",
        target_ref=f"active_incidents/{incident_id}",
        payload={
            "severity": body.severity,
            "title": body.title,
            "displayMinutes": body.displayMinutes,
        },
    )
    logger.warning(
        "incident_declared id=%s severity=%s actor=%s title=%r",
        incident_id,
        body.severity,
        admin.uid,
        body.title,
    )
    return IncidentDeclareResponse(
        incidentId=incident_id,
        severity=body.severity,
        title=body.title,
        displayUntil=display_until.isoformat(),
    )


@admin_router.post("/{incident_id}/clear", response_model=IncidentClearResponse)
@limiter.limit(ADMIN_MUTATION)
def clear_incident(
    incident_id: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> IncidentClearResponse:
    db = _db()
    ref = db.collection("active_incidents").document(incident_id)
    snap = ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="incident_not_found",
            message=f"Incident {incident_id!r} does not exist",
        )
    # Set displayUntil to one ms ago so the next /api/incidents scan
    # filters it out — semantically "cleared" without deleting the doc
    # so the audit trail stays intact.
    ref.update({"displayUntil": datetime.now(UTC) - timedelta(milliseconds=1)})
    write_audit_log(
        actor_uid=admin.uid,
        action="incident_clear",
        target_ref=f"active_incidents/{incident_id}",
        payload={},
    )
    logger.info("incident_cleared id=%s actor=%s", incident_id, admin.uid)
    return IncidentClearResponse(incidentId=incident_id, cleared=True)


@admin_router.get("", response_model=ActiveIncidentsResponse)
@limiter.limit(ADMIN_LIST)
def list_all_incidents_admin(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> ActiveIncidentsResponse:
    """Admin view — includes incidents whose `displayUntil` has elapsed."""
    db = _db()
    incidents = [_doc_to_incident(snap) for snap in db.collection("active_incidents").stream()]
    incidents.sort(key=lambda i: i.displayUntil, reverse=True)
    return ActiveIncidentsResponse(incidents=incidents)
