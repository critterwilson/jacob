"""Image-moderation pipeline pieces: SafeSearch, CSAM hash check, NCMEC stub.

Set `JACOB_DISABLE_MODERATION=true` in dev / emulator runs to bypass
external API calls (SafeSearch returns "pass", hash service returns
"no match"). Production deployments must leave it unset; the lawyer-
review checklist in `docs/moderation-pipeline.md` covers the launch
gates that depend on these calls being live.

CSAM hash provider selection (C2):

* `JACOB_HASH_PROVIDER` is the new explicit knob. Values:

    - `disabled` — no-op, all uploads allowed. Default in `development`.
    - `noop`     — same behaviour, but each call logs a WARNING so the
                   bypass is loud (use this in staging while a hash
                   service is being commissioned).
    - any URL    — POST `{"hash": "<sha256>"}` to that endpoint.

* `JACOB_HASH_SERVICE_URL` is the legacy URL-only var. Still honoured
  when `JACOB_HASH_PROVIDER` is unset, so existing deploys keep working.

* In production (`environment != "development"`), the provider MUST be
  explicitly configured. An unset / blank provider raises and rejects
  the upload. This is the legal-exposure gate the review (C2) called
  for: bypassing CSAM scanning has to be a deliberate choice, never a
  default.

`google.cloud.vision` is imported lazily so the module loads in
environments where the SDK isn't installed (tests).
"""

from __future__ import annotations

import hashlib
import json
import logging
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal

try:
    import sentry_sdk as _sentry_sdk
except ImportError:  # pragma: no cover
    _sentry_sdk = None  # type: ignore[assignment]

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Env var name aliases — kept as strings so tests can ``monkeypatch.setenv``
# via the symbolic name. The actual values flow through pydantic-settings
# (M5 — see app/config.py).
DISABLE_MODERATION_ENV = "JACOB_DISABLE_MODERATION"
HASH_PROVIDER_ENV = "JACOB_HASH_PROVIDER"
HASH_SERVICE_URL_ENV = "JACOB_HASH_SERVICE_URL"
NCMEC_ENDPOINT_ENV = "JACOB_NCMEC_ENDPOINT"
# C3 — explicit kill-switch for automatic NCMEC submission. Default true
# because the HTTPS integration isn't wired in v1; flipping this to false
# is meaningless until that lands. Operators handle submission manually
# via /admin/ncmec — see docs/runbooks/csam-incident.md.
NCMEC_AUTOSUBMIT_DISABLED_ENV = "JACOB_NCMEC_SUBMIT_DISABLED"

# Recognised non-URL provider sentinels.
_PROVIDER_DISABLED = "disabled"
_PROVIDER_NOOP = "noop"

SafeSearchVerdict = Literal["pass", "fail"]


@dataclass(frozen=True)
class SafeSearchResult:
    verdict: SafeSearchVerdict
    reason: str | None = None


@dataclass(frozen=True)
class HashCheckResult:
    matched: bool
    source: str | None = None


def moderation_disabled() -> bool:
    return Settings().jacob_disable_moderation


def hash_image(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def check_safesearch(image_bytes: bytes) -> SafeSearchResult:
    """Block images where adult, violence, or racy is LIKELY/VERY_LIKELY."""
    if moderation_disabled():
        return SafeSearchResult(verdict="pass")

    from google.cloud import vision

    client = vision.ImageAnnotatorClient()
    response = client.safe_search_detection(image=vision.Image(content=image_bytes))
    annotation = response.safe_search_annotation
    blocking = (vision.Likelihood.LIKELY, vision.Likelihood.VERY_LIKELY)
    for field in ("adult", "violence", "racy"):
        if getattr(annotation, field) in blocking:
            return SafeSearchResult(verdict="fail", reason=field)
    return SafeSearchResult(verdict="pass")


def _resolve_hash_provider() -> str:
    """Resolve the active CSAM hash provider.

    Returns one of: ``""`` (unset → caller fails closed in production,
    silently disabled in dev), ``"disabled"``, ``"noop"``, or a URL.
    """
    settings = Settings()
    explicit = (settings.jacob_hash_provider or "").strip()
    if explicit:
        return explicit
    legacy_url = (settings.jacob_hash_service_url or "").strip()
    if legacy_url:
        return legacy_url
    if get_settings().environment == "development":
        return _PROVIDER_DISABLED
    return ""


def check_hash_service(
    image_hash: str,
    *,
    size_bytes: int | None = None,
    content_type: str | None = None,
) -> HashCheckResult:
    """CSAM hash lookup. Stub HTTP shape — vendor TBD before launch.

    The endpoint is expected to accept `{"hash": "<sha256>"}` and return
    `{"matched": bool, "source": "<list-name>"}`. Real integration must
    be in place before opening uploads to real users (see lawyer-review
    checklist in `docs/moderation-pipeline.md`).

    ``size_bytes`` and ``content_type`` are accepted (M6) so callers can
    thread upload metadata through the moderation chain and the on-call
    operator-queue evidence dict stops showing 0/null.
    """
    if size_bytes is not None or content_type is not None:
        logger.debug(
            "csam_hash_check hash=%s size_bytes=%s content_type=%s",
            image_hash,
            size_bytes,
            content_type,
        )

    if moderation_disabled():
        return HashCheckResult(matched=False)

    provider = _resolve_hash_provider()
    if not provider:
        msg = (
            "CSAM hash provider unset (JACOB_HASH_PROVIDER); rejecting upload. "
            "In production, set JACOB_HASH_PROVIDER to a URL or to "
            "'disabled'/'noop' to deliberately bypass scanning — "
            "see docs/runbooks/csam-incident.md."
        )
        logger.error(msg)
        if _sentry_sdk is not None:
            _sentry_sdk.capture_message(msg, level="error")
        raise RuntimeError(msg)

    if provider == _PROVIDER_DISABLED:
        return HashCheckResult(matched=False)

    if provider == _PROVIDER_NOOP:
        logger.warning(
            "csam_hash_check_noop hash=%s — JACOB_HASH_PROVIDER=noop, scan bypassed",
            image_hash,
        )
        return HashCheckResult(matched=False)

    if not (provider.startswith("http://") or provider.startswith("https://")):
        msg = (
            f"JACOB_HASH_PROVIDER='{provider}' is not a recognised sentinel "
            "('disabled', 'noop') and not an http(s) URL; rejecting upload"
        )
        logger.error(msg)
        if _sentry_sdk is not None:
            _sentry_sdk.capture_message(msg, level="error")
        raise RuntimeError(msg)

    req = urllib.request.Request(
        provider,
        data=json.dumps({"hash": image_hash}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310 - configured endpoint
        body = json.loads(resp.read().decode())
    return HashCheckResult(matched=bool(body.get("matched")), source=body.get("source"))


def ncmec_autosubmit_disabled() -> bool:
    """Return True when the auto-submit-to-NCMEC kill-switch is on.

    Defaults to True so the HTTPS-call path stays inert until the
    integration is deliberately enabled (which today means: there is
    no integration, so this always defaults to disabled).
    """
    return Settings().jacob_ncmec_submit_disabled


def report_to_ncmec(
    *,
    image_hash: str,
    uploader_uid: str,
    object_name: str,
    db: Any | None = None,
    hash_source: str | None = None,
    size_bytes: int | None = None,
    content_type: str | None = None,
) -> str | None:
    """Surface a CSAM hash match for operator handling (C3).

    Behaviour, when called by the upload-finalize path:

    * Always logs at CRITICAL with the case shape so the bypass is loud
      in Cloud Logging and trips dashboards / Sentry.
    * If `db` is supplied, creates a row in `ncmec_cases` (the operator
      queue surfaced at `/admin/ncmec` — same collection the case
      service uses) so the manual-handoff queue lights up automatically
      on each detection. Returns the case id; otherwise returns None.

    The HTTPS call to NCMEC's CyberTipline is intentionally NOT made.
    `JACOB_NCMEC_SUBMIT_DISABLED` (default true) is the kill-switch for
    that path; until the integration lands, every detection becomes a
    "manual NCMEC submission required" line in the runbook. See
    `docs/runbooks/csam-incident.md` for the operator workflow.
    """
    endpoint = Settings().jacob_ncmec_endpoint or None
    autosubmit_disabled = ncmec_autosubmit_disabled()
    logger.critical(
        "MANUAL_ACTION_REQUIRED ncmec_report hash=%s uploader=%s object=%s "
        "endpoint=%s autosubmit_disabled=%s — operator must file "
        "manually via /admin/ncmec (see docs/runbooks/csam-incident.md).",
        image_hash,
        uploader_uid,
        object_name,
        endpoint or "<unset>",
        autosubmit_disabled,
    )

    case_id: str | None = None
    if db is not None:
        # Lazy-import to avoid a circular ncmec ↔ moderation pull-in at
        # module load time.
        from app.services import ncmec as ncmec_service

        case_id = ncmec_service.create_case(
            db,
            hash_source=hash_source or "upload_pipeline",
            hash_value=image_hash,
            evidence={
                "gcsPath": object_name,
                "sha256": image_hash,
                "source": "upload_finalize",
                # M6 — operator queue previously surfaced 0 / null for these.
                "sizeBytes": size_bytes,
                "contentType": content_type,
            },
            suspect_uid=uploader_uid,
        )
    return case_id
