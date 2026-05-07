"""Messages router (M3 reads, M4 writes).

M3 introduced the read endpoints that replace the frontend's direct
`onSnapshot`/`getDocs` calls on `groups/{gid}/messages`. M4 adds the
write endpoints (POST/PATCH/DELETE) and the reaction toggle endpoints.

Read access uses `require_member_or_public_top_level`: members get
everything (with hidden messages redacted to themselves only); non-
members of public groups get only top-level non-deleted non-hidden
messages, matching the rules at `firestore.rules:314-320`.

Write access composes `require_member` + `require_not_banned` +
`require_not_archived`. The 15-minute edit window and soft-delete
idempotency are enforced inside Firestore transactions in the write
handlers — see §5.7 of the data-layer migration plan.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response, status
from firebase_admin import firestore as fb_firestore
from google.cloud import firestore as gcf
from starlette.responses import Response as StarletteResponse

from app.deps import (
    MembershipContext,
    PublicReadContext,
    require_member,
    require_member_or_public_top_level,
    require_not_archived,
    require_not_banned,
)
from app.errors import APIError
from app.limits import (
    MESSAGE_CREATE,
    MESSAGE_DELETE,
    MESSAGE_EDIT,
    MESSAGE_READ,
    MESSAGES_LIST,
    REACTION_TOGGLE,
)
from app.middleware.rate_limit import limiter
from app.models.messages import (
    CreateMessageRequest,
    EditMessageRequest,
    Message,
    MessagesListResponse,
    ModerationFields,
    ReactionRemovedResponse,
    ReactionResponse,
)
from app.models.user import CurrentUser
from app.services.audit import write_audit_log
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


def _my_reactions(
    db: Any,
    *,
    gid: str,
    mid: str,
    caller_uid: str,
    reaction_counts: dict[str, int],
) -> list[str]:
    """Return the slugs the caller has reacted with on this message.

    Reads `groups/{gid}/messages/{mid}/reactions/{slug}/users/{caller_uid}`
    once per slug present in `reactionCounts`. Slugs with `count <= 0` are
    skipped — the parent doc would not exist. Public-read non-members get
    `[]` from the caller and never hit this path.
    """
    if not reaction_counts:
        return []
    msgs_col = db.collection("groups").document(gid).collection("messages")
    reactions_col = msgs_col.document(mid).collection("reactions")
    out: list[str] = []
    for slug, count in reaction_counts.items():
        if count <= 0:
            continue
        ref = reactions_col.document(slug).collection("users").document(caller_uid)
        if getattr(ref.get(), "exists", False):
            out.append(str(slug))
    return out


def _my_reactions_batch(
    db: Any,
    *,
    gid: str,
    caller_uid: str,
    messages: list[tuple[str, dict[str, int]]],
) -> dict[str, list[str]]:
    """Batch the per-message my-reactions lookup into a single round-trip (M10).

    Builds the full set of `users/{caller_uid}` refs across every (message,
    slug) pair where count > 0, fans them out via `db.get_all()`, then
    rebuilds the {mid: [slug, ...]} map. Total Firestore round-trips is one
    regardless of message count — replacing the previous N+1 walk that did
    one .get() per slug per message in the chat poll.
    """
    if not messages:
        return {}
    msgs_col = db.collection("groups").document(gid).collection("messages")
    refs: list[Any] = []
    keys: list[tuple[str, str]] = []  # parallel to refs: (mid, slug)
    for mid, counts in messages:
        if not counts:
            continue
        reactions_col = msgs_col.document(mid).collection("reactions")
        for slug, count in counts.items():
            if count <= 0:
                continue
            refs.append(reactions_col.document(slug).collection("users").document(caller_uid))
            keys.append((mid, str(slug)))
    if not refs:
        return {}
    out: dict[str, list[str]] = {}
    # `db.get_all` returns DocumentSnapshots in an unspecified order; pair
    # them back to keys via `snap.reference.path`. Build a lookup map first.
    ref_path_to_key = {ref.path: key for ref, key in zip(refs, keys, strict=True)}
    for snap in db.get_all(refs):
        if not getattr(snap, "exists", False):
            continue
        path = getattr(snap.reference, "path", None)
        if path is None:
            continue
        key = ref_path_to_key.get(path)
        if key is None:
            continue
        mid, slug = key
        out.setdefault(mid, []).append(slug)
    return out


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
    since: str | None = Query(default=None),
    limit: int = Query(default=_PAGE_DEFAULT, ge=1, le=_PAGE_MAX),
    parent_message_id: str | None = Query(default=None, alias="parentMessageId"),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    ctx: MembershipContext | PublicReadContext = Depends(require_member_or_public_top_level),
) -> Any:
    """Paginated message read.

    Without `parentMessageId` returns top-level messages (matches
    `useGroupMessages`). With `parentMessageId` returns thread replies
    in chronological order (matches `useThreadMessages`).

    `since=<iso8601>` returns only messages with `createdAt >= since`,
    used by the chat poll loop. Mutually exclusive with `cursor`.
    Comparison is `>=` (not `>`) so callers don't lose ties on the
    boundary timestamp; the client dedupes by message id when merging.

    The response carries an `ETag`. Callers may pass `If-None-Match`
    to short-circuit the body when nothing changed (304 + empty).
    """
    if since is not None and cursor is not None:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_query",
            message="`since` and `cursor` are mutually exclusive",
        )

    db = get_firestore()
    col = db.collection("groups").document(gid).collection("messages")
    descending = parent_message_id is None
    direction = fb_firestore.Query.DESCENDING if descending else fb_firestore.Query.ASCENDING
    query = col.where("parentMessageId", "==", parent_message_id).order_by(
        "createdAt", direction=direction
    )

    if since is not None:
        try:
            since_ts = datetime.fromisoformat(since)
        except ValueError as exc:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_since",
                message="`since` must be ISO 8601",
            ) from exc
        if since_ts.tzinfo is None:
            since_ts = since_ts.replace(tzinfo=UTC)
        query = query.where("createdAt", ">=", since_ts)
    elif cursor:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            raise APIError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_cursor",
                message="Cursor is malformed",
            )
        cursor_ts, cursor_doc_id = decoded
        # PR10 / M2: include __name__ in the order_by chain and pass it as
        # the second start_after value so messages with identical
        # createdAt timestamps (bulk seeds, burst writes) are uniquely
        # broken at the page boundary. Without this, the query would
        # either skip or duplicate one row when the cursor lands on a tie.
        query = query.order_by("__name__", direction=direction).start_after(
            {"createdAt": cursor_ts, "__name__": cursor_doc_id}
        )

    query = query.limit(limit + 1)

    snaps = list(query.stream())
    has_more = len(snaps) > limit
    snaps = snaps[:limit]

    caller_uid = ctx.uid
    is_member = isinstance(ctx, MembershipContext)
    visible: list[Message] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        msg = _doc_to_message(snap.id, data)
        filtered = _filter_for_visibility(msg, ctx=ctx, caller_uid=caller_uid)
        if filtered is None:
            continue
        visible.append(filtered)

    out: list[Message] = visible
    if is_member:
        # M10: batch every per-message reaction lookup into one round-trip
        # instead of one Firestore .get() per (message, slug). Page-of-50
        # polls used to fan out into ~150 Firestore round-trips; now it's 1.
        my_reactions_by_mid = _my_reactions_batch(
            db,
            gid=gid,
            caller_uid=caller_uid,
            messages=[(m.id, m.reactionCounts) for m in visible if m.reactionCounts],
        )
        if my_reactions_by_mid:
            out = [
                (
                    m.model_copy(update={"myReactions": my_reactions_by_mid[m.id]})
                    if m.id in my_reactions_by_mid
                    else m
                )
                for m in visible
            ]

    next_cursor: str | None = None
    if has_more and snaps:
        last_data = snaps[-1].to_dict() or {}
        last_ts = _ts_to_dt(last_data.get("createdAt"))
        if last_ts is not None:
            next_cursor = _encode_cursor(last_ts, snaps[-1].id)

    payload = MessagesListResponse(messages=out, nextCursor=next_cursor)
    body_bytes = payload.model_dump_json().encode("utf-8")
    etag = f'W/"{hashlib.md5(body_bytes).hexdigest()}"'

    if if_none_match is not None and if_none_match == etag:
        return StarletteResponse(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    response.headers["ETag"] = etag
    return payload


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
    if filtered.reactionCounts:
        mine = _my_reactions(
            db,
            gid=gid,
            mid=filtered.id,
            caller_uid=membership.uid,
            reaction_counts=filtered.reactionCounts,
        )
        if mine:
            filtered = filtered.model_copy(update={"myReactions": mine})
    return filtered


# ── M4 writes ────────────────────────────────────────────────────────────


_EDIT_WINDOW = timedelta(minutes=15)
_GCS_PUBLIC_PREFIX = "https://storage.googleapis.com/jacob-media-public-"


def _validate_media_refs(refs: list[str]) -> None:
    for ref in refs:
        if not ref.startswith(_GCS_PUBLIC_PREFIX):
            raise APIError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="invalid_media_ref",
                message="mediaRefs must point to the public GCS bucket",
                details={"badRef": ref},
            )


@router.post(
    "/{gid}/messages",
    response_model=Message,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(MESSAGE_CREATE)
def create_message(
    request: Request,
    response: Response,
    body: CreateMessageRequest,
    gid: str = Path(..., min_length=1),
    membership: MembershipContext = Depends(require_member),
    user: CurrentUser = Depends(require_not_banned),
) -> Message:
    """Create a top-level message or thread reply.

    Replaces `MessageInput` and `ThreadReplyInput` `addDoc` calls.
    `archived` returns 409. Parent-exists check inline.
    """
    require_not_archived(membership)
    _validate_media_refs(body.mediaRefs)

    db = get_firestore()
    messages_col = db.collection("groups").document(gid).collection("messages")

    if body.parentMessageId is not None:
        parent_snap = messages_col.document(body.parentMessageId).get()
        if not getattr(parent_snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="parent_not_found",
                message="Parent message not found",
            )

    payload: dict[str, Any] = {
        "authorUid": user.uid,
        "body": body.body,
        "stickerIds": body.stickerIds,
        "mediaRefs": body.mediaRefs,
        "createdAt": fb_firestore.SERVER_TIMESTAMP,
        "editedAt": None,
        "deletedAt": None,
        "parentMessageId": body.parentMessageId,
        "threadReplyCount": 0,
    }
    if body.mentions:
        payload["mentions"] = body.mentions
    if body.repostOfThread is not None:
        payload["repostOfThread"] = body.repostOfThread

    new_ref = messages_col.document()
    new_ref.set(payload)

    snap = new_ref.get()
    return _doc_to_message(snap.id, snap.to_dict() or {})


@router.patch(
    "/{gid}/messages/{mid}",
    response_model=Message,
)
@limiter.limit(MESSAGE_EDIT)
def edit_message(
    request: Request,
    response: Response,
    body: EditMessageRequest,
    gid: str = Path(..., min_length=1),
    mid: str = Path(..., min_length=1),
    membership: MembershipContext = Depends(require_member),
    user: CurrentUser = Depends(require_not_banned),
) -> Message:
    """Edit a message's body. 15-minute window enforced server-side.

    Returns 403 `not_author`, 409 `edit_window_expired` or `deleted`,
    404 `message_not_found`.
    """
    require_not_archived(membership)
    db = get_firestore()
    ref = db.collection("groups").document(gid).collection("messages").document(mid)

    @gcf.transactional
    def _txn(txn: Any) -> dict[str, Any]:
        snap = ref.get(transaction=txn)
        if not getattr(snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="message_not_found",
                message="Message not found",
            )
        data = snap.to_dict() or {}
        if data.get("authorUid") != user.uid:
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author",
                message="Not the author of this message",
            )
        if data.get("deletedAt") is not None:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="deleted",
                message="Cannot edit a deleted message",
            )
        created = _ts_to_dt(data.get("createdAt"))
        if created is not None and datetime.now(UTC) - created > _EDIT_WINDOW:
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="edit_window_expired",
                message="Edit window has expired (15 minutes)",
            )
        txn.update(
            ref,
            {"body": body.body, "editedAt": fb_firestore.SERVER_TIMESTAMP},
        )
        return data

    _txn(db.transaction())
    fresh = ref.get()
    return _doc_to_message(fresh.id, fresh.to_dict() or {})


@router.delete(
    "/{gid}/messages/{mid}",
    response_model=Message,
)
@limiter.limit(MESSAGE_DELETE)
def delete_message(
    request: Request,
    response: Response,
    gid: str = Path(..., min_length=1),
    mid: str = Path(..., min_length=1),
    membership: MembershipContext = Depends(require_member),
    user: CurrentUser = Depends(require_not_banned),
) -> Message:
    """Soft-delete a message. Author or leader. Idempotent — calling
    delete twice returns 200 with the existing soft-deleted doc.
    """
    require_not_archived(membership)
    db = get_firestore()
    ref = db.collection("groups").document(gid).collection("messages").document(mid)

    deleter_role: str | None = None

    @gcf.transactional
    def _txn(txn: Any) -> dict[str, Any]:
        nonlocal deleter_role
        snap = ref.get(transaction=txn)
        if not getattr(snap, "exists", False):
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="message_not_found",
                message="Message not found",
            )
        data = snap.to_dict() or {}
        if data.get("deletedAt") is not None:
            # Idempotent: return the existing soft-deleted doc.
            deleter_role = "noop"
            return data
        is_author = data.get("authorUid") == user.uid
        is_leader = membership.role == "leader"
        if not (is_author or is_leader):
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_author_or_leader",
                message="Only the author or a group leader can delete this message",
            )
        deleter_role = "leader" if is_leader and not is_author else "author"
        txn.update(ref, {"deletedAt": fb_firestore.SERVER_TIMESTAMP})
        return data

    _txn(db.transaction())
    if deleter_role and deleter_role != "noop":
        write_audit_log(
            actor_uid=user.uid,
            action="message.delete",
            target_ref=f"groups/{gid}/messages/{mid}",
            payload={"gid": gid, "mid": mid, "deleter_role": deleter_role},
        )
    fresh = ref.get()
    msg = _doc_to_message(fresh.id, fresh.to_dict() or {})
    # Body redacted in the response per §4.13.3.
    return msg.model_copy(update={"body": ""})


# ── reactions ────────────────────────────────────────────────────────────


@router.post(
    "/{gid}/messages/{mid}/reactions/{slug}",
    response_model=ReactionResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(REACTION_TOGGLE)
def react_to_message(
    request: Request,
    response: Response,
    gid: str = Path(..., min_length=1),
    mid: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    membership: MembershipContext = Depends(require_member),
    user: CurrentUser = Depends(require_not_banned),
) -> ReactionResponse:
    """Add a reaction to a message. Validates sticker exists, group not
    archived, message not deleted. Returns the full updated reactionCounts.
    """
    require_not_archived(membership)
    db = get_firestore()

    sticker_snap = db.collection("stickers").document(slug).get()
    if not getattr(sticker_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="sticker_not_found",
            message="Sticker not found",
        )

    msg_ref = db.collection("groups").document(gid).collection("messages").document(mid)
    msg_snap = msg_ref.get()
    if not getattr(msg_snap, "exists", False):
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="message_not_found",
            message="Message not found",
        )
    if (msg_snap.to_dict() or {}).get("deletedAt") is not None:
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="message_deleted",
            message="Cannot react to a deleted message",
        )

    reaction_user_ref = (
        msg_ref.collection("reactions").document(slug).collection("users").document(user.uid)
    )
    now = datetime.now(UTC)
    reaction_user_ref.set({"reactedAt": fb_firestore.SERVER_TIMESTAMP})

    # reactionCounts is updated by a Cloud Function trigger; the handler
    # used to return a pre-trigger snapshot here but that value is stale
    # by definition. The next polled message-list response is
    # authoritative — see PR9 / H7. The client tracks `myReactions`
    # optimistically in the meantime via useReactions.
    return ReactionResponse(uid=user.uid, slug=slug, reactedAt=now)


@router.delete(
    "/{gid}/messages/{mid}/reactions/{slug}",
    response_model=ReactionRemovedResponse,
)
@limiter.limit(REACTION_TOGGLE)
def unreact_to_message(
    request: Request,
    response: Response,
    gid: str = Path(..., min_length=1),
    mid: str = Path(..., min_length=1),
    slug: str = Path(..., min_length=1, max_length=64),
    membership: MembershipContext = Depends(require_member),
    user: CurrentUser = Depends(require_not_banned),
) -> ReactionRemovedResponse:
    """Remove a reaction. Member-only — without `require_member`, non-members
    of the group could probe for message existence and reaction counts via
    the response shape. Banned users still get a 403 from `require_not_banned`.
    """
    _ = membership  # gid + member role enforced by the dep
    db = get_firestore()
    reaction_user_ref = (
        db.collection("groups")
        .document(gid)
        .collection("messages")
        .document(mid)
        .collection("reactions")
        .document(slug)
        .collection("users")
        .document(user.uid)
    )
    reaction_user_ref.delete()
    # No reactionCounts in the response — see PR9 / H7. The next polled
    # message-list response is authoritative.
    return ReactionRemovedResponse()


__all__ = ["router"]
