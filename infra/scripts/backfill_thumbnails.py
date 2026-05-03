"""T37 — Backfill 320/640/1280 JPEG variants for existing public photos.

Lists every object under `uploads/` in the public bucket, checks whether
all three derived variants exist, and generates the missing ones using
Pillow. Idempotent — re-running converges to the same state.

Usage:

    JACOB_MEDIA_PUBLIC_BUCKET=jacob-media-public-staging \\
    python infra/scripts/backfill_thumbnails.py --dry-run

    JACOB_MEDIA_PUBLIC_BUCKET=jacob-media-public-staging \\
    python infra/scripts/backfill_thumbnails.py --apply

Dependencies (not in pyproject.toml — run in a separate venv):
    pip install google-cloud-storage Pillow
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import re
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from google.cloud import storage as gcs_lib

logger = logging.getLogger("backfill_thumbnails")

WIDTHS = (320, 640, 1280)
QUALITY: dict[int, int] = {320: 80, 640: 85, 1280: 90}


def _derived_name(uploads_name: str, width: int) -> str:
    """Map uploads/{uid}/{id}.ext → derived/{uid}/{id}_{width}.jpg."""
    without_ext = re.sub(r"\.[^/.]+$", "", uploads_name.replace("uploads/", "derived/", 1))
    return f"{without_ext}_{width}.jpg"


def _resize_jpeg(image_bytes: bytes, width: int) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as img:
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        orig_w, orig_h = img.size
        if orig_w > width:
            new_h = int(orig_h * width / orig_w)
            img = img.resize((width, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=QUALITY[width], optimize=True)
        return buf.getvalue()


def run(*, bucket: "gcs_lib.Bucket", dry_run: bool) -> dict[str, int]:
    stats = {"checked": 0, "skipped": 0, "derived": 0, "failed": 0}

    blobs = list(bucket.list_blobs(prefix="uploads/"))
    logger.info("found %d objects under uploads/", len(blobs))

    for blob in blobs:
        if not blob.content_type or not blob.content_type.startswith("image/"):
            continue
        stats["checked"] += 1

        derived_names = [_derived_name(blob.name, w) for w in WIDTHS]
        exist_checks = [bucket.blob(n).exists() for n in derived_names]

        if all(exist_checks):
            stats["skipped"] += 1
            logger.debug("skip %s — all variants exist", blob.name)
            continue

        if dry_run:
            logger.info("[dry-run] would derive %s", blob.name)
            stats["derived"] += 1
            continue

        try:
            image_bytes = blob.download_as_bytes()
            for width, derived_name, exists in zip(WIDTHS, derived_names, exist_checks):
                if exists:
                    continue
                resized = _resize_jpeg(image_bytes, width)
                bucket.blob(derived_name).upload_from_string(
                    resized,
                    content_type="image/jpeg",
                )
                logger.info("derived %s", derived_name)
            stats["derived"] += 1
        except Exception:
            logger.exception("failed to derive variants for %s", blob.name)
            stats["failed"] += 1

    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Backfill photo size variants.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Log actions without writing.")
    group.add_argument("--apply", action="store_true", help="Write derived variants to GCS.")
    args = parser.parse_args()

    bucket_name = os.environ.get("JACOB_MEDIA_PUBLIC_BUCKET")
    if not bucket_name:
        logger.error("JACOB_MEDIA_PUBLIC_BUCKET env var is required")
        sys.exit(1)

    from google.cloud import storage as gcs_lib

    client = gcs_lib.Client()
    bucket = client.bucket(bucket_name)

    stats = run(bucket=bucket, dry_run=args.dry_run)
    mode = "dry-run" if args.dry_run else "apply"
    logger.info(
        "[%s] checked=%d skipped=%d derived=%d failed=%d",
        mode,
        stats["checked"],
        stats["skipped"],
        stats["derived"],
        stats["failed"],
    )
    if stats["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
