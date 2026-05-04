"""Server-side feature-flag evaluator (T58).

Flags live at `feature_flags/{flagKey}`. Resolution order:

1. Cohort overrides win unconditionally:
   * uid in `cohorts.uids` → ON
   * any of the user's org ids in `cohorts.orgIds` → ON
   * any of the user's roles in `cohorts.roles` → ON
2. If `enabled` is False the flag is OFF regardless of percentage.
3. Otherwise, hash bucket of (uid + flagKey) modulo 100 < rolloutPercentage.

The bucket function is `sha256(f"{uid}:{flagKey}").digest()[0:4]` interpreted
as a big-endian unsigned int, mod 100. Pinned by the unit tests so any
future client-side evaluator (post-Phase-3 native mobile) can reproduce
the same buckets.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _bucket(uid: str, flag_key: str) -> int:
    """Deterministic 0..99 bucket for a (uid, flag) pair."""
    h = hashlib.sha256(f"{uid}:{flag_key}".encode()).digest()
    return int.from_bytes(h[:4], "big") % 100


def _evaluate(
    flag: dict[str, Any],
    *,
    uid: str,
    flag_key: str,
    org_ids: Iterable[str],
    roles: Iterable[str],
) -> bool:
    cohorts = flag.get("cohorts") or {}
    cohort_uids = set(cohorts.get("uids") or [])
    cohort_orgs = set(cohorts.get("orgIds") or [])
    cohort_roles = set(cohorts.get("roles") or [])

    if uid in cohort_uids:
        return True
    if cohort_orgs and any(o in cohort_orgs for o in org_ids):
        return True
    if cohort_roles and any(r in cohort_roles for r in roles):
        return True

    if not flag.get("enabled", False):
        return False

    pct = int(flag.get("rolloutPercentage", 0) or 0)
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    return _bucket(uid, flag_key) < pct


def evaluate_flag(
    flag_key: str,
    *,
    uid: str,
    org_ids: Iterable[str] = (),
    roles: Iterable[str] = (),
    db: Any | None = None,
) -> bool:
    """Evaluate a single flag for the given user context. Unknown → False."""
    db = db or _db()
    snap = db.collection("feature_flags").document(flag_key).get()
    if not snap.exists:
        return False
    data = snap.to_dict() or {}
    return _evaluate(
        data,
        uid=uid,
        flag_key=flag_key,
        org_ids=org_ids,
        roles=roles,
    )


def evaluate_all_flags(
    *,
    uid: str,
    org_ids: Iterable[str] = (),
    roles: Iterable[str] = (),
    db: Any | None = None,
) -> dict[str, bool]:
    """Evaluate every flag in the collection for the given user context.

    Used by `GET /api/flags`. Cheap because the collection is small
    (≤ ~hundreds of flags); the listener cost from the spec is sidestepped
    entirely by polling on the client.
    """
    db = db or _db()
    org_ids_t = tuple(org_ids)
    roles_t = tuple(roles)
    out: dict[str, bool] = {}
    for snap in db.collection("feature_flags").stream():
        data = snap.to_dict() or {}
        out[snap.id] = _evaluate(
            data,
            uid=uid,
            flag_key=snap.id,
            org_ids=org_ids_t,
            roles=roles_t,
        )
    return out
