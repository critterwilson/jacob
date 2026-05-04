"""Feature-flag router (T58).

Two surfaces:

* `GET /api/flags` — any signed-in user; returns evaluated `{flagKey: bool}`
  for the caller. Cached client-side via SWR (`frontend/lib/flags.ts`)
  with periodic revalidation.
* `/api/admin/flags*` — platform-admin-only mutation surface. Every write
  goes through `audit_log` (`action: flag_update` / `flag_delete`).

The collection itself is denied to clients in `firestore.rules` per M6.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import ADMIN_LIST, FLAG_MUTATION, FLAG_READ
from app.middleware.rate_limit import limiter
from app.models.flags import (
    EvaluatedFlagsResponse,
    FeatureFlag,
    FeatureFlagCohorts,
    FeatureFlagDeleteResponse,
    FeatureFlagListResponse,
    FeatureFlagPercentageRequest,
    FeatureFlagUpsertRequest,
    FlagAuditEntry,
    FlagAuditResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin
from app.services.flags import evaluate_all_flags

logger = logging.getLogger(__name__)

# Two routers because the user-facing surface and the admin surface have
# different prefixes; they share a tag so OpenAPI groups them together.
router = APIRouter(tags=["flags"])
admin_router = APIRouter(prefix="/api/admin/flags", tags=["flags"])


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


def _user_org_ids(uid: str, db: Any) -> list[str]:
    snap = db.collection("users").document(uid).get()
    if not snap.exists:
        return []
    data = snap.to_dict() or {}
    org_ids = data.get("orgIds") or []
    return [str(o) for o in org_ids if isinstance(o, str)]


def _user_roles(user: CurrentUser) -> list[str]:
    """Derive cohort-targetable roles from the verified ID token claims.

    `admin` is the only platform-level role today; group-leader / member
    roles are per-group and would need a different cohort shape, so they're
    not surfaced here.
    """
    roles: list[str] = []
    if user.claims.get("admin") is True:
        roles.append("admin")
    return roles


# ── user-facing surface ──────────────────────────────────────────────────────


@router.get("/api/flags", response_model=EvaluatedFlagsResponse)
@limiter.limit(FLAG_READ)
def get_flags_for_me(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> EvaluatedFlagsResponse:
    db = _db()
    org_ids = _user_org_ids(user.uid, db)
    roles = _user_roles(user)
    return EvaluatedFlagsResponse(
        flags=evaluate_all_flags(
            uid=user.uid,
            org_ids=org_ids,
            roles=roles,
            db=db,
        ),
    )


# ── admin surface ────────────────────────────────────────────────────────────


def _doc_to_flag(snap: Any) -> FeatureFlag:
    data: dict[str, Any] = snap.to_dict() or {}
    cohorts_data = data.get("cohorts") or {}
    return FeatureFlag(
        flagKey=snap.id,
        enabled=bool(data.get("enabled", False)),
        rolloutPercentage=int(data.get("rolloutPercentage", 0) or 0),
        cohorts=FeatureFlagCohorts(
            orgIds=list(cohorts_data.get("orgIds") or []),
            roles=list(cohorts_data.get("roles") or []),
            uids=list(cohorts_data.get("uids") or []),
        ),
        description=str(data.get("description") or ""),
        updatedBy=data.get("updatedBy"),
        updatedAt=_ts_to_str(data.get("updatedAt")),
        fullRolloutAt=_ts_to_str(data.get("fullRolloutAt")),
        schemaVersion=int(data.get("schemaVersion", 1) or 1),
    )


@admin_router.get("", response_model=FeatureFlagListResponse)
@limiter.limit(ADMIN_LIST)
def list_flags(
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> FeatureFlagListResponse:
    db = _db()
    flags = [
        _doc_to_flag(snap) for snap in db.collection("feature_flags").order_by("__name__").stream()
    ]
    return FeatureFlagListResponse(flags=flags)


@admin_router.get("/{flag_key}", response_model=FeatureFlag)
@limiter.limit(ADMIN_LIST)
def get_flag(
    flag_key: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> FeatureFlag:
    db = _db()
    snap = db.collection("feature_flags").document(flag_key).get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="flag_not_found",
            message=f"Feature flag {flag_key!r} does not exist",
        )
    return _doc_to_flag(snap)


@admin_router.get("/{flag_key}/audit", response_model=FlagAuditResponse)
@limiter.limit(ADMIN_LIST)
def get_flag_audit(
    flag_key: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> FlagAuditResponse:
    db = _db()
    target = f"feature_flags/{flag_key}"
    query = (
        db.collection("audit_log")
        .where("targetRef", "==", target)
        .order_by("createdAt", direction="DESCENDING")
        .limit(50)
    )
    entries: list[FlagAuditEntry] = []
    for snap in query.stream():
        data: dict[str, Any] = snap.to_dict() or {}
        entries.append(
            FlagAuditEntry(
                eventId=snap.id,
                actorUid=str(data.get("actorUid", "")),
                action=str(data.get("action", "")),
                createdAt=_ts_to_str(data.get("createdAt")),
                payload=dict(data.get("payload") or {}),
            )
        )
    return FlagAuditResponse(flagKey=flag_key, entries=entries)


def _write_flag(
    db: Any,
    *,
    actor_uid: str,
    body: FeatureFlagUpsertRequest,
) -> FeatureFlag:
    ref = db.collection("feature_flags").document(body.flagKey)
    existing_snap = ref.get()
    existing_data = existing_snap.to_dict() if existing_snap.exists else {}
    existing_full_at = (existing_data or {}).get("fullRolloutAt")

    full_rollout_at: Any
    if body.rolloutPercentage >= 100:
        # Preserve the original "since" timestamp so the cleanup banner
        # measures elapsed time at 100%, not the most recent edit.
        full_rollout_at = existing_full_at or fb_firestore.SERVER_TIMESTAMP
    else:
        full_rollout_at = None

    payload = {
        "enabled": body.enabled,
        "rolloutPercentage": body.rolloutPercentage,
        "cohorts": {
            "orgIds": list(body.cohorts.orgIds),
            "roles": list(body.cohorts.roles),
            "uids": list(body.cohorts.uids),
        },
        "description": body.description,
        "updatedBy": actor_uid,
        "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        "fullRolloutAt": full_rollout_at,
        "schemaVersion": 1,
    }
    ref.set(payload, merge=False)

    audit_payload: dict[str, Any] = {
        "enabled": body.enabled,
        "rolloutPercentage": body.rolloutPercentage,
        "cohortSizes": {
            "uids": len(body.cohorts.uids),
            "orgIds": len(body.cohorts.orgIds),
            "roles": len(body.cohorts.roles),
        },
    }
    if existing_snap.exists:
        audit_payload["previous"] = {
            "enabled": bool((existing_data or {}).get("enabled", False)),
            "rolloutPercentage": int((existing_data or {}).get("rolloutPercentage", 0) or 0),
        }
    write_audit_log(
        actor_uid=actor_uid,
        action="flag_update",
        target_ref=f"feature_flags/{body.flagKey}",
        payload=audit_payload,
    )
    logger.info(
        "flag_update actor=%s key=%s enabled=%s pct=%s",
        actor_uid,
        body.flagKey,
        body.enabled,
        body.rolloutPercentage,
    )

    snap = ref.get()
    return _doc_to_flag(snap)


@admin_router.post("", response_model=FeatureFlag)
@limiter.limit(FLAG_MUTATION)
def upsert_flag(
    request: Request,
    response: Response,
    body: FeatureFlagUpsertRequest,
    admin: CurrentUser = Depends(require_admin),
) -> FeatureFlag:
    db = _db()
    return _write_flag(db, actor_uid=admin.uid, body=body)


@admin_router.post("/{flag_key}/percentage", response_model=FeatureFlag)
@limiter.limit(FLAG_MUTATION)
def set_flag_percentage(
    flag_key: str,
    request: Request,
    response: Response,
    body: FeatureFlagPercentageRequest,
    admin: CurrentUser = Depends(require_admin),
) -> FeatureFlag:
    db = _db()
    snap = db.collection("feature_flags").document(flag_key).get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="flag_not_found",
            message=f"Feature flag {flag_key!r} does not exist",
        )
    existing = snap.to_dict() or {}
    cohorts = existing.get("cohorts") or {}
    return _write_flag(
        db,
        actor_uid=admin.uid,
        body=FeatureFlagUpsertRequest(
            flagKey=flag_key,
            enabled=bool(existing.get("enabled", False)),
            rolloutPercentage=body.rolloutPercentage,
            cohorts=FeatureFlagCohorts(
                orgIds=list(cohorts.get("orgIds") or []),
                roles=list(cohorts.get("roles") or []),
                uids=list(cohorts.get("uids") or []),
            ),
            description=str(existing.get("description") or ""),
        ),
    )


@admin_router.delete("/{flag_key}", response_model=FeatureFlagDeleteResponse)
@limiter.limit(FLAG_MUTATION)
def delete_flag(
    flag_key: str,
    request: Request,
    response: Response,
    admin: CurrentUser = Depends(require_admin),
) -> FeatureFlagDeleteResponse:
    db = _db()
    ref = db.collection("feature_flags").document(flag_key)
    snap = ref.get()
    if not snap.exists:
        # Idempotent: deleting a missing flag is a no-op (200) so cleanup
        # scripts can run twice safely.
        return FeatureFlagDeleteResponse(flagKey=flag_key, deleted=False)
    ref.delete()
    write_audit_log(
        actor_uid=admin.uid,
        action="flag_delete",
        target_ref=f"feature_flags/{flag_key}",
        payload={"deletedAt": datetime.now(UTC).isoformat()},
    )
    logger.info("flag_delete actor=%s key=%s", admin.uid, flag_key)
    return FeatureFlagDeleteResponse(flagKey=flag_key, deleted=True)
