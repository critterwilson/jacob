"""Pydantic models for the users router (M2 of the data-layer migration).

These mirror what `firebase/firestore` clients used to read directly. The
shapes are deliberately permissive on read (extra Firestore fields like
`schemaVersion` get echoed back) and strict on write (Pydantic enforces
the same key allow-list and length predicates that
`firestore.rules:73-100` did).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class UserProfile(BaseModel):
    """Public-safe profile fields stored at `users/{uid}`.

    Mirrors the existing `frontend/lib/hooks/useUser.ts:UserProfile` so
    callers don't need to change.
    """

    uid: str
    displayName: str
    email: str | None = None
    photoURL: str | None = None
    role: str = "member"
    schemaVersion: int = 1
    isMinor: bool = False
    createdAt: datetime | None = None
    phone: str | None = None
    location: str | None = None
    faithBackground: str | None = None
    # T61 — user-facing locale ("en", "es", etc.). Optional; absent
    # means "fall back to the resolver chain (URL prefix > Accept-
    # Language > default)". Already consumed by T51 streak math.
    locale: str | None = None


class CreateProfileRequest(BaseModel):
    """`POST /api/users/me` body. Replaces `firestore.rules:73-86`."""

    model_config = ConfigDict(extra="forbid")

    displayName: str = Field(min_length=1, max_length=100)
    photoURL: HttpUrl | None = None
    isMinor: bool = False
    # Optional opt-ins shipped by the original onboarding form. Stored
    # alongside the public profile but not part of the rules allow-list
    # (handler decides whether to persist them).
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=100)
    faithBackground: str | None = Field(default=None, max_length=500)


class UpdateProfileRequest(BaseModel):
    """`PATCH /api/users/me` body. Replaces `firestore.rules:91-100`.

    All fields optional — only supplied keys are written. Pydantic's
    `extra=forbid` enforces the rules `changedKeys().hasOnly([...])`
    predicate.
    """

    model_config = ConfigDict(extra="forbid")

    displayName: str | None = Field(default=None, min_length=1, max_length=100)
    photoURL: HttpUrl | None = None
    isMinor: bool | None = None
    # T61 — locale opt-in. ISO 639-1 (lowercase) optionally suffixed
    # with a region (e.g. `es`, `en-US`). Validation kept narrow at
    # the model boundary; the i18n resolver normalises further.
    locale: str | None = Field(default=None, pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=100)
    faithBackground: str | None = Field(default=None, max_length=500)


class BootstrapClaims(BaseModel):
    admin: bool = False
    ministryOwner: bool = False


class BootstrapResponse(BaseModel):
    """`GET /api/users/me/bootstrap` response.

    `hasProfile` is the load-bearing field — `frontend/middleware.ts`
    redirects on absence of the corresponding cookie. `profile` is None
    iff `hasProfile` is False.

    `applicationStatus` (ADR 0012) is `"pending"` / `"approved"` /
    `"rejected"` if an `applications/{uid}` doc exists, otherwise None.
    The frontend routes pending users to `/awaiting-approval` and
    rejected users to the same page (which surfaces the rejection).
    Approved users are exactly the set with `hasProfile === true` —
    `applicationStatus === "approved"` is the matching audit signal.
    """

    profile: UserProfile | None
    hasProfile: bool
    claims: BootstrapClaims = Field(default_factory=BootstrapClaims)
    deletionRequestedAt: datetime | None = None
    applicationStatus: str | None = None


# ── notification preferences ────────────────────────────────────────────────


class NotificationPrefs(BaseModel):
    """`users/{uid}/notificationPrefs/main` body.

    Defaults match `firestore.rules:155-165` and the prior frontend
    `DEFAULT_PREFS` so an unset doc returns the same shape clients always
    saw.
    """

    model_config = ConfigDict(extra="forbid")

    mentions: bool = True
    replies: bool = True
    announcements: bool = True
    digest: bool = True
    # ADR 0011 — central ministry feed. Default off (opt-in) so new
    # users aren't surprised by a brand-new push channel.
    ministryFeed: bool = False
    schemaVersion: int = 1


# ── FCM device registration ──────────────────────────────────────────────────


class RegisterDeviceRequest(BaseModel):
    """`POST /api/users/me/devices` body. Replaces `firestore.rules:140-152`."""

    model_config = ConfigDict(extra="forbid")

    fcmToken: str = Field(min_length=1, max_length=4096)
    platform: Literal["web", "ios", "android"]
    userAgent: str = Field(max_length=256, default="")
    appVersion: str | None = None


class DeviceResponse(BaseModel):
    deviceId: str
    registeredAt: datetime


# ── notifications inbox ──────────────────────────────────────────────────────


class Notification(BaseModel):
    id: str
    kind: str
    createdAt: datetime
    readAt: datetime | None = None
    payload: dict[str, object] = Field(default_factory=dict)


class NotificationsListResponse(BaseModel):
    items: list[Notification]
    nextCursor: str | None = None


# ── mutes / blocks ──────────────────────────────────────────────────────────


class MutedUserEntry(BaseModel):
    uid: str
    displayName: str
    photoURL: str | None = None


class BlockedUserEntry(BaseModel):
    uid: str
    displayName: str
    photoURL: str | None = None


class MutesResponse(BaseModel):
    mutedUsers: list[MutedUserEntry]


class BlocksResponse(BaseModel):
    blockedUsers: list[BlockedUserEntry]


class MuteResponse(BaseModel):
    uid: str
    mutedAt: datetime


class BlockResponse(BaseModel):
    uid: str
    blockedAt: datetime
