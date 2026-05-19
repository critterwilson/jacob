"""Sermon-archive router (T52).

Endpoints:

* `GET    /api/groups/{gid}/sermons`            — group members
* `GET    /api/groups/{gid}/sermons/{sermonId}` — group members
* `POST   /api/groups/{gid}/sermons`            — leaders / org admins
* `PATCH  /api/groups/{gid}/sermons/{sermonId}` — leaders
* `DELETE /api/groups/{gid}/sermons/{sermonId}` — leaders (soft delete)

Per M6 the underlying `groups/{gid}/sermons/{sermonId}` collection
default-denies client access; this is the only path in.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    require_leader,
    require_member,
)
from app.errors import APIError
from app.limits import GROUP_READ, SERMON_MUTATION
from app.middleware.rate_limit import limiter
from app.models.sermons import (
    Sermon,
    SermonCreateRequest,
    SermonListResponse,
    SermonUpdateRequest,
)
from app.services import sermons as sermons_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups/{gid}/sermons", tags=["sermons"])


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


def _doc_to_sermon(snap: Any) -> Sermon:
    data: dict[str, Any] = snap.to_dict() or {}
    return Sermon(
        sermonId=snap.id,
        title=str(data.get("title", "")),
        preacher=data.get("preacher"),
        scripture=data.get("scripture"),
        sermonDate=_ts_to_str(data.get("sermonDate")),
        sourceUrl=str(data.get("sourceUrl", "")),
        sourceType=data.get("sourceType", "other"),
        thumbnail=data.get("thumbnail"),
        addedBy=str(data.get("addedBy", "")),
        addedAt=_ts_to_str(data.get("addedAt")),
        deletedAt=_ts_to_str(data.get("deletedAt")),
    )


@router.get("", response_model=SermonListResponse)
@limiter.limit(GROUP_READ)
def list_sermons(
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> SermonListResponse:
    db = _db()
    sermons: list[Sermon] = []
    preachers: set[str] = set()
    for snap in db.collection("groups").document(gid).collection("sermons").stream():
        sermon = _doc_to_sermon(snap)
        if sermon.deletedAt is not None:
            continue
        sermons.append(sermon)
        if sermon.preacher:
            preachers.add(sermon.preacher)
    sermons.sort(key=lambda s: s.sermonDate or "", reverse=True)
    return SermonListResponse(
        sermons=sermons,
        preachers=sorted(preachers),
    )


@router.get("/{sermon_id}", response_model=Sermon)
@limiter.limit(GROUP_READ)
def get_sermon(
    sermon_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> Sermon:
    db = _db()
    snap = db.collection("groups").document(gid).collection("sermons").document(sermon_id).get()
    if not snap.exists or (snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sermon_not_found",
            message="Sermon not found",
        )
    return _doc_to_sermon(snap)


@router.post(
    "",
    response_model=Sermon,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(SERMON_MUTATION)
def add_sermon(
    body: SermonCreateRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Sermon:
    db = _db()
    if (membership.group or {}).get("archivedAt"):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="group_archived",
            message="Cannot add sermons to an archived group",
        )

    source_url = str(body.sourceUrl)
    source_type = sermons_service.detect_source_type(source_url)

    title = body.title
    thumbnail: str | None = None
    if source_type == "youtube" and (not title or not body.preacher):
        oembed = sermons_service.fetch_youtube_oembed(source_url)
        if oembed:
            title = title or oembed.get("title")
            thumbnail = oembed.get("thumbnail")

    if not title:
        title = source_url

    sermon_id = str(uuid.uuid4())
    sermon_date_value: Any = None
    if body.sermonDate:
        # Stored as midnight UTC on the day so the order-by uses a
        # consistent timestamp.
        try:
            sermon_date_value = datetime.fromisoformat(body.sermonDate).replace(tzinfo=UTC)
        except ValueError as exc:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_date",
                message="sermonDate must be ISO YYYY-MM-DD",
            ) from exc

    sermon_ref = db.collection("groups").document(gid).collection("sermons").document(sermon_id)
    sermon_ref.set(
        {
            "title": title,
            "preacher": body.preacher,
            "scripture": body.scripture,
            "sermonDate": sermon_date_value,
            "sourceUrl": source_url,
            "sourceType": source_type,
            "thumbnail": thumbnail,
            "addedBy": membership.uid,
            "addedAt": fb_firestore.SERVER_TIMESTAMP,
            "deletedAt": None,
        }
    )
    write_audit_log(
        actor_uid=membership.uid,
        action="sermon_add",
        target_ref=f"groups/{gid}/sermons/{sermon_id}",
        payload={
            "sourceType": source_type,
            "preacher": body.preacher,
        },
    )
    snap = sermon_ref.get()
    return _doc_to_sermon(snap)


@router.patch("/{sermon_id}", response_model=Sermon)
@limiter.limit(SERMON_MUTATION)
def update_sermon(
    sermon_id: str,
    body: SermonUpdateRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Sermon:
    db = _db()
    sermon_ref = db.collection("groups").document(gid).collection("sermons").document(sermon_id)
    snap = sermon_ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sermon_not_found",
            message="Sermon not found",
        )
    update: dict[str, Any] = {}
    if body.title is not None:
        update["title"] = body.title
    if body.preacher is not None:
        update["preacher"] = body.preacher
    if body.scripture is not None:
        update["scripture"] = body.scripture
    if body.sermonDate is not None:
        try:
            update["sermonDate"] = datetime.fromisoformat(body.sermonDate).replace(tzinfo=UTC)
        except ValueError as exc:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_date",
                message="sermonDate must be ISO YYYY-MM-DD",
            ) from exc
    if not update:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_update",
            message="No mutable fields supplied",
        )
    sermon_ref.update(update)
    write_audit_log(
        actor_uid=membership.uid,
        action="sermon_update",
        target_ref=f"groups/{gid}/sermons/{sermon_id}",
        payload={"changedKeys": sorted(update.keys())},
    )
    return _doc_to_sermon(sermon_ref.get())


@router.delete("/{sermon_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(SERMON_MUTATION)
def delete_sermon(
    sermon_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_leader),
) -> Response:
    db = _db()
    sermon_ref = db.collection("groups").document(gid).collection("sermons").document(sermon_id)
    snap = sermon_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sermon_not_found",
            message="Sermon not found",
        )
    if (snap.to_dict() or {}).get("deletedAt") is None:
        sermon_ref.update({"deletedAt": fb_firestore.SERVER_TIMESTAMP})
        write_audit_log(
            actor_uid=membership.uid,
            action="sermon_delete",
            target_ref=f"groups/{gid}/sermons/{sermon_id}",
            payload={},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
