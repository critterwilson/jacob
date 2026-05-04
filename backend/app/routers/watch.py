"""Watch Together router (T50).

Endpoints:

* `GET    /api/groups/{gid}/watch`                 — list active sessions
* `GET    /api/groups/{gid}/watch/{sessionId}`     — single session metadata
* `POST   /api/groups/{gid}/watch/start`           — start a new session
* `POST   /api/groups/{gid}/watch/{sessionId}/join`
* `POST   /api/groups/{gid}/watch/{sessionId}/end`
* `POST   /api/groups/{gid}/watch/{sessionId}/transfer` — leader transfer

Per M6 every Firestore write goes through here. RTDB playback state
(/watch/{gid}/{sessionId}) is written directly by the leader client;
the rules in `infra/firebase-rtdb-rules.json` enforce that the writer
*is* the current leader.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response, status
from firebase_admin import firestore as fb_firestore

from app.deps import (
    MembershipContext,
    require_member,
    require_member_not_banned,
)
from app.errors import APIError
from app.limits import GROUP_READ, WATCH_SESSION_START
from app.middleware.rate_limit import limiter
from app.models.watch import (
    WatchEndResponse,
    WatchJoinResponse,
    WatchSession,
    WatchSessionListResponse,
    WatchStartRequest,
    WatchStartResponse,
    WatchTransferRequest,
    WatchTransferResponse,
)
from app.services import watch as watch_service
from app.services.audit import write_audit_log
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/groups/{gid}/watch", tags=["watch"])


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


def _doc_to_session(snap: Any) -> WatchSession:
    data: dict[str, Any] = snap.to_dict() or {}
    return WatchSession(
        sessionId=snap.id,
        videoId=str(data.get("videoId", "")),
        sourceUrl=str(data.get("sourceUrl", "")),
        title=data.get("title"),
        thumbnailUrl=data.get("thumbnailUrl"),
        leaderUid=str(data.get("leaderUid", "")),
        createdBy=str(data.get("createdBy", "")),
        createdAt=_ts_to_str(data.get("createdAt")),
        endedAt=_ts_to_str(data.get("endedAt")),
        attendees=list(data.get("attendees") or []),
        durationSec=(
            int(data["durationSec"]) if data.get("durationSec") is not None else None
        ),
    )


@router.get("", response_model=WatchSessionListResponse)
@limiter.limit(GROUP_READ)
def list_sessions(
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> WatchSessionListResponse:
    db = _db()
    rows = watch_service.list_watch_sessions(db, gid=gid, only_active=True)
    sessions: list[WatchSession] = []
    for row in rows:
        snap = (
            db.collection("groups")
            .document(gid)
            .collection("watch_sessions")
            .document(row["sessionId"])
            .get()
        )
        sessions.append(_doc_to_session(snap))
    return WatchSessionListResponse(sessions=sessions)


@router.get("/{session_id}", response_model=WatchSession)
@limiter.limit(GROUP_READ)
def get_session(
    session_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member),
) -> WatchSession:
    db = _db()
    snap = (
        db.collection("groups")
        .document(gid)
        .collection("watch_sessions")
        .document(session_id)
        .get()
    )
    if not snap.exists:
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="session_not_found",
            message="Watch session not found",
        )
    return _doc_to_session(snap)


@router.post("/start", response_model=WatchStartResponse)
@limiter.limit(WATCH_SESSION_START)
def start_session(
    body: WatchStartRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> WatchStartResponse:
    db = _db()
    if (membership.group or {}).get("archivedAt"):
        raise APIError(
            status_code=status.HTTP_409_CONFLICT,
            code="group_archived",
            message="Cannot start a watch session in an archived group",
        )
    video_id = watch_service.extract_youtube_video_id(body.videoUrl)
    if not video_id:
        raise APIError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_youtube_url",
            message="videoUrl must be a YouTube watch / short URL",
        )
    metadata = watch_service.fetch_oembed_metadata(body.videoUrl)
    title = (metadata or {}).get("title")
    thumbnail = (metadata or {}).get("thumbnail")

    session_id = watch_service.create_watch_session(
        db,
        gid=gid,
        actor_uid=membership.uid,
        source_url=body.videoUrl,
        video_id=video_id,
        title=title,
        thumbnail=thumbnail,
    )
    write_audit_log(
        actor_uid=membership.uid,
        action="watch_session_start",
        target_ref=f"groups/{gid}/watch_sessions/{session_id}",
        payload={"videoId": video_id},
    )
    return WatchStartResponse(
        sessionId=session_id,
        videoId=video_id,
        title=title,
        thumbnailUrl=thumbnail,
    )


@router.post("/{session_id}/join", response_model=WatchJoinResponse)
@limiter.limit(WATCH_SESSION_START)
def join_session(
    session_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> WatchJoinResponse:
    db = _db()
    ok, reason, attendees = watch_service.join_watch_session(
        db, gid=gid, session_id=session_id, uid=membership.uid
    )
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="session_not_found",
                message="Watch session not found",
            )
        if reason == "already_ended":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="session_ended",
                message="Watch session has already ended",
            )
    return WatchJoinResponse(sessionId=session_id, attendees=attendees)


@router.post("/{session_id}/end", response_model=WatchEndResponse)
@limiter.limit(WATCH_SESSION_START)
def end_session(
    session_id: str,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> WatchEndResponse:
    db = _db()
    ok, reason, ended_at, duration = watch_service.end_watch_session(
        db, gid=gid, session_id=session_id, actor_uid=membership.uid
    )
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="session_not_found",
                message="Watch session not found",
            )
        if reason == "not_attendee":
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_attendee",
                message="Only attendees can end the session",
            )
    write_audit_log(
        actor_uid=membership.uid,
        action="watch_session_end",
        target_ref=f"groups/{gid}/watch_sessions/{session_id}",
        payload={"durationSec": duration},
    )
    return WatchEndResponse(
        sessionId=session_id,
        endedAt=_ts_to_str(ended_at) or "",
        durationSec=duration,
    )


@router.post(
    "/{session_id}/transfer",
    response_model=WatchTransferResponse,
)
@limiter.limit(WATCH_SESSION_START)
def transfer_leader(
    session_id: str,
    body: WatchTransferRequest,
    gid: str = Path(..., min_length=1),
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    membership: MembershipContext = Depends(require_member_not_banned),
) -> WatchTransferResponse:
    db = _db()
    ok, reason = watch_service.transfer_leader(
        db,
        gid=gid,
        session_id=session_id,
        current_leader_uid=membership.uid,
        new_leader_uid=body.newLeaderUid,
    )
    if not ok:
        if reason == "not_found":
            raise APIError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="session_not_found",
                message="Watch session not found",
            )
        if reason == "not_leader":
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code="not_leader",
                message="Only the current leader can transfer leadership",
            )
        if reason == "not_attendee":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="new_leader_not_attendee",
                message="New leader must be an attendee of the session",
            )
        if reason == "already_ended":
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="session_ended",
                message="Watch session has already ended",
            )
    write_audit_log(
        actor_uid=membership.uid,
        action="watch_session_transfer",
        target_ref=f"groups/{gid}/watch_sessions/{session_id}",
        payload={"newLeaderUid": body.newLeaderUid},
    )

    return WatchTransferResponse(sessionId=session_id, leaderUid=body.newLeaderUid)
