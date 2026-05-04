"""T55 — domain claim service.

Two surfaces:

* `claim_subdomain` / `release_subdomain` — `*.jacob.app` (or whatever
  `JACOB_BASE_DOMAIN` resolves to). The first claim creates an
  uniqueness doc at `domain_claims/{hostname}` with type `subdomain`.
  The Cloud Run wildcard mapping is provisioned once at infra-setup
  time so a new claim is a Firestore-only operation.

* `claim_vanity_domain` / `verify_vanity_domain` /
  `release_vanity_domain` — `groups.our-church.org`-style claims.
  The flow is:
    1. Operator-facing endpoint generates a TXT token, stores it on
       `orgs/{orgId}.customDomain` with `status=pending`, and
       returns the token to the caller.
    2. Caller adds a `TXT` record on the hostname with the supplied
       value (e.g. `_jacob-domain-verify.<hostname>` → `<token>`).
    3. Caller polls the verify endpoint; once the TXT record
       resolves, status flips to `verified` and we mark
       `certStatus=provisioning`.
    4. The actual Cloud Run domain mapping is created out-of-band
       by an operator running `gcloud run domain-mappings create`
       — we record `MANUAL_ACTION_REQUIRED` in the audit log so the
       on-call has a paper trail.

Cloud Run domain mapping is free per-mapping but the API call
requires Cloud Run Admin IAM the backend service account does not
have (and we do not want to grant). The runbook covers the
operator step.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.services import dns_verification as dns_v

logger = logging.getLogger(__name__)


_SUBDOMAIN_RE = re.compile(r"^(?=.{3,40}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
_HOSTNAME_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")


def reserved_subdomains() -> set[str]:
    """Subdomains we never let an org claim. Sourced from settings."""
    raw = get_settings().jacob_reserved_subdomains
    parts = [s.strip().lower() for s in raw.split(",") if s.strip()]
    return set(parts)


def base_domain() -> str:
    return get_settings().jacob_base_domain


def is_valid_subdomain(subdomain: str) -> bool:
    return bool(_SUBDOMAIN_RE.match(subdomain))


def is_valid_hostname(hostname: str) -> bool:
    return bool(_HOSTNAME_RE.match(hostname))


# ── claim records ────────────────────────────────────────────────────────────


def _claim_ref(db: Any, hostname: str) -> Any:
    return db.collection("domain_claims").document(hostname)


def _hostname_for_subdomain(subdomain: str) -> str:
    return f"{subdomain}.{base_domain()}"


def claim_subdomain(
    db: Any,
    *,
    org_id: str,
    subdomain: str,
    actor_uid: str,
) -> str:
    """Atomically claim `<subdomain>.<base>` for `org_id`.

    Raises `ValueError("invalid")` / `"reserved"` / `"taken"`.
    Returns the full hostname on success. Sets
    `orgs/{orgId}.customSubdomain` and updates the org doc.
    """
    sub = subdomain.lower()
    if not is_valid_subdomain(sub):
        raise ValueError("invalid")
    if sub in reserved_subdomains():
        raise ValueError("reserved")

    hostname = _hostname_for_subdomain(sub)
    claim_ref = _claim_ref(db, hostname)
    snap = claim_ref.get()
    if snap.exists:
        existing = snap.to_dict() or {}
        if existing.get("orgId") == org_id:
            # Idempotent: already claimed by this org. Return as-is.
            return hostname
        raise ValueError("taken")

    claim_ref.create(
        {
            "orgId": org_id,
            "hostname": hostname,
            "type": "subdomain",
            "createdBy": actor_uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    db.collection("orgs").document(org_id).update({"customSubdomain": sub})
    logger.info(
        "subdomain_claim org=%s sub=%s host=%s actor=%s",
        org_id,
        sub,
        hostname,
        actor_uid,
    )
    return hostname


def release_subdomain(
    db: Any,
    *,
    org_id: str,
    actor_uid: str,
) -> bool:
    """Release whatever subdomain `org_id` currently holds.

    Returns True if a release happened, False if there was nothing
    to release. The reclaim cooling-off window lives in
    `domain_claims/{hostname}.releasedAt + 30d` — the doc is kept
    so a new claim can refuse during that window.
    """
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        return False
    sub = (org_snap.to_dict() or {}).get("customSubdomain")
    if not sub:
        return False
    hostname = _hostname_for_subdomain(sub)
    claim_ref = _claim_ref(db, hostname)
    claim_ref.update(
        {
            "releasedAt": fb_firestore.SERVER_TIMESTAMP,
            "releasedBy": actor_uid,
        }
    )
    db.collection("orgs").document(org_id).update({"customSubdomain": None})
    logger.info(
        "subdomain_release org=%s host=%s actor=%s",
        org_id,
        hostname,
        actor_uid,
    )
    return True


# ── vanity domain ────────────────────────────────────────────────────────────


def begin_vanity_claim(
    db: Any,
    *,
    org_id: str,
    hostname: str,
    actor_uid: str,
    txt_ttl_minutes: int = 60 * 24,
) -> str:
    """Issue a TXT verification token; persist on `orgs.customDomain`.

    Returns the TXT *value* the user must place on
    `_jacob-domain-verify.<hostname>` (or just `<hostname>`).
    """
    h = hostname.lower()
    if not is_valid_hostname(h):
        raise ValueError("invalid")
    if h.endswith("." + base_domain()) or h == base_domain():
        # Vanity flow is for OFF-platform domains. `*.jacob.app`
        # uses the subdomain flow.
        raise ValueError("subdomain_required")

    claim_ref = _claim_ref(db, h)
    snap = claim_ref.get()
    if snap.exists:
        existing = snap.to_dict() or {}
        if existing.get("orgId") != org_id:
            raise ValueError("taken")
        # Re-issue token if the existing claim is still pending or
        # expired; otherwise raise to surface "already claimed".
        if existing.get("type") == "vanity" and existing.get("status") not in {
            "pending",
            "failed",
        }:
            raise ValueError("already_active")

    token_value = dns_v.generate_txt_token()
    expires_at = datetime.now(UTC) + timedelta(minutes=txt_ttl_minutes)

    claim_ref.set(
        {
            "orgId": org_id,
            "hostname": h,
            "type": "vanity",
            "status": "pending",
            "txtRecord": token_value,
            "txtRecordExpiresAt": expires_at,
            "createdBy": actor_uid,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )
    db.collection("orgs").document(org_id).update(
        {
            "customDomain": {
                "hostname": h,
                "status": "pending",
                "verifiedAt": None,
                "certStatus": "not_started",
                "txtRecord": token_value,
                "txtRecordExpiresAt": expires_at,
            }
        }
    )
    logger.info(
        "vanity_claim_begin org=%s host=%s actor=%s",
        org_id,
        h,
        actor_uid,
    )
    return token_value


def verify_vanity_claim(
    db: Any,
    *,
    org_id: str,
    actor_uid: str,
    resolver: Any | None = None,
) -> tuple[str, str]:
    """Look up the claim, query DNS, flip status if the TXT lands.

    Returns `(status, message)`. Status mirrors `customDomain.status`:
    `pending` / `verified` / `failed`.
    """
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        raise ValueError("org_not_found")
    org_data = org_snap.to_dict() or {}
    custom = (org_data.get("customDomain") or {}) if org_data else {}
    hostname = custom.get("hostname")
    expected = custom.get("txtRecord")
    if not hostname or not expected:
        raise ValueError("no_pending_claim")
    expires_at = custom.get("txtRecordExpiresAt")
    if isinstance(expires_at, datetime) and expires_at < datetime.now(UTC):
        db.collection("orgs").document(org_id).update(
            {"customDomain": {**custom, "status": "failed"}}
        )
        return "failed", "Verification window expired; restart the claim."

    found = dns_v.verify_txt_record(hostname, expected, resolver=resolver)
    if not found:
        return (
            "pending",
            f"TXT record for {hostname} not yet visible. DNS propagation can take 5–60 min.",
        )

    now = datetime.now(UTC)
    # Update the entire customDomain field rather than dotted paths so a
    # partial-write can never leave the doc in an inconsistent state.
    updated_custom = {
        **custom,
        "status": "verified",
        "verifiedAt": now,
        "certStatus": "provisioning",
    }
    db.collection("orgs").document(org_id).update({"customDomain": updated_custom})
    _claim_ref(db, hostname).update({"status": "verified", "verifiedAt": now})
    # Cloud Run domain mappings are an out-of-band operator step;
    # surface a MANUAL_ACTION_REQUIRED line so on-call sees it.
    logger.warning(
        "MANUAL_ACTION_REQUIRED domain=%s "
        "operator must run: gcloud run domain-mappings create "
        "--service jacob-backend --domain %s --region us-central1 "
        "and add %s to Identity Platform authorized domains",
        hostname,
        hostname,
        hostname,
    )
    return (
        "verified",
        "TXT record verified. An operator will provision the cert "
        "(typically 5–30 minutes). You'll receive an email when active.",
    )


def release_vanity_claim(
    db: Any,
    *,
    org_id: str,
    actor_uid: str,
) -> bool:
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        return False
    org_data = org_snap.to_dict() or {}
    custom = org_data.get("customDomain") or {}
    hostname = custom.get("hostname")
    if not hostname:
        return False
    claim_ref = _claim_ref(db, hostname)
    if claim_ref.get().exists:
        claim_ref.update(
            {
                "releasedAt": fb_firestore.SERVER_TIMESTAMP,
                "releasedBy": actor_uid,
                "status": "released",
            }
        )
    db.collection("orgs").document(org_id).update({"customDomain": None})
    logger.info(
        "vanity_release org=%s host=%s actor=%s",
        org_id,
        hostname,
        actor_uid,
    )
    return True


# ── public host → org lookup ────────────────────────────────────────────────


def lookup_org_by_host(db: Any, host: str) -> dict[str, Any] | None:
    """Return `{orgId, name, audience}` for a host, or None.

    Used by the frontend middleware to resolve `our-church.jacob.app`
    or `groups.our-church.org` → org id without an authenticated call.
    Public-by-design: only org-public metadata is returned.
    """
    h = (host or "").lower().split(":")[0]
    if not h:
        return None
    claim_snap = db.collection("domain_claims").document(h).get()
    if not claim_snap.exists:
        return None
    claim = claim_snap.to_dict() or {}
    if claim.get("releasedAt") is not None:
        return None
    if claim.get("type") == "vanity" and claim.get("status") not in {
        "verified",
        "active",
    }:
        return None
    org_id = claim.get("orgId")
    if not org_id:
        return None
    org_snap = db.collection("orgs").document(org_id).get()
    if not org_snap.exists:
        return None
    org = org_snap.to_dict() or {}
    return {
        "orgId": org_id,
        "name": org.get("name", ""),
        "audience": org.get("audience", "christian"),
        "logoUrl": org.get("logoUrl"),
        "primaryColor": org.get("primaryColor"),
    }
