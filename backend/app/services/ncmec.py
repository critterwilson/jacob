"""NCMEC case service (T63).

Owns the case-doc lifecycle. The actual NCMEC CyberTipline HTTPS
call is **stubbed** in v1 — wiring it requires an NCMEC operator
account (see `docs/legal/ncmec.md` and ADR 0010). The service
records the operator action + the would-be report id and surfaces
a `MANUAL_ACTION_REQUIRED` log line on submit so the on-call sees
that the integration step is outstanding.

The fail-closed posture is preserved: on any operator-side failure
(invalid case, already submitted, etc.) the case stays `pending`
until a successful submit lands.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


DEFAULT_RETENTION_DAYS = 90
SUBMIT_DISABLED_ENV = "NCMEC_SUBMIT_DISABLED"


def submit_disabled() -> bool:
    return os.environ.get(SUBMIT_DISABLED_ENV, "").lower() in {"1", "true", "yes"}


def create_case(
    db: Any,
    *,
    hash_source: str,
    hash_value: str,
    evidence: dict[str, Any],
    reporter_uid: str | None = None,
    suspect_uid: str | None = None,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    now: datetime | None = None,
) -> str:
    """Create a pending NCMEC case. Returns the case id.

    Called by the CSAM-match path (`onPhotoUploadFinalize` extension —
    follow-up) and by the operator manual-add tool. Both paths land in
    the same queue.
    """
    case_id = str(uuid.uuid4())
    now = now or datetime.now(UTC)
    db.collection("ncmec_cases").document(case_id).set(
        {
            "matchedAt": now,
            "hashSource": hash_source,
            "hashValue": hash_value,
            "evidence": evidence,
            "reporterUid": reporter_uid,
            "suspectUid": suspect_uid,
            "status": "pending",
            "submittedBy": None,
            "ncmecReportId": None,
            "submittedAt": None,
            "retainedUntil": now + timedelta(days=retention_days),
            "withdrawnReason": None,
            "failureReason": None,
            "schemaVersion": 1,
        }
    )
    logger.warning(
        "ncmec_case_created case=%s suspect=%s reporter=%s "
        "(MANUAL_ACTION_REQUIRED: operator review the queue at /admin/ncmec)",
        case_id,
        suspect_uid,
        reporter_uid,
    )
    return case_id


def submit_case(
    db: Any,
    *,
    case_id: str,
    operator_uid: str,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Mark a case submitted to NCMEC.

    v1 STUB: the NCMEC HTTPS endpoint isn't called. We record the
    operator's intent + a synthetic report id (`STUB-<uuid>`) and log
    a MANUAL_ACTION_REQUIRED line so on-call knows to file the report
    out-of-band until the integration lands. ADR 0010 documents the
    rationale; the legal doc covers the manual-fallback procedure.

    Returns `(ok, reason)`. Reasons: `not_found`, `already_processed`,
    `submit_disabled`.
    """
    if submit_disabled():
        return False, "submit_disabled"
    ref = db.collection("ncmec_cases").document(case_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found"
    data = snap.to_dict() or {}
    if data.get("status") != "pending":
        return False, "already_processed"
    now = now or datetime.now(UTC)
    synthetic_report_id = f"STUB-{uuid.uuid4().hex[:16]}"
    ref.update(
        {
            "status": "submitted",
            "submittedBy": operator_uid,
            "submittedAt": now,
            "ncmecReportId": synthetic_report_id,
        }
    )
    logger.warning(
        "MANUAL_ACTION_REQUIRED ncmec_case=%s status=submitted "
        "operator=%s — file the report manually with NCMEC until the "
        "HTTPS integration lands; record the real report id in the case doc.",
        case_id,
        operator_uid,
    )
    return True, None


def withdraw_case(
    db: Any,
    *,
    case_id: str,
    operator_uid: str,
    reason: str,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Mark a case withdrawn (false positive).

    Reason ≥ 50 chars is enforced at the model boundary. If the case
    was already submitted, the operator is responsible for filing the
    withdrawal with NCMEC (documented in the runbook). v1 records the
    state change.
    """
    ref = db.collection("ncmec_cases").document(case_id)
    snap = ref.get()
    if not snap.exists:
        return False, "not_found"
    data = snap.to_dict() or {}
    if data.get("status") == "withdrawn":
        return False, "already_processed"
    now = now or datetime.now(UTC)
    ref.update(
        {
            "status": "withdrawn",
            "withdrawnReason": reason,
            "submittedBy": data.get("submittedBy") or operator_uid,
        }
    )
    if data.get("status") == "submitted":
        logger.warning(
            "MANUAL_ACTION_REQUIRED ncmec_case=%s status=withdrawn "
            "operator=%s — also file the withdrawal with NCMEC.",
            case_id,
            operator_uid,
        )
    return True, None


def list_cases(
    db: Any,
    *,
    status: str | None = "pending",
) -> list[dict[str, Any]]:
    query: Any = db.collection("ncmec_cases")
    if status is not None:
        query = query.where("status", "==", status)
    out: list[dict[str, Any]] = []
    for snap in query.stream():
        data = snap.to_dict() or {}
        data["caseId"] = snap.id
        out.append(data)
    out.sort(
        key=lambda r: r.get("matchedAt") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return out
