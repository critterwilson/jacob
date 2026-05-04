"""Boards router (T32): public list + admin-only create/archive/pin.

Boards are top-level forums independent of any group. Anyone signed in
can read and post (rules enforce that path); creation, archival, and
post pinning are platform-admin actions and flow through the Admin SDK
here.
"""

from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import (
    BOARD_ADMIN_MUTATION,
    BOARD_POST_READ,
    BOARD_POSTS_LIST,
    BOARD_REPLIES_LIST,
    BOARDS_LIST,
)
from app.middleware.rate_limit import limiter
from app.models.board import (
    ArchiveBoardResponse,
    BoardListResponse,
    BoardPost,
    BoardPostModeration,
    BoardPostsResponse,
    BoardRepliesResponse,
    BoardReply,
    BoardResponse,
    CreateBoardRequest,
    PinPostRequest,
    PinPostResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(tags=["boards"])

_BOARD_LIST_LIMIT = 100


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


# ── public list ──────────────────────────────────────────────────────────


@router.get("/api/boards", response_model=BoardListResponse)
@limiter.limit(BOARDS_LIST)
def list_boards(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> BoardListResponse:
    db = _db()
    query = db.collection("boards").order_by("name").limit(_BOARD_LIST_LIMIT)
    boards: list[BoardResponse] = []
    for doc in query.stream():
        data = doc.to_dict() or {}
        if data.get("archivedAt") is not None:
            continue
        boards.append(
            BoardResponse(
                boardId=doc.id,
                name=data.get("name", ""),
                slug=data.get("slug", ""),
                description=data.get("description", ""),
                audience=data.get("audience", "general"),
                archivedAt=_ts_to_str(data.get("archivedAt")),
                postCount=int(data.get("postCount", 0)),
            )
        )
    return BoardListResponse(boards=boards)


# ── admin create ─────────────────────────────────────────────────────────


@router.post(
    "/api/admin/boards",
    status_code=status.HTTP_201_CREATED,
    response_model=BoardResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def create_board(
    request: Request,
    response: Response,
    body: CreateBoardRequest,
    user: CurrentUser = Depends(require_admin),
) -> BoardResponse:
    db = _db()

    # Use slug as document ID — Firestore enforces uniqueness naturally.
    board_ref = db.collection("boards").document(body.slug)
    board_id = body.slug
    if board_ref.get().exists:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="slug_conflict",
            message="A board with this slug already exists",
        )

    board_ref.set(
        {
            "name": body.name.strip(),
            "slug": body.slug,
            "description": body.description.strip(),
            "audience": body.audience,
            "createdAt": fb_firestore.SERVER_TIMESTAMP,
            "archivedAt": None,
            "postCount": 0,
            "schemaVersion": 1,
        }
    )
    write_audit_log(
        actor_uid=user.uid,
        action="create_board",
        target_ref=f"boards/{board_id}",
        payload={"slug": body.slug, "audience": body.audience},
    )
    logger.info("board created board_id=%s slug=%s actor=%s", board_id, body.slug, user.uid)
    return BoardResponse(
        boardId=board_id,
        name=body.name.strip(),
        slug=body.slug,
        description=body.description.strip(),
        audience=body.audience,
        archivedAt=None,
        postCount=0,
    )


# ── admin archive ────────────────────────────────────────────────────────


@router.delete(
    "/api/admin/boards/{board_id}",
    response_model=ArchiveBoardResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def archive_board(
    request: Request,
    response: Response,
    board_id: str,
    user: CurrentUser = Depends(require_admin),
) -> ArchiveBoardResponse:
    db = _db()
    board_ref = db.collection("boards").document(board_id)
    snap = board_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="board_not_found",
            message="Board not found",
        )
    if (snap.to_dict() or {}).get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="already_archived",
            message="Board is already archived",
        )

    board_ref.update({"archivedAt": fb_firestore.SERVER_TIMESTAMP})
    write_audit_log(
        actor_uid=user.uid,
        action="archive_board",
        target_ref=f"boards/{board_id}",
        payload={},
    )
    archived_at = datetime.now(UTC).isoformat()
    logger.info("board archived board_id=%s actor=%s", board_id, user.uid)
    return ArchiveBoardResponse(boardId=board_id, archivedAt=archived_at)


# ── admin pin / unpin a post ─────────────────────────────────────────────


@router.post(
    "/api/admin/boards/{board_id}/posts/{post_id}/pin",
    response_model=PinPostResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def pin_board_post(
    request: Request,
    response: Response,
    board_id: str,
    post_id: str,
    body: PinPostRequest,
    user: CurrentUser = Depends(require_admin),
) -> PinPostResponse:
    db = _db()
    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
    snap = post_ref.get()
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    data = snap.to_dict() or {}
    if data.get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="post_deleted",
            message="Cannot pin a deleted post",
        )

    if body.pinned:
        post_ref.update(
            {
                "pinnedAt": fb_firestore.SERVER_TIMESTAMP,
                "pinnedBy": user.uid,
            }
        )
        action = "pin_board_post"
        pinned_at: str | None = datetime.now(UTC).isoformat()
    else:
        post_ref.update({"pinnedAt": None, "pinnedBy": None})
        action = "unpin_board_post"
        pinned_at = None

    write_audit_log(
        actor_uid=user.uid,
        action=action,
        target_ref=f"boards/{board_id}/posts/{post_id}",
        payload={},
    )
    logger.info(
        "board post pin board_id=%s post_id=%s pinned=%s actor=%s",
        board_id,
        post_id,
        body.pinned,
        user.uid,
    )
    return PinPostResponse(boardId=board_id, postId=post_id, pinnedAt=pinned_at)


# ── M3: post + reply reads ───────────────────────────────────────────────


_POSTS_PAGE_DEFAULT = 50
_POSTS_PAGE_MAX = 100
_REPLIES_PAGE_DEFAULT = 50
_REPLIES_PAGE_MAX = 100


def _ts_to_dt(value: Any) -> Any:
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


def _moderation(data: Any) -> BoardPostModeration | None:
    if not isinstance(data, dict):
        return None
    return BoardPostModeration(
        state=data.get("state"),
        reasons=list(data.get("reasons") or []),
    )


def _doc_to_post(doc_id: str, data: dict[str, Any]) -> BoardPost:
    return BoardPost(
        postId=doc_id,
        authorUid=str(data.get("authorUid") or ""),
        body=str(data.get("body") or ""),
        stickerIds=list(data.get("stickerIds") or []),
        mediaRefs=list(data.get("mediaRefs") or []),
        mentions=list(data.get("mentions") or []),
        createdAt=_ts_to_dt(data.get("createdAt")),
        editedAt=_ts_to_dt(data.get("editedAt")),
        deletedAt=_ts_to_dt(data.get("deletedAt")),
        pinnedAt=_ts_to_dt(data.get("pinnedAt")),
        pinnedBy=data.get("pinnedBy"),
        reactionCounts={str(k): int(v) for k, v in (data.get("reactionCounts") or {}).items()},
        replyCount=int(data.get("replyCount") or 0),
        moderation=_moderation(data.get("moderation")),
    )


def _doc_to_reply(doc_id: str, data: dict[str, Any]) -> BoardReply:
    return BoardReply(
        replyId=doc_id,
        authorUid=str(data.get("authorUid") or ""),
        body=str(data.get("body") or ""),
        stickerIds=list(data.get("stickerIds") or []),
        mediaRefs=list(data.get("mediaRefs") or []),
        mentions=list(data.get("mentions") or []),
        createdAt=_ts_to_dt(data.get("createdAt")),
        editedAt=_ts_to_dt(data.get("editedAt")),
        deletedAt=_ts_to_dt(data.get("deletedAt")),
        moderation=_moderation(data.get("moderation")),
    )


def _encode_cursor(created_at: datetime, doc_id: str) -> str:
    payload = f"{created_at.isoformat()}|{doc_id}".encode()
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        ts_str, doc_id = raw.split("|", 1)
        return datetime.fromisoformat(ts_str), doc_id
    except Exception:  # noqa: BLE001
        return None


def _post_visible(data: dict[str, Any], *, caller_uid: str) -> bool:
    """Mirror `firestore.rules:468-474` — author/admin/non-deleted-non-hidden."""
    if data.get("deletedAt") is not None:
        return False
    mod = data.get("moderation") or {}
    if isinstance(mod, dict) and mod.get("state") == "hidden":
        return data.get("authorUid") == caller_uid
    return True


@router.get("/api/boards/{board_id}/posts", response_model=BoardPostsResponse)
@limiter.limit(BOARD_POSTS_LIST)
def list_board_posts(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_POSTS_PAGE_DEFAULT, ge=1, le=_POSTS_PAGE_MAX),
    user: CurrentUser = Depends(get_current_user),
) -> BoardPostsResponse:
    """List a board's posts.

    The previous client query ordered pinned-first then by createdAt
    desc. Firestore's compound index supports that, but the migration
    plan §4.15.2 lists the response as cursor-paginated by createdAt
    desc; for M3 we keep it simple and return up to `limit` posts in
    pinned-first / createdAt-desc order, with the cursor advancing on
    createdAt only. Pinned items are bounded so this is consistent for
    paged scrollback.
    """
    db = _db()
    posts_col = db.collection("boards").document(board_id).collection("posts")

    query = (
        posts_col.where("deletedAt", "==", None)
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
        cursor_ts, _doc_id = decoded
        # Cursor is on createdAt; pinned-first ordering is preserved by
        # Firestore index.
        query = query.start_after({"pinnedAt": None, "createdAt": cursor_ts})

    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]

    posts: list[BoardPost] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        if not _post_visible(data, caller_uid=user.uid):
            continue
        posts.append(_doc_to_post(snap.id, data))

    next_cursor: str | None = None
    if has_more and snaps:
        last_data = snaps[-1].to_dict() or {}
        last_ts = _ts_to_dt(last_data.get("createdAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id)

    return BoardPostsResponse(posts=posts, nextCursor=next_cursor)


@router.get("/api/boards/{board_id}/posts/{post_id}", response_model=BoardPost)
@limiter.limit(BOARD_POST_READ)
def get_board_post(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(get_current_user),
) -> BoardPost:
    db = _db()
    snap = db.collection("boards").document(board_id).collection("posts").document(post_id).get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    data = snap.to_dict() or {}
    if not _post_visible(data, caller_uid=user.uid):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    return _doc_to_post(snap.id, data)


@router.get(
    "/api/boards/{board_id}/posts/{post_id}/replies",
    response_model=BoardRepliesResponse,
)
@limiter.limit(BOARD_REPLIES_LIST)
def list_board_replies(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_REPLIES_PAGE_DEFAULT, ge=1, le=_REPLIES_PAGE_MAX),
    user: CurrentUser = Depends(get_current_user),
) -> BoardRepliesResponse:
    db = _db()
    col = (
        db.collection("boards")
        .document(board_id)
        .collection("posts")
        .document(post_id)
        .collection("replies")
    )
    query = col.order_by("createdAt", direction=fb_firestore.Query.ASCENDING)

    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_cursor",
                message="Cursor is malformed",
            )
        cursor_ts, _doc_id = decoded
        query = query.start_after({"createdAt": cursor_ts})

    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]

    replies: list[BoardReply] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            continue
        mod = data.get("moderation") or {}
        if isinstance(mod, dict) and mod.get("state") == "hidden":
            if data.get("authorUid") != user.uid:
                continue
        replies.append(_doc_to_reply(snap.id, data))

    next_cursor: str | None = None
    if has_more and snaps:
        last_data = snaps[-1].to_dict() or {}
        last_ts = _ts_to_dt(last_data.get("createdAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id)

    return BoardRepliesResponse(replies=replies, nextCursor=next_cursor)
