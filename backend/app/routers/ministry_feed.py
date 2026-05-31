"""Central ministry feed router (ADR 0011).

The ministry feed is a top-level broadcast surface — one collection
(`ministry_feed/{postId}`), one writer role (`ministry_owner` custom
claim), and read access for every signed-in member of the platform.
Per-group sermon and announcement surfaces are unaffected.

Reactions reuse the same `reactions/{slug}/users/{uid}` primitive as
boards + group messages, denormed by `onMinistryReactionWrite` in
`functions/`.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_ministry_owner, require_not_banned
from app.errors import APIError
from app.limits import (
    MINISTRY_FEED_LIST,
    MINISTRY_POST_CREATE,
    MINISTRY_POST_DELETE,
    MINISTRY_POST_EDIT,
    MINISTRY_POST_PIN,
    MINISTRY_POST_READ,
    REACTION_TOGGLE,
)
from app.middleware.rate_limit import limiter
from app.models.ministry_feed import (
    CreateMinistryPostRequest,
    MinistryPost,
    MinistryPostsResponse,
    MinistryReactionRemovedResponse,
    MinistryReactionResponse,
    PinMinistryPostResponse,
    UpdateMinistryPostRequest,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ministry-feed", tags=["ministry-feed"])

_PAGE_DEFAULT = 20
_PAGE_MAX = 100
_GCS_PUBLIC_PREFIX = "https://storage.googleapis.com/jacob-media-public-"


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


def _ts_to_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    converter = getattr(value, "ToDatetime", None)
    if callable(converter):
        try:
            result = converter(tzinfo=UTC)
        except TypeError:
            result = converter()
        if isinstance(result, datetime):
            return result if result.tzinfo else result.replace(tzinfo=UTC)
    return None


def _doc_to_post(doc_id: str, data: dict[str, Any]) -> MinistryPost:
    return MinistryPost(
        postId=doc_id,
        title=str(data.get("title") or ""),
        body=str(data.get("body") or ""),
        sermonUrl=data.get("sermonUrl"),
        coverImageRef=data.get("coverImageRef"),
        authorUid=str(data.get("authorUid") or ""),
        createdAt=_ts_to_dt(data.get("createdAt")),
        editedAt=_ts_to_dt(data.get("editedAt")),
        deletedAt=_ts_to_dt(data.get("deletedAt")),
        pinnedAt=_ts_to_dt(data.get("pinnedAt")),
        pinnedBy=data.get("pinnedBy"),
        reactionCounts={str(k): int(v) for k, v in (data.get("reactionCounts") or {}).items()},
    )


def _validate_cover_image_ref(ref: str | None) -> None:
    if ref is None:
        return
    if not ref.startswith(_GCS_PUBLIC_PREFIX):
        raise APIError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_cover_image_ref",
            message="coverImageRef must point to the public GCS bucket",
            details={"badRef": ref},
        )


def _encode_cursor(created_at: datetime, doc_id: str, pinned_at: datetime | None) -> str:
    pinned_str = pinned_at.isoformat() if pinned_at is not None else ""
    payload = f"{created_at.isoformat()}|{doc_id}|{pinned_str}".encode()
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str, datetime | None] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        parts = raw.split("|", 2)
        if len(parts) == 2:
            ts_str, doc_id = parts
            return datetime.fromisoformat(ts_str), doc_id, None
        ts_str, doc_id, pinned_str = parts
        pinned_at = datetime.fromisoformat(pinned_str) if pinned_str else None
        return datetime.fromisoformat(ts_str), doc_id, pinned_at
    except Exception:  # noqa: BLE001
        return None


# ── reads ────────────────────────────────────────────────────────────────


@router.get("/posts", response_model=MinistryPostsResponse)
@limiter.limit(MINISTRY_FEED_LIST)
def list_ministry_posts(
    request: Request,
    response: Response,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_DEFAULT, ge=1, le=_PAGE_MAX),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: CurrentUser = Depends(get_current_user),
) -> Any:
    """List ministry-feed posts in pinned-first, newest-first order.

    Excludes soft-deleted posts. Cursor mirrors the boards pattern so
    pinned-bucket boundaries don't drop posts between pages.
    """
    db = _db()
    # Internal collection name kept as "ministry_feed"; user-facing term is "Ministry"
    # (rebrand PR #302). Renaming would require a data migration of Firestore documents.
    col = db.collection("ministry_feed")
    query = (
        col.where("deletedAt", "==", None)
        .order_by("pinnedAt", direction=fb_firestore.Query.DESCENDING)
        .order_by("createdAt", direction=fb_firestore.Query.DESCENDING)
    )

    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_cursor",
                message="Cursor is malformed",
            )
        cursor_ts, cursor_doc_id, cursor_pinned_at = decoded
        query = query.order_by("__name__", direction=fb_firestore.Query.DESCENDING).start_after(
            {
                "pinnedAt": cursor_pinned_at,
                "createdAt": cursor_ts,
                "__name__": cursor_doc_id,
            }
        )

    query = query.limit(limit + 1)
    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]

    posts = [_doc_to_post(s.id, s.to_dict() or {}) for s in snaps]

    next_cursor: str | None = None
    if has_more and snaps:
        last = snaps[-1].to_dict() or {}
        last_ts = _ts_to_dt(last.get("createdAt"))
        last_pinned = _ts_to_dt(last.get("pinnedAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id, last_pinned)

    payload = MinistryPostsResponse(posts=posts, nextCursor=next_cursor)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'
    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return payload


@router.get("/posts/{post_id}", response_model=MinistryPost)
@limiter.limit(MINISTRY_POST_READ)
def get_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> MinistryPost:
    db = _db()
    snap = db.collection("ministry_feed").document(post_id).get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    data = snap.to_dict() or {}
    if data.get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    return _doc_to_post(snap.id, data)


# ── writes (ministry-owner only) ─────────────────────────────────────────


@router.post(
    "/posts",
    response_model=MinistryPost,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(MINISTRY_POST_CREATE)
def create_ministry_post(
    request: Request,
    response: Response,
    body: CreateMinistryPostRequest,
    user: CurrentUser = Depends(require_ministry_owner),
) -> MinistryPost:
    _validate_cover_image_ref(body.coverImageRef)
    db = _db()
    new_ref = db.collection("ministry_feed").document()
    payload: dict[str, Any] = {
        "title": body.title.strip(),
        "body": body.body,
        "sermonUrl": str(body.sermonUrl) if body.sermonUrl is not None else None,
        "coverImageRef": body.coverImageRef,
        "authorUid": user.uid,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "editedAt": None,
        "deletedAt": None,
        "pinnedAt": None,
        "pinnedBy": None,
    }
    new_ref.set(payload)
    write_audit_log(
        actor_uid=user.uid,
        action="ministry_post.create",
        target_ref=f"ministry_feed/{new_ref.id}",
        payload={"title": payload["title"]},
    )
    logger.info("ministry post created post_id=%s actor=%s", new_ref.id, user.uid)
    fresh = new_ref.get()
    return _doc_to_post(fresh.id, fresh.to_dict() or {})


@router.patch("/posts/{post_id}", response_model=MinistryPost)
@limiter.limit(MINISTRY_POST_EDIT)
def update_ministry_post(
    request: Request,
    response: Response,
    body: UpdateMinistryPostRequest,
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_ministry_owner),
) -> MinistryPost:
    _validate_cover_image_ref(body.coverImageRef)
    db = _db()
    ref = db.collection("ministry_feed").document(post_id)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    data = snap.to_dict() or {}
    if data.get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="deleted",
            message="Cannot edit a deleted post",
        )

    updates: dict[str, Any] = {"editedAt": fb_firestore.SERVER_TIMESTAMP}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.body is not None:
        updates["body"] = body.body
    # `sermonUrl` and `coverImageRef` are explicitly nullable to allow
    # clearing — distinguish "field omitted" from "field set to null".
    fields_set = body.model_fields_set
    if "sermonUrl" in fields_set:
        updates["sermonUrl"] = str(body.sermonUrl) if body.sermonUrl is not None else None
    if "coverImageRef" in fields_set:
        updates["coverImageRef"] = body.coverImageRef
    ref.update(updates)
    write_audit_log(
        actor_uid=user.uid,
        action="ministry_post.update",
        target_ref=f"ministry_feed/{post_id}",
        payload={"fields": sorted(fields_set)},
    )
    fresh = ref.get()
    return _doc_to_post(fresh.id, fresh.to_dict() or {})


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(MINISTRY_POST_DELETE)
def delete_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_ministry_owner),
) -> Response:
    """Soft-delete a post. Idempotent."""
    db = _db()
    ref = db.collection("ministry_feed").document(post_id)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    if (snap.to_dict() or {}).get("deletedAt") is None:
        ref.update({"deletedAt": fb_firestore.SERVER_TIMESTAMP})
        write_audit_log(
            actor_uid=user.uid,
            action="ministry_post.delete",
            target_ref=f"ministry_feed/{post_id}",
            payload={},
        )
        logger.info("ministry post deleted post_id=%s actor=%s", post_id, user.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── pin / unpin ──────────────────────────────────────────────────────────


@router.post(
    "/posts/{post_id}/pin",
    response_model=PinMinistryPostResponse,
)
@limiter.limit(MINISTRY_POST_PIN)
def pin_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_ministry_owner),
) -> PinMinistryPostResponse:
    db = _db()
    ref = db.collection("ministry_feed").document(post_id)
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    if (snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="deleted",
            message="Cannot pin a deleted post",
        )
    ref.update({"pinnedAt": fb_firestore.SERVER_TIMESTAMP, "pinnedBy": user.uid})
    write_audit_log(
        actor_uid=user.uid,
        action="ministry_post.pin",
        target_ref=f"ministry_feed/{post_id}",
        payload={},
    )
    return PinMinistryPostResponse(
        postId=post_id,
        pinnedAt=datetime.now(UTC).isoformat(),
    )


@router.delete(
    "/posts/{post_id}/pin",
    response_model=PinMinistryPostResponse,
)
@limiter.limit(MINISTRY_POST_PIN)
def unpin_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_ministry_owner),
) -> PinMinistryPostResponse:
    db = _db()
    ref = db.collection("ministry_feed").document(post_id)
    if not getattr(ref.get(), "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    ref.update({"pinnedAt": None, "pinnedBy": None})
    write_audit_log(
        actor_uid=user.uid,
        action="ministry_post.unpin",
        target_ref=f"ministry_feed/{post_id}",
        payload={},
    )
    return PinMinistryPostResponse(postId=post_id, pinnedAt=None)


# ── reactions (any signed-in non-banned member) ──────────────────────────


@router.post(
    "/posts/{post_id}/reactions/{slug}",
    response_model=MinistryReactionResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(REACTION_TOGGLE)
def react_to_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    user: CurrentUser = Depends(require_not_banned),
) -> MinistryReactionResponse:
    db = _db()
    sticker_snap = db.collection("stickers").document(slug).get()
    if not getattr(sticker_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sticker_not_found",
            message="Sticker not found",
        )
    post_ref = db.collection("ministry_feed").document(post_id)
    post_snap = post_ref.get()
    if not getattr(post_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    if (post_snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="deleted",
            message="Cannot react to a deleted post",
        )
    reaction_user_ref = (
        post_ref.collection("reactions").document(slug).collection("users").document(user.uid)
    )
    now = datetime.now(UTC)
    reaction_user_ref.set({"reactedAt": fb_firestore.SERVER_TIMESTAMP})
    fresh = post_ref.get()
    counts = (fresh.to_dict() or {}).get("reactionCounts") or {}
    return MinistryReactionResponse(
        uid=user.uid,
        slug=slug,
        reactedAt=now,
        reactionCounts={str(k): int(v) for k, v in counts.items()},
    )


@router.delete(
    "/posts/{post_id}/reactions/{slug}",
    response_model=MinistryReactionRemovedResponse,
)
@limiter.limit(REACTION_TOGGLE)
def unreact_to_ministry_post(
    request: Request,
    response: Response,
    post_id: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    user: CurrentUser = Depends(require_not_banned),
) -> MinistryReactionRemovedResponse:
    db = _db()
    reaction_user_ref = (
        db.collection("ministry_feed")
        .document(post_id)
        .collection("reactions")
        .document(slug)
        .collection("users")
        .document(user.uid)
    )
    reaction_user_ref.delete()
    fresh = db.collection("ministry_feed").document(post_id).get()
    counts = (fresh.to_dict() or {}).get("reactionCounts") or {}
    return MinistryReactionRemovedResponse(
        reactionCounts={str(k): int(v) for k, v in counts.items()},
    )
