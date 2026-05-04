"""Messages router (M3 reads, M4 writes).

M3 introduces the read endpoints that replace the frontend's direct
`onSnapshot`/`getDocs` calls on `groups/{gid}/messages`. The realtime
behaviour is downgraded to 10s polling for M3; M5 reintroduces it via
SSE. M4 will add the write endpoints (POST/PATCH/DELETE) for messages.

Read access uses `require_member_or_public_top_level`: members get
everything (with hidden messages redacted to themselves only); non-
members of public groups get only top-level non-deleted non-hidden
messages, matching the rules at `firestore.rules:314-320`.
"""

from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    PublicReadContext,
    require_member,
    require_member_or_public_top_level,
)
from app.errors import APIError
from app.limits import MESSAGE_READ, MESSAGES_LIST
from app.middleware.rate_limit import limiter
from app.models.messages import Message, MessagesListResponse, ModerationFields
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups", tags=["messages"])

_PAGE_DEFAULT = 50
_PAGE_MAX = 100


# ── helpers ──────────────────────────────────────────────────────────────


def _ts_to_dt(value: Any) -> datetime | None:
    """Convert Firestore Timestamp / datetime / None → tz-aware datetime."""
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


def _moderation_to_model(value: Any) -> ModerationFields | None:
    if not value or not isinstance(value, dict):
        return None
    state = value.get("state")
    return ModerationFields(
        state=state if state in {"scored", "flagged", "hidden", "skipped", "errored"} else None,
        reasons=list(value.get("reasons") or []),
        scores=dict(value["scores"]) if isinstance(value.get("scores"), dict) else None,
        scoredAt=_ts_to_dt(value.get("scoredAt")),
        policy=value.get("policy"),
    )


def _doc_to_message(doc_id: str, data: dict[str, Any]) -> Message:
    return Message(
        id=doc_id,
        authorUid=str(data.get("authorUid") or ""),
        body=str(data.get("body") or ""),
        stickerIds=list(data.get("stickerIds") or []),
        mediaRefs=list(data.get("mediaRefs") or []),
        mentions=list(data.get("mentions") or []),
        parentMessageId=data.get("parentMessageId"),
        threadReplyCount=int(data.get("threadReplyCount") or 0),
        createdAt=_ts_to_dt(data.get("createdAt")),
        editedAt=_ts_to_dt(data.get("editedAt")),
        deletedAt=_ts_to_dt(data.get("deletedAt")),
        announcedAt=_ts_to_dt(data.get("announcedAt")),
        announcedBy=data.get("announcedBy"),
        reactionCounts={str(k): int(v) for k, v in (data.get("reactionCounts") or {}).items()},
        moderation=_moderation_to_model(data.get("moderation")),
        repostOfThread=data.get("repostOfThread"),
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


def _filter_for_visibility(
    msg: Message,
    *,
    ctx: MembershipContext | PublicReadContext,
    caller_uid: str,
) -> Message | None:
    """Apply the public-read and hidden-message filters from the rules.

    * Public-group non-members: top-level non-deleted, non-hidden only.
    * Members: see everything; hidden messages are redacted to the
      author only (others see them omitted).
    """
    if isinstance(ctx, PublicReadContext):
        if msg.parentMessageId is not None:
            return None
        if msg.deletedAt is not None:
            return None
        if msg.moderation and msg.moderation.state == "hidden":
            return None
        return msg

    if msg.moderation and msg.moderation.state == "hidden":
        if msg.authorUid != caller_uid:
            return None
        return msg.model_copy(update={"body": ""})

    return msg


# ── list endpoint ───────────────────────────────────────────────────────


@router.get("/{gid}/messages", response_model=MessagesListResponse)
@limiter.limit(MESSAGES_LIST)
def list_messages(
    request: Request,
    response: Response,
    gid: str = Path(..., min_length=1),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_DEFAULT, ge=1, le=_PAGE_MAX),
    parent_message_id: str | None = Query(default=None, alias="parentMessageId"),
    ctx: MembershipContext | PublicReadContext = Depends(require_member_or_public_top_level),
) -> MessagesListResponse:
    """Paginated message read.

    Without `parentMessageId` returns top-level messages (matches
    `useGroupMessages`). With `parentMessageId` returns thread replies
    in chronological order (matches `useThreadMessages`).
    """
    db = get_firestore()
    col = db.collection("groups").document(gid).collection("messages")
    descending = parent_message_id is None
    direction = fb_firestore.Query.DESCENDING if descending else fb_firestore.Query.ASCENDING
    query = col.where("parentMessageId", "==", parent_message_id).order_by(
        "createdAt", direction=direction
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
        query = query.start_after({"createdAt": cursor_ts})

    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]

    caller_uid = ctx.uid
    out: list[Message] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        msg = _doc_to_message(snap.id, data)
        filtered = _filter_for_visibility(msg, ctx=ctx, caller_uid=caller_uid)
        if filtered is not None:
            out.append(filtered)

    next_cursor: str | None = None
    if has_more and snaps:
        last_data = snaps[-1].to_dict() or {}
        last_ts = _ts_to_dt(last_data.get("createdAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id)

    return MessagesListResponse(messages=out, nextCursor=next_cursor)


# ── single-message read ────────────────────────────────────────────────


@router.get("/{gid}/messages/{mid}", response_model=Message)
@limiter.limit(MESSAGE_READ)
def get_message(
    request: Request,
    response: Response,
    gid: str = Path(..., min_length=1),
    mid: str = Path(..., min_length=1),
    membership: MembershipContext = Depends(require_member),
) -> Message:
    db = get_firestore()
    snap = db.collection("groups").document(gid).collection("messages").document(mid).get()
    if not getattr(snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="message_not_found",
            message="Message not found",
        )
    msg = _doc_to_message(snap.id, snap.to_dict() or {})
    filtered = _filter_for_visibility(msg, ctx=membership, caller_uid=membership.uid)
    if filtered is None:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="message_not_found",
            message="Message not found",
        )
    return filtered


__all__ = ["router"]
