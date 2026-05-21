"""Boards router (T32): public list + admin-only create/archive/pin.

Boards are top-level forums independent of any group. Anyone signed in
can read and post (rules enforce that path); creation, archival, and
post pinning are platform-admin actions and flow through the Admin SDK
here.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Path, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf
from starlette.responses import Response as StarletteResponse

from app.deps import get_current_user, require_admin, require_not_banned
from app.errors import APIError
from app.limits import (
    BOARD_ADMIN_MUTATION,
    BOARD_POST_CREATE,
    BOARD_POST_DELETE,
    BOARD_POST_EDIT,
    BOARD_POST_READ,
    BOARD_POSTS_LIST,
    BOARD_REPLIES_LIST,
    BOARD_REPLY_CREATE,
    BOARD_REPLY_DELETE,
    BOARD_REPLY_EDIT,
    BOARDS_LIST,
    REACTION_TOGGLE,
)
from app.middleware.rate_limit import limiter
from app.models.board import (
    ArchiveBoardResponse,
    BoardListResponse,
    BoardPost,
    BoardPostModeration,
    BoardPostsResponse,
    BoardReactionRemovedResponse,
    BoardReactionResponse,
    BoardRepliesResponse,
    BoardReply,
    BoardResponse,
    CreateBoardPostRequest,
    CreateBoardReplyRequest,
    CreateBoardRequest,
    EditBoardPostRequest,
    EditBoardReplyRequest,
    PatchBoardRequest,
    PinPostRequest,
    PinPostResponse,
)
from app.models.pagination import PaginationParams
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


# ── admin edit board metadata ────────────────────────────────────────────


@router.patch(
    "/api/admin/boards/{board_id}",
    response_model=BoardResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def edit_board(
    request: Request,
    response: Response,
    board_id: str,
    body: PatchBoardRequest,
    user: CurrentUser = Depends(require_admin),
) -> BoardResponse:
    """Update board name, description, and/or audience. Slug is immutable."""
    db = _db()
    board_ref = db.collection("boards").document(board_id)
    snap = board_ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="board_not_found",
            message="Board not found",
        )
    data = snap.to_dict() or {}

    updates: dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.description is not None:
        updates["description"] = body.description.strip()
    if body.audience is not None:
        updates["audience"] = body.audience

    if updates:
        board_ref.update(updates)
        write_audit_log(
            actor_uid=user.uid,
            action="edit_board",
            target_ref=f"boards/{board_id}",
            payload={"fields": list(updates.keys())},
        )
        logger.info(
            "board edited board_id=%s actor=%s fields=%s",
            board_id,
            user.uid,
            list(updates.keys()),
        )
        data = {**data, **updates}

    return BoardResponse(
        boardId=board_id,
        name=str(data.get("name", "")),
        slug=str(data.get("slug", "")),
        description=str(data.get("description", "")),
        audience=data.get("audience", "general"),
        archivedAt=_ts_to_str(data.get("archivedAt")),
        postCount=int(data.get("postCount", 0)),
    )


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


def _encode_cursor(
    created_at: datetime,
    doc_id: str,
    pinned_at: datetime | None = None,
) -> str:
    # `pinnedAt` is a 3rd, optional field for board-posts pagination.
    # When the boundary page lands inside a pinned bucket, the next
    # `start_after` must carry the pinnedAt value or the order-by-pinnedAt
    # clause skips the rest of the bucket. Legacy 2-field cursors are
    # still accepted by the decoder.
    pinned_str = pinned_at.isoformat() if pinned_at is not None else ""
    payload = f"{created_at.isoformat()}|{doc_id}|{pinned_str}".encode()
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(
    cursor: str,
) -> tuple[datetime, str, datetime | None] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        parts = raw.split("|", 2)
        if len(parts) == 2:
            # Legacy 2-field cursor (no pinnedAt) — accept for back-compat.
            ts_str, doc_id = parts
            return datetime.fromisoformat(ts_str), doc_id, None
        ts_str, doc_id, pinned_str = parts
        pinned_at = datetime.fromisoformat(pinned_str) if pinned_str else None
        return datetime.fromisoformat(ts_str), doc_id, pinned_at
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
    pagination: PaginationParams = Depends(),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    user: CurrentUser = Depends(get_current_user),
) -> Any:
    """List a board's posts.

    The previous client query ordered pinned-first then by createdAt
    desc. Firestore's compound index supports that, but the migration
    plan §4.15.2 lists the response as cursor-paginated by createdAt
    desc; for M3 we keep it simple and return up to `limit` posts in
    pinned-first / createdAt-desc order, with the cursor advancing on
    createdAt only. Pinned items are bounded so this is consistent for
    paged scrollback.
    """
    limit = pagination.limit
    cursor = pagination.cursor
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
        cursor_ts, cursor_doc_id, cursor_pinned_at = decoded
        # Include __name__ as a tie-breaker so posts with identical
        # createdAt aren't skipped or duplicated at the page boundary.
        # The `pinnedAt` value carries from the previous page so a
        # boundary that falls inside the pinned bucket doesn't skip the
        # remaining pinned posts on page 2.
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
        last_pinned = _ts_to_dt(last_data.get("pinnedAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id, last_pinned)

    payload = BoardPostsResponse(posts=posts, nextCursor=next_cursor)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'
    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return payload


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
    pagination: PaginationParams = Depends(),
    user: CurrentUser = Depends(get_current_user),
) -> BoardRepliesResponse:
    limit = pagination.limit
    cursor = pagination.cursor
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
        cursor_ts, cursor_doc_id, _ = decoded
        # Include __name__ as a tie-breaker so replies with identical
        # createdAt aren't skipped or duplicated at the page boundary.
        query = query.order_by("__name__", direction=fb_firestore.Query.ASCENDING).start_after(
            {"createdAt": cursor_ts, "__name__": cursor_doc_id}
        )

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


# ── M4 writes ────────────────────────────────────────────────────────────


_GCS_PUBLIC_PREFIX = "https://storage.googleapis.com/jacob-media-public-"
_BOARD_EDIT_WINDOW_SECONDS = 15 * 60


def _validate_media_refs(refs: list[str]) -> None:
    for ref in refs:
        if not ref.startswith(_GCS_PUBLIC_PREFIX):
            raise APIError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_media_ref",
                message="mediaRefs must point to the public GCS bucket",
                details={"badRef": ref},
            )


def _require_board_not_archived(db: Any, board_id: str) -> dict[str, Any]:
    snap = db.collection("boards").document(board_id).get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="board_not_found",
            message="Board not found",
        )
    data = snap.to_dict() or {}
    if data.get("archivedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="archived",
            message="Board is archived; new posts are disabled",
        )
    return data


def _is_admin(user: CurrentUser) -> bool:
    return user.claims.get("admin") is True


@router.post(
    "/api/boards/{board_id}/posts",
    response_model=BoardPost,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(BOARD_POST_CREATE)
def create_board_post(
    request: Request,
    response: Response,
    body: CreateBoardPostRequest,
    board_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardPost:
    db = _db()
    _require_board_not_archived(db, board_id)
    _validate_media_refs(body.mediaRefs)

    posts_col = db.collection("boards").document(board_id).collection("posts")
    payload: dict[str, Any] = {
        "authorUid": user.uid,
        "body": body.body,
        "stickerIds": body.stickerIds,
        "mediaRefs": body.mediaRefs,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "editedAt": None,
        "deletedAt": None,
        "pinnedAt": None,
        "pinnedBy": None,
        "replyCount": 0,
    }
    if body.mentions:
        payload["mentions"] = body.mentions

    new_ref = posts_col.document()
    new_ref.set(payload)
    fresh = new_ref.get()
    return _doc_to_post(fresh.id, fresh.to_dict() or {})


@router.patch(
    "/api/boards/{board_id}/posts/{post_id}",
    response_model=BoardPost,
)
@limiter.limit(BOARD_POST_EDIT)
def edit_board_post(
    request: Request,
    response: Response,
    body: EditBoardPostRequest,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardPost:
    """Edit a post body. 15-minute window. Admins can edit beyond the
    window for moderation; mirrors the rules at firestore.rules:507-522.
    """
    db = _db()
    ref = db.collection("boards").document(board_id).collection("posts").document(post_id)

    @gcf.transactional
    def _txn(txn: Any) -> None:
        snap = ref.get(transaction=txn)
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
        is_author = data.get("authorUid") == user.uid
        if not is_author and not _is_admin(user):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author",
                message="Not the author of this post",
            )
        if is_author and not _is_admin(user):
            created = _ts_to_dt(data.get("createdAt"))
            if created is not None:
                created_aware = created if created.tzinfo else created.replace(tzinfo=UTC)
                age_s = (datetime.now(UTC) - created_aware).total_seconds()
                if age_s > _BOARD_EDIT_WINDOW_SECONDS:
                    raise APIError(
                        status_code=status.HTTP_409_CONFLICT,
                        code="edit_window_expired",
                        message="Edit window has expired (15 minutes)",
                        details={
                            "windowSeconds": _BOARD_EDIT_WINDOW_SECONDS,
                            "messageAge": int(age_s),
                        },
                    )
        txn.update(ref, {"body": body.body, "editedAt": fb_firestore.SERVER_TIMESTAMP})

    _txn(db.transaction())
    fresh = ref.get()
    return _doc_to_post(fresh.id, fresh.to_dict() or {})


@router.delete(
    "/api/boards/{board_id}/posts/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit(BOARD_POST_DELETE)
def delete_board_post(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> Response:
    """Soft-delete a post. Author or admin. Idempotent."""
    db = _db()
    ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
    deleter_role: str | None = None

    @gcf.transactional
    def _txn(txn: Any) -> None:
        nonlocal deleter_role
        snap = ref.get(transaction=txn)
        if not getattr(snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="post_not_found",
                message="Post not found",
            )
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            deleter_role = "noop"
            return
        is_author = data.get("authorUid") == user.uid
        if not is_author and not _is_admin(user):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author_or_admin",
                message="Only the author or an admin can delete this post",
            )
        deleter_role = "admin" if _is_admin(user) and not is_author else "author"
        txn.update(ref, {"deletedAt": fb_firestore.SERVER_TIMESTAMP})

    _txn(db.transaction())
    if deleter_role and deleter_role != "noop":
        write_audit_log(
            actor_uid=user.uid,
            action="board_post.delete",
            target_ref=f"boards/{board_id}/posts/{post_id}",
            payload={"boardId": board_id, "postId": post_id, "deleter_role": deleter_role},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── post pin / unpin (M4: split from the legacy admin POST /pin endpoint) ──


@router.post(
    "/api/boards/{board_id}/posts/{post_id}/pin",
    response_model=PinPostResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def pin_board_post_admin(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_admin),
) -> PinPostResponse:
    """Admin pin endpoint (re-implements PinPost POST without the
    legacy `pinned` body — the URL alone implies pin/unpin)."""
    db = _db()
    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
    snap = post_ref.get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    if (snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="post_deleted",
            message="Cannot pin a deleted post",
        )
    post_ref.update({"pinnedAt": fb_firestore.SERVER_TIMESTAMP, "pinnedBy": user.uid})
    write_audit_log(
        actor_uid=user.uid,
        action="board_post.pin",
        target_ref=f"boards/{board_id}/posts/{post_id}",
        payload={},
    )
    return PinPostResponse(boardId=board_id, postId=post_id, pinnedAt=datetime.now(UTC).isoformat())


@router.delete(
    "/api/boards/{board_id}/posts/{post_id}/pin",
    response_model=PinPostResponse,
)
@limiter.limit(BOARD_ADMIN_MUTATION)
def unpin_board_post_admin(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_admin),
) -> PinPostResponse:
    db = _db()
    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
    if not getattr(post_ref.get(), "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="post_not_found",
            message="Post not found",
        )
    post_ref.update({"pinnedAt": None, "pinnedBy": None})
    write_audit_log(
        actor_uid=user.uid,
        action="board_post.unpin",
        target_ref=f"boards/{board_id}/posts/{post_id}",
        payload={},
    )
    return PinPostResponse(boardId=board_id, postId=post_id, pinnedAt=None)


# ── replies ──────────────────────────────────────────────────────────────


@router.post(
    "/api/boards/{board_id}/posts/{post_id}/replies",
    response_model=BoardReply,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(BOARD_REPLY_CREATE)
def create_board_reply(
    request: Request,
    response: Response,
    body: CreateBoardReplyRequest,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardReply:
    db = _db()
    _require_board_not_archived(db, board_id)
    _validate_media_refs(body.mediaRefs)

    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
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
            code="post_deleted",
            message="Cannot reply to a deleted post",
        )

    replies_col = post_ref.collection("replies")
    payload: dict[str, Any] = {
        "authorUid": user.uid,
        "body": body.body,
        "stickerIds": body.stickerIds,
        "mediaRefs": body.mediaRefs,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "editedAt": None,
        "deletedAt": None,
    }
    if body.mentions:
        payload["mentions"] = body.mentions

    new_ref = replies_col.document()
    new_ref.set(payload)
    fresh = new_ref.get()
    return _doc_to_reply(fresh.id, fresh.to_dict() or {})


@router.patch(
    "/api/boards/{board_id}/posts/{post_id}/replies/{reply_id}",
    response_model=BoardReply,
)
@limiter.limit(BOARD_REPLY_EDIT)
def edit_board_reply(
    request: Request,
    response: Response,
    body: EditBoardReplyRequest,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    reply_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardReply:
    db = _db()
    ref = (
        db.collection("boards")
        .document(board_id)
        .collection("posts")
        .document(post_id)
        .collection("replies")
        .document(reply_id)
    )

    @gcf.transactional
    def _txn(txn: Any) -> None:
        snap = ref.get(transaction=txn)
        if not getattr(snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="reply_not_found",
                message="Reply not found",
            )
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="deleted",
                message="Cannot edit a deleted reply",
            )
        is_author = data.get("authorUid") == user.uid
        if not is_author and not _is_admin(user):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author",
                message="Not the author of this reply",
            )
        if is_author and not _is_admin(user):
            created = _ts_to_dt(data.get("createdAt"))
            if created is not None:
                created_aware = created if created.tzinfo else created.replace(tzinfo=UTC)
                age_s = (datetime.now(UTC) - created_aware).total_seconds()
                if age_s > _BOARD_EDIT_WINDOW_SECONDS:
                    raise APIError(
                        status_code=status.HTTP_409_CONFLICT,
                        code="edit_window_expired",
                        message="Edit window has expired (15 minutes)",
                        details={
                            "windowSeconds": _BOARD_EDIT_WINDOW_SECONDS,
                            "messageAge": int(age_s),
                        },
                    )
        txn.update(ref, {"body": body.body, "editedAt": fb_firestore.SERVER_TIMESTAMP})

    _txn(db.transaction())
    fresh = ref.get()
    return _doc_to_reply(fresh.id, fresh.to_dict() or {})


@router.delete(
    "/api/boards/{board_id}/posts/{post_id}/replies/{reply_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit(BOARD_REPLY_DELETE)
def delete_board_reply(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    reply_id: str = Path(..., min_length=1),
    user: CurrentUser = Depends(require_not_banned),
) -> Response:
    db = _db()
    ref = (
        db.collection("boards")
        .document(board_id)
        .collection("posts")
        .document(post_id)
        .collection("replies")
        .document(reply_id)
    )
    deleter_role: str | None = None

    @gcf.transactional
    def _txn(txn: Any) -> None:
        nonlocal deleter_role
        snap = ref.get(transaction=txn)
        if not getattr(snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="reply_not_found",
                message="Reply not found",
            )
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            deleter_role = "noop"
            return
        is_author = data.get("authorUid") == user.uid
        if not is_author and not _is_admin(user):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author_or_admin",
                message="Only the author or an admin can delete this reply",
            )
        deleter_role = "admin" if _is_admin(user) and not is_author else "author"
        txn.update(ref, {"deletedAt": fb_firestore.SERVER_TIMESTAMP})

    _txn(db.transaction())
    if deleter_role and deleter_role != "noop":
        write_audit_log(
            actor_uid=user.uid,
            action="board_reply.delete",
            target_ref=f"boards/{board_id}/posts/{post_id}/replies/{reply_id}",
            payload={
                "boardId": board_id,
                "postId": post_id,
                "replyId": reply_id,
                "deleter_role": deleter_role,
            },
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── board post reactions ─────────────────────────────────────────────────


@router.post(
    "/api/boards/{board_id}/posts/{post_id}/reactions/{slug}",
    response_model=BoardReactionResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(REACTION_TOGGLE)
def react_to_board_post(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardReactionResponse:
    db = _db()
    _require_board_not_archived(db, board_id)
    sticker_snap = db.collection("stickers").document(slug).get()
    if not getattr(sticker_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sticker_not_found",
            message="Sticker not found",
        )
    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
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
            code="post_deleted",
            message="Cannot react to a deleted post",
        )
    reaction_user_ref = (
        post_ref.collection("reactions").document(slug).collection("users").document(user.uid)
    )
    now = datetime.now(UTC)
    reaction_user_ref.set({"reactedAt": fb_firestore.SERVER_TIMESTAMP})
    fresh = post_ref.get()
    counts = (fresh.to_dict() or {}).get("reactionCounts") or {}
    return BoardReactionResponse(
        uid=user.uid,
        slug=slug,
        reactedAt=now,
        reactionCounts={str(k): int(v) for k, v in counts.items()},
    )


@router.delete(
    "/api/boards/{board_id}/posts/{post_id}/reactions/{slug}",
    response_model=BoardReactionRemovedResponse,
)
@limiter.limit(REACTION_TOGGLE)
def unreact_to_board_post(
    request: Request,
    response: Response,
    board_id: str = Path(..., min_length=1),
    post_id: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    user: CurrentUser = Depends(require_not_banned),
) -> BoardReactionRemovedResponse:
    db = _db()
    reaction_user_ref = (
        db.collection("boards")
        .document(board_id)
        .collection("posts")
        .document(post_id)
        .collection("reactions")
        .document(slug)
        .collection("users")
        .document(user.uid)
    )
    reaction_user_ref.delete()
    post_ref = db.collection("boards").document(board_id).collection("posts").document(post_id)
    fresh = post_ref.get()
    counts = (fresh.to_dict() or {}).get("reactionCounts") or {}
    return BoardReactionRemovedResponse(reactionCounts={str(k): int(v) for k, v in counts.items()})
