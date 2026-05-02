"""Google Cloud Storage helpers for the moderation pipeline.

Two buckets are involved:

* **Quarantine** — receives every direct upload via signed PUT. Objects
  here are private. The backend reads from it during finalization.
* **Public** — CDN-served, public reads. Only the moderation pipeline,
  running with a narrowly-scoped service account, may write.

All `google.cloud.storage` imports are lazy so test environments without
the SDK installed (and without ADC available) can import this module
freely. Tests mock `_client()` and the public functions directly.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

from app.errors import APIError

QUARANTINE_BUCKET_ENV = "JACOB_MEDIA_QUARANTINE_BUCKET"
PUBLIC_BUCKET_ENV = "JACOB_MEDIA_PUBLIC_BUCKET"
SIGNED_URL_TTL_MINUTES = 5


def _bucket_name(env_var: str) -> str:
    value = os.environ.get(env_var)
    if not value:
        raise APIError(
            status_code=500,
            code="config_error",
            message=f"Missing storage bucket env var: {env_var}",
        )
    return value


def quarantine_bucket_name() -> str:
    return _bucket_name(QUARANTINE_BUCKET_ENV)


def public_bucket_name() -> str:
    return _bucket_name(PUBLIC_BUCKET_ENV)


def _client() -> Any:
    # `google.cloud.storage` is deferred so this module loads in test
    # environments without the SDK installed.
    import importlib

    storage = importlib.import_module("google.cloud.storage")
    return storage.Client()


def generate_signed_put_url(
    *, object_name: str, content_type: str, byte_count: int
) -> tuple[str, datetime]:
    """5-minute V4 signed PUT URL into the quarantine bucket.

    The signed URL pins both `Content-Type` and `Content-Length`, so the
    GCS layer rejects oversize uploads before the bytes ever land. This
    is a defense-in-depth check on top of the API-level validation.
    """
    bucket = _client().bucket(quarantine_bucket_name())
    blob = bucket.blob(object_name)
    expires_at = datetime.now(UTC) + timedelta(minutes=SIGNED_URL_TTL_MINUTES)
    url = blob.generate_signed_url(
        version="v4",
        expiration=expires_at,
        method="PUT",
        content_type=content_type,
        headers={"Content-Length": str(byte_count)},
    )
    return url, expires_at


def download_quarantine_object(object_name: str) -> bytes:
    blob = _client().bucket(quarantine_bucket_name()).blob(object_name)
    return bytes(blob.download_as_bytes())


def promote_to_public(object_name: str, *, content_type: str) -> str:
    """Copy quarantine → public, delete the source, return the public URL.

    The destination blob is given immutable cache headers so the CDN can
    serve it indefinitely (the URL itself is unique per upload).
    """
    client = _client()
    quarantine = client.bucket(quarantine_bucket_name())
    public = client.bucket(public_bucket_name())
    src_blob = quarantine.blob(object_name)
    dst_blob = quarantine.copy_blob(src_blob, public, new_name=object_name)
    dst_blob.content_type = content_type
    dst_blob.cache_control = "public, max-age=31536000, immutable"
    dst_blob.patch()
    src_blob.delete()
    return f"https://storage.googleapis.com/{public.name}/{object_name}"


def quarantine_permanently(object_name: str) -> None:
    """Move the object under `_held/` so it stays out of the 90-day TTL.

    Used for SafeSearch failures and CSAM hash hits — we keep the bytes
    around for forensics / law-enforcement requests rather than deleting.
    """
    client = _client()
    quarantine = client.bucket(quarantine_bucket_name())
    src_blob = quarantine.blob(object_name)
    quarantine.copy_blob(src_blob, quarantine, new_name=f"_held/{object_name}")
    src_blob.delete()
