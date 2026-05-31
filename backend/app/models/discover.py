from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DiscoverGroup(BaseModel):
    gid: str
    name: str
    description: str
    memberCount: int
    audience: Literal["christian", "bjj", "general"]
    joinMode: Literal["open", "request"]
    leaderUids: list[str]
    stickerMixSnapshot: list[dict[str, object]]


class DiscoverGroupsResponse(BaseModel):
    groups: list[DiscoverGroup]
    nextCursor: str | None


class JoinRequest(BaseModel):
    message: str = Field(default="", max_length=280)


class JoinResponse(BaseModel):
    gid: str
    joined: bool = False
    pending: bool = False
    requestId: str | None = None
    # ADR 0015 — true when the request bubbled to the owner queue because
    # the requester is a minor. The frontend uses this to render a "your
    # request was sent to the organization for review" copy variant
    # instead of "your request was sent to the group leader".
    requiresOwnerReview: bool = False


class JoinModeRequest(BaseModel):
    joinMode: Literal["open", "request"]


class PendingRequest(BaseModel):
    uid: str
    displayName: str = ""
    photoURL: str | None = None
    message: str
    requestedAt: str  # ISO-8601
    # Two-step minor approval: adult requests are "pending"; a minor's
    # request starts at "pending_leader" (awaiting the group leader's
    # vouch). The leader queue surfaces both so the leader can act. Once
    # a leader vouches, the request becomes "pending_owner" and leaves
    # the leader queue for the owner queue — so this view never carries
    # that state.
    status: Literal["pending", "pending_leader", "approved", "rejected"]
    # ADR 0015 — denormalised onto the join-request doc. The leader queue
    # now surfaces minor rows (so the leader can vouch), with `isMinor`
    # true and the status set to "pending_leader" so the UI can render
    # the "your approval forwards to the owner" affordance.
    isMinor: bool = False
    requiresOwnerReview: bool = False
    inviteCode: str | None = None


class PendingRequestsResponse(BaseModel):
    requests: list[PendingRequest]
    nextCursor: str | None


class MinorJoinRequest(BaseModel):
    """Owner-facing view of a minor's pending join-request (ADR 0015).

    Carries the parent group's name so the owner queue can render the
    target group label without a per-row group lookup.
    """

    gid: str
    groupName: str = ""
    uid: str
    displayName: str = ""
    photoURL: str | None = None
    age: int | None = None
    message: str
    requestedAt: str  # ISO-8601
    inviteCode: str | None = None
    # Two-step minor approval: a request only reaches this owner queue
    # after a group leader has vouched. These carry who vouched and when
    # so the owner card can show "Leader-vouched: yes, by {name} on …".
    leaderVouchedByUid: str | None = None
    leaderVouchedByName: str = ""
    leaderVouchedAt: str | None = None  # ISO-8601


class MinorJoinRequestsResponse(BaseModel):
    requests: list[MinorJoinRequest]
    nextCursor: str | None = None


class ReviewResponse(BaseModel):
    gid: str
    uid: str
    # "pending_owner" is returned when a leader vouches for a minor: the
    # decision is forwarded to the owner rather than finalized.
    status: Literal["approved", "rejected", "pending_owner"]


class OwnerApproveJoinRequest(BaseModel):
    """`POST /api/admin/groups/{gid}/join-requests/{uid}/approve` body (ADR 0015).

    For under-18 join-requests the owner attests that parental consent
    was obtained, mirroring the ADR 0012 § 3 attestation model now
    relocated to the per-join-request decision.
    """

    model_config = ConfigDict(extra="forbid")

    parentalConsentObtained: bool = False
    parentalConsentNotes: str = Field(default="", max_length=2000)


class OwnerRejectJoinRequest(BaseModel):
    """`POST /api/admin/groups/{gid}/join-requests/{uid}/reject` body."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)
