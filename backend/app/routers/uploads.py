"""Photo uploads router: signed URL → quarantine → moderation → public.

The pipeline is:

1. Client `POST /api/uploads/photos` with `purpose`, `mimeType`,
   `byteCount`, optional `groupId`. Backend validates membership (for
   message uploads), records the pending upload in `uploads/{id}`, and
   returns a 5-minute signed PUT URL into the quarantine bucket.
2. Client PUTs bytes to GCS directly.
3. Client `POST /api/uploads/{id}/finalize`. Backend hashes the bytes,
   queries the CSAM hash service, runs Cloud Vision SafeSearch, and on
   pass copies the object into the public bucket. The public URL goes
   back to the client to attach to its message / profile.

The client never receives the public URL until both checks pass.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.deps import require_not_banned
from app.errors import APIError
from app.limits import UPLOAD_INIT
from app.middleware.rate_limit import limiter
from app.models.upload import (
    CreateUploadRequest,
    CreateUploadResponse,
    FinalizeUploadResponse,
    PhotoVariants,
)
from app.models.user import CurrentUser
from app.services import moderation, storage
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/uploads", tags=["uploads"])

_MIME_EXTENSIONS: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

_HTTP_451 = 451  # Unavailable For Legal Reasons


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _is_group_member(db: Any, gid: str, uid: str) -> bool:
    snap = db.collection("groups").document(gid).collection("members").document(uid).get()
    return bool(snap.exists)


def _is_group_leader(db: Any, gid: str, uid: str) -> bool:
    snap = db.collection("groups").document(gid).collection("members").document(uid).get()
    return bool(snap.exists) and (snap.to_dict() or {}).get("role") == "leader"


def _object_name(uid: str, upload_id: str, mime_type: str) -> str:
    extension = _MIME_EXTENSIONS[mime_type]
    return f"uploads/{uid}/{upload_id}.{extension}"


# ── POST /api/uploads/photos ─────────────────────────────────────────────────


@router.post(
    "/photos",
    status_code=status.HTTP_201_CREATED,
    response_model=CreateUploadResponse,
)
@limiter.limit(UPLOAD_INIT)
def create_photo_upload(
    request: Request,
    response: Response,
    body: CreateUploadRequest,
    user: CurrentUser = Depends(require_not_banned),
) -> CreateUploadResponse:
    db = _db()

    if body.purpose == "message":
        if not body.groupId:
            raise APIError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="validation_error",
                message="groupId is required for message uploads",
            )
        if not _is_group_member(db, body.groupId, user.uid):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="forbidden",
                message="Not a member of the group",
            )
    elif body.purpose == "group_avatar":
        if not body.groupId:
            raise APIError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="validation_error",
                message="groupId is required for group_avatar uploads",
            )
        group_snap = db.collection("groups").document(body.groupId).get()
        if not group_snap.exists:
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="group_not_found",
                message="Group not found",
            )
        if (group_snap.to_dict() or {}).get("archivedAt") is not None:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="archived",
                message="Cannot upload avatar to an archived group",
            )
        if not _is_group_leader(db, body.groupId, user.uid):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="forbidden",
                message="Only group leaders can upload a group avatar",
            )

    upload_id = str(uuid.uuid4())
    object_name = _object_name(user.uid, upload_id, body.mimeType)

    upload_url, expires_at = storage.generate_signed_put_url(
        object_name=object_name,
        content_type=body.mimeType,
        byte_count=body.byteCount,
    )

    db.collection("uploads").document(upload_id).set(
        {
            "uploadId": upload_id,
            "uploaderUid": user.uid,
            "purpose": body.purpose,
            "groupId": body.groupId,
            "mimeType": body.mimeType,
            "byteCount": body.byteCount,
            "objectName": object_name,
            "status": "pending",
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
        }
    )

    logger.info(
        "upload init upload_id=%s uid=%s purpose=%s",
        upload_id,
        user.uid,
        body.purpose,
    )
    return CreateUploadResponse(
        uploadId=upload_id,
        uploadUrl=upload_url,
        expiresAt=expires_at.isoformat(),
    )


# ── POST /api/uploads/{upload_id}/finalize ───────────────────────────────────


@router.post("/{upload_id}/finalize", response_model=FinalizeUploadResponse)
def finalize_upload(
    upload_id: str,
    user: CurrentUser = Depends(require_not_banned),
) -> FinalizeUploadResponse:
    db = _db()
    doc_ref = db.collection("uploads").document(upload_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="upload_not_found",
            message="Upload not found",
        )
    upload = snap.to_dict() or {}
    if upload.get("uploaderUid") != user.uid:
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Not the uploader",
        )
    if upload.get("status") != "pending":
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="upload_already_finalized",
            message="Upload already processed",
        )

    object_name: str = upload["objectName"]
    content_type: str = upload["mimeType"]

    try:
        image_bytes = storage.download_quarantine_object(object_name)
    except Exception as exc:
        logger.warning("upload missing in quarantine upload_id=%s err=%s", upload_id, exc)
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="upload_missing",
            message="No object found in quarantine for this upload",
        ) from None

    image_hash = moderation.hash_image(image_bytes)
    size_bytes = len(image_bytes)
    hash_result = moderation.check_hash_service(
        image_hash,
        size_bytes=size_bytes,
        content_type=content_type,
    )
    if hash_result.matched:
        storage.quarantine_permanently(object_name)
        db.collection("moderation_queue").document(upload_id).set(
            {
                "resourceRef": f"uploads/{upload_id}",
                "reason": "csam_hash_match",
                "status": "pending",
                "uploaderUid": user.uid,
                "imageHash": image_hash,
                "hashSource": hash_result.source,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
            }
        )
        moderation.report_to_ncmec(
            image_hash=image_hash,
            uploader_uid=user.uid,
            object_name=object_name,
            db=db,
            hash_source=hash_result.source,
            size_bytes=size_bytes,
            content_type=content_type,
        )
        doc_ref.update({"status": "rejected_csam"})
        logger.error(
            "upload rejected csam upload_id=%s uid=%s",
            upload_id,
            user.uid,
        )
        raise APIError(
            status_code=_HTTP_451,
            code="csam_hash_match",
            message="Upload rejected",
        )

    safesearch = moderation.check_safesearch(image_bytes)
    if safesearch.verdict == "fail":
        storage.quarantine_permanently(object_name)
        db.collection("moderation_queue").document(upload_id).set(
            {
                "resourceRef": f"uploads/{upload_id}",
                "reason": f"safesearch_{safesearch.reason}",
                "status": "pending",
                "uploaderUid": user.uid,
                "createdAt": fb_firestore.SERVER_TIMESTAMP,
            }
        )
        doc_ref.update({"status": "rejected_safesearch"})
        logger.warning(
            "upload rejected safesearch upload_id=%s reason=%s",
            upload_id,
            safesearch.reason,
        )
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="safesearch_blocked",
            message="Image rejected by safety review",
            details={"reason": safesearch.reason or "unknown"},
        )

    public_url = storage.promote_to_public(object_name, content_type=content_type)
    doc_ref.update({"status": "approved", "publicUrl": public_url})
    logger.info("upload approved upload_id=%s uid=%s", upload_id, user.uid)

    variants: PhotoVariants | None = None
    thumbnail_url: str | None = None
    if get_settings().jacob_photo_variants_enabled:
        raw = storage.derive_variant_urls(public_url)
        variants = PhotoVariants(w320=raw["w320"], w640=raw["w640"], w1280=raw["w1280"])
        thumbnail_url = raw["w320"]

    return FinalizeUploadResponse(
        publicUrl=public_url,
        thumbnailUrl=thumbnail_url,
        variants=variants,
    )
