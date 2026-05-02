"""Image-moderation pipeline pieces: SafeSearch, CSAM hash check, NCMEC stub.

Set `JACOB_DISABLE_MODERATION=true` in dev / emulator runs to bypass
external API calls (SafeSearch returns "pass", hash service returns
"no match"). Production deployments must leave it unset; the lawyer-
review checklist in `docs/moderation-pipeline.md` covers the launch
gates that depend on these calls being live.

`google.cloud.vision` is imported lazily so the module loads in
environments where the SDK isn't installed (tests).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import urllib.request
from dataclasses import dataclass
from typing import Literal

try:
    import sentry_sdk as _sentry_sdk
except ImportError:  # pragma: no cover
    _sentry_sdk = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

DISABLE_MODERATION_ENV = "JACOB_DISABLE_MODERATION"
HASH_SERVICE_URL_ENV = "JACOB_HASH_SERVICE_URL"
NCMEC_ENDPOINT_ENV = "JACOB_NCMEC_ENDPOINT"

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
    return os.environ.get(DISABLE_MODERATION_ENV, "").lower() in {"1", "true", "yes"}


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


def check_hash_service(image_hash: str) -> HashCheckResult:
    """CSAM hash lookup. Stub HTTP shape — vendor TBD before launch.

    The endpoint is expected to accept `{"hash": "<sha256>"}` and return
    `{"matched": bool, "source": "<list-name>"}`. Real integration must
    be in place before opening uploads to real users (see lawyer-review
    checklist in `docs/moderation-pipeline.md`).
    """
    if moderation_disabled():
        return HashCheckResult(matched=False)

    endpoint = os.environ.get(HASH_SERVICE_URL_ENV)
    if not endpoint:
        msg = "CSAM hash service URL unset (JACOB_HASH_SERVICE_URL); rejecting upload"
        logger.error(msg)
        if _sentry_sdk is not None:
            _sentry_sdk.capture_message(msg, level="error")
        raise RuntimeError(msg)

    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"hash": image_hash}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310 - configured endpoint
        body = json.loads(resp.read().decode())
    return HashCheckResult(matched=bool(body.get("matched")), source=body.get("source"))


def report_to_ncmec(*, image_hash: str, uploader_uid: str, object_name: str) -> None:
    """NCMEC report stub.

    In v1 we only log + record the intent. Real submission to the
    CyberTipline must be wired up before launch — see lawyer-review
    checklist. The error log makes the gap loud during pre-launch QA.
    """
    endpoint = os.environ.get(NCMEC_ENDPOINT_ENV)
    logger.error(
        "ncmec_report_stub hash=%s uploader=%s object=%s endpoint=%s",
        image_hash,
        uploader_uid,
        object_name,
        endpoint or "<unset>",
    )
