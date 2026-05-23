# ADR 0014 — `group_message` push notifications + per-group mute

**Status:** Accepted (2026-05-23)
**Authors:** group-message-push implementation pass
**Related:** `functions/src/onMessageCreate.ts`,
`functions/src/services/groupMessageFanout.ts`,
`functions/src/onNotificationCreate.ts`,
`backend/app/routers/users.py` (`/muted-groups/*`),
`frontend/lib/hooks/useMutedGroups.ts`,
`frontend/components/groups/MuteGroupButton.tsx`,
`docs/data-model.md` §`users/{uid}/mutedGroups/{gid}`,
`firestore/firestore.rules`

## Context

Through M5 the push pipeline shipped exactly the kinds it was originally
spec'd to ship: `mention`, `reply`, `board_mention`, `announcement`,
`ministry_post`, `event_reminder`. None of those fire for an ordinary
top-level group message — so a message that doesn't tag anyone notifies
no one. The ministry owner has been asked for normal chat-app behavior
("when someone messages your group, you get a push") for a while.

The constraints we carry in:

1. The fan-out producer is the same trigger that already runs on
   `groups/{gid}/messages/{mid}` create (moderation, mentions, sticker
   audience guard). Adding a second trigger on the same path would
   duplicate idempotency state and the cost-circuit checks for no
   reason — fold the fan-out into the existing trigger.
2. A user who is `@`-mentioned in a message and a recipient of the
   generic fan-out for the same message must see **one** push, not two
   ("you were mentioned" *and* "new message"). The mention is the more
   informative payload — preserve it; suppress the generic for that
   recipient on that write.
3. Thread replies are already handled by `onMessageWrite.ts` (writes a
   `reply` notification for every parent participant). The generic
   fan-out must skip thread replies entirely or it will double-push
   every reply.
4. A user must be able to silence a chatty group without disabling push
   for every group. The granularity is per-group, per-user.
5. Cost is a non-issue at JACOB's scale (FCM is free, notification doc
   writes stay inside Google's always-free tier). No throttling /
   batching is required for cost — but writes go through `WriteBatch`
   anyway because that's what every other fan-out trigger does.

## Decisions

### 1. New notification kind: `group_message`

Added to the `NotificationDoc.kind` union in
`functions/src/onNotificationCreate.ts`. Existing payload shape (kind,
`groupId`, `messageRef`, `fromUid`, `body`, `createdAt`, `readAt`) is
reused — nothing new at the doc level. The FCM payload uses
`💬 New message` as the title and collapses by group
(`collapseKey: group_message:${gid}`) so a burst of messages in one
group surfaces as one growing notification, not N stacked banners.

### 2. Fan-out lives in `onMessageCreate.ts`, after mention fan-out

The fan-out helper is in a new `functions/src/services/groupMessageFanout.ts`,
mirroring `services/mentionFanout.ts` so it can be unit-tested. It's
called from `onMessageCreate` only when:

- `data.parentMessageId` is unset (top-level message, not a thread reply); and
- `authorUid` is present.

It is called **after** the mention fan-out so the mention list can be
passed in as `alreadyNotifiedUids` and the helper can skip those
recipients (decision 3 below). Like the mention fan-out, failures are
logged but don't kill the trigger — moderation + mention work that
already succeeded above must not be lost on a fan-out hiccup.

### 3. Exclusion order

Inside `fanOutGroupMessage`:

1. Skip the author (no self-push). Same as `mentionFanout` and
   `onMinistryPostCreate`.
2. Skip uids already getting a `mention` notification for **this same
   message write**. Caller passes them in as `alreadyNotifiedUids`.
   This is what guarantees the "one notification per message per
   recipient" invariant called out in §Context decision 2.
3. Skip recipients who have a `users/{uid}/blocks/{authorUid}` doc.
   Mirrors the producer-side block suppression at T21.
4. Skip recipients who have a `users/{uid}/mutedGroups/{gid}` doc
   (decision 5 below).
5. Skip non-members. Implicit: the candidate list comes from
   `groups/{gid}/members` directly, so a non-member can never appear.

The block + mute checks run in parallel per candidate
(`Promise.all([blockSnap, muteSnap])`) — Firestore Admin SDK has no
batched-get for arbitrary doc paths, so per-recipient round-trips are
unavoidable at this layer. Group sizes are small (the product targets
~5–50 members), so this stays well below any cost line.

### 4. Idempotency: deterministic doc IDs keyed on `event.id`

Notification doc id: `group_message_${eventId}_${recipientUid}`. Same
pattern as `mention_${eventId}_${uid}` and `reply_${eventId}_${uid}`.
At-least-once redelivery of the trigger writes to the same N docs and
no recipient sees a duplicate push. The trigger's top-level `_events`
marker (set by `claimEventOnce`) short-circuits clean redeliveries
before the fan-out is even called; deterministic IDs are the belt that
covers the partial-failure case where `_events` is unset on retry.

### 5. New data: `users/{uid}/mutedGroups/{gid}`

A new subcollection under `users/{uid}`. Doc body: `{ groupId, mutedAt }`.
Default-deny rules — all access is backend-mediated via:

| Method | Path                                          | Body / Returns                |
| ------ | --------------------------------------------- | ----------------------------- |
| GET    | `/api/users/me/muted-groups`                  | `{ mutedGroups: [...] }`      |
| POST   | `/api/users/me/muted-groups/{group_id}`       | `{ groupId, mutedAt }` (201)  |
| DELETE | `/api/users/me/muted-groups/{group_id}`       | 204                           |

Why a new subcollection instead of folding into the existing
`users/{uid}/mutes/{otherUid}`:

- `mutes/{otherUid}` is keyed by user uid and the API surface
  (`GET /api/users/me/mutes`) hydrates each row to a `displayName`/
  `photoURL`. Mixing groups into the same collection muddles both the
  ID semantics (group ID vs user UID) and the hydration step.
- The parallel shape (`mutedGroups/{gid}` next to `mutes/{otherUid}`
  and `blocks/{otherUid}`) is the lowest-friction extension that
  preserves the existing rules + endpoints unchanged.

### 6. New pref: `notificationPrefs.groupMessages` (default `true`)

Adds a single key to `NotificationPrefs` (Pydantic model and the
matching frontend `NotificationPrefs` type). `KIND_TO_PREF` in
`onNotificationCreate.ts` maps `group_message → groupMessages`, so
flipping the pref off silences the kind for every group at once. The
per-group mute is the granular surface; the pref is the
turn-it-all-off escape hatch.

Default is `true` so the app behaves like every other chat app on a
fresh install (the whole point of this feature).

## Alternatives considered

- **Put the per-group mute under `notificationPrefs/main` as a
  `mutedGroupIds: string[]` array.** Rejected: Firestore arrays are
  bounded at ~20 K entries which is more than enough, but the array
  contract makes "is group X muted?" cost a full doc read on every
  fan-out call (an extra round-trip per recipient). A keyed doc lookup
  is the same cost as the existing block check.
- **Put the mute on `groups/{gid}/members/{uid}` as a
  `notificationsMutedAt` field.** Rejected: the member doc is leader-
  and-owner-writeable today, and the mute is an owner-only signal.
  Mixing them would require splitting the rules. Cleaner to keep mute
  state owned entirely by the user.
- **Drop the `alreadyNotifiedUids` parameter and let
  `onNotificationCreate` dedupe by recipient.** Rejected: the dedupe
  layer there is per-`event.id` per-`(uid,nid)`, which doesn't model
  "this recipient already got a different notification for this write."
  The cleanest place to coordinate is at the producer.

## Migration

None. The new pref defaults to `true`, the new subcollection starts
empty, and `KIND_TO_PREF` ignores unknown kinds — so an old
`notificationPrefs/main` doc without `groupMessages` continues to
deliver group messages (the `prefs[prefKey] === false` check in
`onNotificationCreate` short-circuits only on explicit `false`).
