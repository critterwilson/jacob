# ADR 0011 — Central ministry feed

**Status:** Accepted (2026-05-17)
**Authors:** ministry-feed implementation pass
**Related:** `docs/data-model.md`, `docs/runbooks/ministry-feed.md`

## Context

The ministry owner — currently a single person, also the platform
admin — wants a way to broadcast sermons, devotionals, and
announcements to *every* member, independent of any group. Per-group
sermon posting (T52) and per-group announcements (T24) already exist;
those stay. This is additive: a top-level surface visible from the main
nav that the owner writes and everyone reads.

This ADR locks in five decisions that the spec left to engineering
judgement.

## Decisions

### 1. New top-level collection, not a "super-group"

`ministry_feed/{postId}` is a new top-level Firestore collection,
parallel to `boards/` and the existing per-group collections. We did
not model it as a synthetic group with implicit membership.

Why:

* No membership table to keep current. "Every signed-in member" is
  the read-eligibility predicate, evaluated at request time.
* Cleaner mental model — the surface has fundamentally different
  semantics from a group (write-by-one, read-by-all) and shoehorning
  it into the group rules would muddy both surfaces.
* No accidental coupling to group features (events, RSVPs, watch
  sessions, leader analytics) that don't apply here.

### 2. Dedicated `ministry_owner` custom claim, not `admin`

Posting privileges are gated on a new `ministry_owner: true` Firebase
custom claim. `admin` does *not* imply `ministry_owner`. Admins can
grant or revoke `ministry_owner` via `/api/admin/users/{uid}/ministry-owner`.

Why:

* The responsibility is explicit and separately auditable. Today the
  same person holds both roles; that may not always be the case.
* The `admin` claim already grants a wide blast radius (bans,
  moderation queue, NCMEC, transparency reports). We don't want a
  future operator with one of those responsibilities to also be able
  to broadcast to every user as a side effect.
* The grant/revoke surface is a small one-off endpoint, not a new
  abstraction — the cost of the dedicated claim is near-zero.

Strict-identity check (`claims.get("ministry_owner") is True`) mirrors
the `admin` check at `backend/app/deps.py:160`; `1`/`"true"`/truthy
strings do not grant access.

### 3. Title + markdown body + optional sermon link + optional cover image. Reactions yes, comments no.

Post shape:

| Field           | Type           | Required | Notes                                |
| --------------- | -------------- | -------- | ------------------------------------ |
| `title`         | string ≤200    | yes      | Plain text.                          |
| `body`          | string ≤8000   | yes      | Markdown (rendered client-side).     |
| `sermonUrl`     | string \| null | no       | Optional external sermon/video link. |
| `coverImageRef` | string \| null | no       | GCS public-bucket URL only.          |

Reactions reuse the existing `reactions/{slug}/users/{uid}` primitive
and the existing `onBoardReactionWrite` count-denorm pattern (shared
helper `runReactionTxn`). The new `onMinistryReactionWrite` trigger is
~25 lines and bills nothing extra.

Comments are deliberately out of scope for v1. A broadcast channel
with comments turns into a moderation surface; we are choosing not to
sign up for that until the feature has demand. Users who want to
discuss a post can do so in their group chat — and the post is
addressable via the URL.

### 4. Pinning yes — single optional pinned post

The list endpoint orders `pinnedAt DESC, createdAt DESC`. Multiple
posts may be pinned simultaneously; the UI surfaces all of them at
the top with a "Pinned" badge. Pin/unpin is `POST` / `DELETE` on
`/api/ministry-feed/posts/{post_id}/pin`, ministry-owner-only.

Why pin at all: the owner will want a current sermon or devotional
to stay at the top of the feed even after a few quick announcements
land. Same compound index (`deletedAt ASC, pinnedAt DESC, createdAt
DESC`) the boards collection already uses.

### 5. Notifications opt-OUT by default; fan-out via Cloud Function

New `notificationPrefs.ministryFeed: bool` field, **default `false`**.
On post create, a Cloud Function (`onMinistryPostCreate`)
collection-group-queries `notificationPrefs` where `ministryFeed ==
true` and writes one notification doc per opted-in user via
`bulk_write_notifications`-equivalent batch logic. The existing
`onNotificationCreate` then dispatches FCM per the existing pipeline.
A new notification `kind` (`"ministry_post"`) is added and mapped to
the new pref key in `KIND_TO_PREF`.

Why default-out:

* The feature is new and untested at scale; we don't want every
  post to push to every member of every group while we learn what
  cadence the owner settles into. A user who explicitly turns the
  toggle on has signalled they want it.
* Inbox UX: writing inbox rows only for opted-in users means
  opted-out users don't see "Ministry feed posts" cluttering their
  notifications screen. This is why fan-out filters at write time,
  not in `onNotificationCreate`.
* Cost: a single broadcast at full opt-in could write
  ~thousands-of-rows in a batch. The CG-index lookup makes the
  subset cheap; the actual batch writes are paged at 500 (existing
  `bulk_write_notifications` convention).

CG index added: `notificationPrefs` field `ministryFeed`, scope
`COLLECTION_GROUP`. Matches the existing precedent for the `digest`
pref.

## Consequences

* New `ministry_feed/{postId}` and `ministry_feed/{postId}/reactions/{slug}/users/{uid}`
  paths added to `firestore.rules` as default-deny with companion
  rule tests.
* `notificationPrefs` shape gains one optional field. Existing docs
  default it to `false` via `_DEFAULT_NOTIFICATION_PREFS` so older
  rows behave correctly without backfill.
* Frontend nav gets a fifth top-level item (`Feed`). Compose UI is
  rendered only when `getIdTokenResult().claims.ministry_owner ===
  true` — read view is universal.
* No new external dependencies, no LLM/paid-service calls.

## Alternatives considered

* **Piggyback on `admin`.** Rejected per §2 — couples broadcast
  privilege to the wider admin surface for no offsetting benefit.
* **Model the feed as a synthetic "everyone" group.** Rejected per
  §1 — incurs membership-table maintenance and couples to features
  that don't apply (events, watch, analytics).
* **Default-IN notifications.** Rejected per §5 — opt-out feels
  pushy for a brand-new channel and risks setting a poor first
  impression. The toggle is one screen away for anyone who wants it.
* **Sub-document comments.** Out of scope. Reconsider once the
  broadcast cadence is established and comment moderation can be
  designed deliberately rather than retrofitted.
