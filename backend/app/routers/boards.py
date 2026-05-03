"""Boards router (T32): public list + admin-only create/archive/pin.

Boards are top-level forums independent of any group. Anyone signed in
can read and post (rules enforce that path); creation, archival, and
post pinning are platform-admin actions and flow through the Admin SDK
here.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import get_current_user, require_admin
from app.errors import APIError
from app.limits import BOARD_ADMIN_MUTATION, BOARDS_LIST
from app.middleware.rate_limit import limiter
from app.models.board import (
    ArchiveBoardResponse,
    BoardListResponse,
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
