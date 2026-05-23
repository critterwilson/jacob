# JACOB Firestore data model

This document describes every Firestore collection, who reads/writes it, and
shows an example of each document. Field semantics live here; access control
is enforced in [firestore/firestore.rules](../firestore/firestore.rules) and
verified in [firestore/tests/rules.test.ts](../firestore/tests/rules.test.ts).

Conventions:

- All timestamps are `serverTimestamp()`. Clients never write client time.
- `schemaVersion: 1` is set on user and group documents to support future
  migrations.
- Counters (`memberCount`, `threadReplyCount`) are maintained by Cloud
  Functions running with the Admin SDK; the client never updates them.

## Collection map

```
# User-scoped
users/{uid}
users/{uid}/private/{docId}
users/{uid}/mutes/{otherUid}                    # T21 — owner-only
users/{uid}/blocks/{otherUid}                   # T21 — owner-only
users/{uid}/mutedGroups/{gid}                   # ADR 0014 — per-group push silencing
users/{uid}/devices/{deviceId}                  # T34 — FCM device tokens
users/{uid}/notifications/{nid}                 # T34 — notification inbox
users/{uid}/notificationPrefs/main              # T34 — push/email toggle prefs
users/{uid}/exports/{jobId}                     # T38 — self-serve data export jobs
users/{uid}/plan_progress/{planId}              # T51 — reading-plan progress

# Group-scoped
groups/{gid}
groups/{gid}/members/{uid}
groups/{gid}/messages/{mid}
groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}  # T26
groups/{gid}/invites/{inviteId}                 # T25 — advanced invite links
groups/{gid}/events/{eid}                       # T49 — scheduled events
groups/{gid}/events/{eid}/rsvps/{uid}           # T49
groups/{gid}/joinRequests/{uid}                 # T30 — group-discovery join requests
groups/{gid}/sermons/{sermonId}                 # T52 — sermon archive

# Platform content
stickers/{stickerId}
daily_verse/{date}                              # T33 — daily Bible verse
devotionals/{slug}                              # T51 — flat; optional groupId field scopes to a group
reading_plans/{slug}                            # T51

# Cross-group boards
boards/{boardId}                                # T32 — top-level forums
boards/{boardId}/posts/{postId}                 # T32
boards/{boardId}/posts/{postId}/replies/{rid}   # T32
boards/{boardId}/posts/{postId}/reactions/{slug}/users/{uid}  # T32

# Central ministry feed (broadcast surface, ADR 0011)
ministry_feed/{postId}                          # owner-only writes, all-members read
ministry_feed/{postId}/reactions/{slug}/users/{uid}

# Moderation / trust-and-safety (backend only)
moderation_queue/{itemId}
bans/{uid}
appeals/{appealId}                              # T64 — ban appeals
ncmec_cases/{caseId}                            # T63 — NCMEC CyberTipline
transparency_reports/{reportId}                 # T65
audit_log/{eventId}

# Platform ops (backend only)
uploads/{uploadId}                              # in-flight upload tracking
active_incidents/{incidentId}                   # T59 — incident banners
watch_sessions/{sessionId}                      # T50 — Watch Together

# T54 — multi-tenant org tier
orgs/{orgId}
orgs/{orgId}/admins/{uid}
orgs/{orgId}/members/{uid}                      # denormalized via onMemberWrite
orgs/{orgId}/invites/{inviteId}                 # schema reserved; UI Phase 3.5
org_slugs/{slug}                                # backend only — slug uniqueness
org_consent_tokens/{token}                      # backend only — attach consent flow
domain_claims/{domain}                          # T55 — custom domain claims

# ADR 0015 — delegated leader-application queue
leader_applications/{appId}                     # owner-only via /api/admin/leader-applications*

# T58 — feature flags
feature_flags/{flagKey}                         # read via GET /api/flags

# Idempotency markers (subcollections, Cloud Functions only)
groups/{gid}/messages/{mid}/_events/{eid}
groups/{gid}/messages/{mid}/_reaction_events/{eid}
groups/{gid}/_member_events/{eid}
boards/{boardId}/_post_events/{eid}
boards/{boardId}/posts/{postId}/_reply_events/{eid}
boards/{boardId}/posts/{postId}/_events/{eid}   # board-post-create idempotency
ministry_feed/{postId}/_events/{eid}            # ADR 0011 — fan-out idempotency
ministry_feed/{postId}/_reaction_events/{eid}   # ADR 0011 — reaction count idempotency
orgs/{orgId}/_member_events/{eid}
users/{uid}/notifications/{nid}/_events/{eid}
```

---

## `users/{uid}`

Public-safe identity for an authenticated user. Readable only by the user
themselves; written only by the user themselves; deleted only via the
backend (T14).

```json
{
  "displayName": "Alice Anderson",
  "photoURL": "https://.../alice.jpg",
  "role": "member",
  "isMinor": false,
  "deletionRequestedAt": null,
  "schemaVersion": 1,
  "createdAt": "<serverTimestamp>"
}
```

- `role` is informational. Admin authorization is gated on the
  `admin` Firebase Auth custom claim, not this field.
- `role` and `createdAt` are immutable once set.

### `users/{uid}/private/{docId}`

PII and leader/mod-only fields the user should not expose. Owner-only
read/write.

Example `users/{uid}/private/profile`:

```json
{
  "email": "alice@example.com",
  "phone": null,
  "addressLine1": null,
  "lastSignInIp": "203.0.113.42"
}
```

### `users/{uid}/mutes/{otherUid}` and `users/{uid}/blocks/{otherUid}` (T21)

Per-user mute and block lists. Owner-only — no other user can read or
enumerate them.

- **Mute** is a soft hide: the muted user's messages collapse to a
  "Muted user · Show" stub. Notifications (T34, T35) consult the same
  set so muted users don't generate pushes / digest rows.
- **Block** is stronger: blocked-user messages are hidden entirely; the
  blocker disappears from the blockee's mention autocomplete (T27); no
  notifications fire either direction. Block is one-directional —
  symmetric blocking is a Phase 3 escalation tool.
- Self-mute and self-block are rejected by the rule (`otherUid != uid`).

```json
// users/{uid}/mutes/{otherUid}
{ "mutedAt": "<serverTimestamp>" }

// users/{uid}/blocks/{otherUid}
{ "blockedAt": "<serverTimestamp>" }
```

### `users/{uid}/mutedGroups/{gid}` (ADR 0014)

Per-group push silencing. Distinct from `mutes/{otherUid}` above (which
hides a specific user's messages everywhere). The presence of a
`mutedGroups/{gid}` doc only suppresses the generic `group_message`
push fan-out from that group for the owning user — @mentions and
replies to your own messages still come through, because those carry
an explicit ask for attention.

Backend-mediated via `/api/users/me/muted-groups/*`; the rule is
default-deny.

```json
// users/{uid}/mutedGroups/{gid}
{ "groupId": "g_pleasant_grove", "mutedAt": "<serverTimestamp>" }
```

---

## `groups/{gid}`

A small group. Members can read; only the leader can update metadata.
Created by any authenticated user, who must immediately self-add to
`members/{uid}` as `leader` to retain access (the bootstrap path in the
rules).

```json
{
  "name": "Pleasant Grove Tuesday Night",
  "description": "Tuesday night small group, Pleasant Grove campus.",
  "createdBy": "uid_alice",
  "createdAt": "<serverTimestamp>",
  "isPrivate": true,
  "inviteCode": "PG-TUE-7Q3X",
  "memberCount": 8,
  "stickerSet": "christian",
  "schemaVersion": 1
}
```

Leaders may update `name`, `description`, `isPrivate`, `inviteCode`,
`stickerSet`. `memberCount` is updated by a Cloud Function in response
to writes under `members/`.

### `groups/{gid}/members/{uid}`

Membership record. Two creation paths:

1. **Bootstrap.** The user identified by `groups/{gid}.createdBy` may
   self-add as `leader` once. Sequential client writes: create the group
   doc first, then this membership.
2. **Leader-add.** An existing leader may add any user as `member` or
   `leader`.

A user may delete their own membership (leave). A leader may delete any
membership in their group.

The `uid` field is required on writes from the backend (it equals the
doc ID) and lets clients discover their memberships in one round-trip
via a collection-group query — see
[ADR 0003](adr/0003-collection-group-memberships.md). It replaces the
legacy `users/{uid}.groupIds` mirror, which is no longer written.

```json
{
  "role": "leader",
  "joinedAt": "<serverTimestamp>",
  "uid": "alice"
}
```

### `groups/{gid}/messages/{mid}`

A chat message. Group members can read and create. Only the author can
edit (`body`, `editedAt`) or soft-delete (`deletedAt`). Hard deletion is
forbidden — soft-delete only.

`threadReplyCount` is maintained by a Cloud Function watching writes to
this collection; clients cannot update it. `searchTokens` is maintained
by the `onMessageTokenize` trigger (ADR 0016) — a lowercased,
word-tokenised, de-duplicated form of `body` capped at 100 entries,
used by `/api/search` for keyword `array-contains` queries.

Top-level message:

```json
{
  "authorUid": "uid_bob",
  "body": "Tonight's reading is John 15.",
  "stickerIds": [],
  "mediaRefs": [],
  "parentMessageId": null,
  "threadReplyCount": 2,
  "searchTokens": ["tonight", "s", "reading", "is", "john", "15"],
  "createdAt": "<serverTimestamp>",
  "editedAt": null,
  "deletedAt": null
}
```

Threaded reply (rules verify the parent message exists in the same
group at write time):

```json
{
  "authorUid": "uid_carol",
  "body": "Thanks — see you tonight.",
  "stickerIds": ["sticker_amen"],
  "mediaRefs": [],
  "parentMessageId": "msg_abc123",
  "threadReplyCount": 0,
  "createdAt": "<serverTimestamp>",
  "editedAt": null,
  "deletedAt": null
}
```

---

## `stickers/{stickerId}`

Author-applied message tags — "Prayer Request", "Praise Report",
"Check-In", etc. Attached at compose time via the `stickerIds` field
on the message document. **Distinct from emoji reactions**: those are
a fixed allowlist of emoji slugs (`like` / `love` / `pray` / `laugh`
/ `wow` / `sad`) defined in `backend/app/services/reactions.py` and
mirrored on the client in `frontend/lib/emojiReactions.ts`. The
reaction endpoint accepts either an emoji slug from that allowlist or
(for back-compat with reactions persisted before the split) a sticker
slug that exists in this collection.

Read-only for any authenticated user; seeded and maintained via the
Admin SDK (see seed scripts under [firestore/seed/](../firestore/seed/)).

```json
{
  "name": "Amen",
  "slug": "amen",
  "audience": "christian",
  "order": 10,
  "retiredAt": null
}
```

---

## `moderation_queue/{itemId}` (backend only)

Items pending human moderator review. Written by the moderation pipeline
(T11) and read/updated by the admin dashboard (T13). No client access.

```json
{
  "resourceRef": "groups/g_abc/messages/m_xyz",
  "reason": "vision_safesearch_adult",
  "status": "pending",
  "createdAt": "<serverTimestamp>",
  "reviewedBy": null
}
```

---

## `applications/{uid}` (backend only, ADR 0012 — **deprecated by ADR 0015**)

**Legacy.** The platform-wide admin-approval queue is retired by
[ADR 0015](adr/0015-delegated-membership.md). New signups create their
`users/{uid}` doc directly via `POST /api/users/me` and never write to
this collection. The submit endpoint `POST /api/applications/me` now
returns `410 Gone`; the legacy admin list/approve/reject endpoints stay
in place so any pre-migration pending docs can be drained.

The schema below is retained for the residual data. Default-deny in
`firestore.rules`.

```json
{
  "email": "alice@example.com",
  "displayName": "Alice",
  "photoURL": null,
  "dob": "2007-04-12",
  "isMinor": true,
  "phone": null,
  "location": null,
  "faithBackground": null,
  "inviteCode": "ABCD1234",
  "status": "pending",
  "createdAt": "<serverTimestamp>",
  "submittedAt": "<serverTimestamp>",
  "decidedAt": null,
  "decidedBy": null,
  "parentalConsentObtained": null,
  "parentalConsentNotes": "",
  "rejectionReason": "",
  "grandfathered": false
}
```

For under-18 applicants (`isMinor: true`) the admin approve endpoint
refuses to write `status: "approved"` unless the request body sets
`parentalConsentObtained: true`. Pre-existing users that pre-date this
collection are stamped with `grandfathered: true`,
`decidedBy: "system_grandfather"`, and `parentalConsentObtained: null`
by `infra/scripts/backfill_applications.py`.

`inviteCode` is set when the applicant arrived via `/join?code=<CODE>`
before signing up. The frontend stashes the code in sessionStorage at
the join landing and the onboarding form sends it on
`POST /api/applications/me`. On admin approval the approve endpoint
calls `consume_invite(code, uid)` after creating `users/{uid}` — a
failed consume (expired, revoked, at member cap, archived group) is
logged + audited but never blocks the approval. The field stays on
the doc after approval for audit / debugging; it is not re-consumed.

---

## `leader_applications/{appId}` (backend only, ADR 0015)

Delegated-membership queue: a non-owner submits a leader application
via `POST /api/leader-applications`; the ministry owner reviews via
`/api/admin/leader-applications*`. On approval the backend creates the
target `groups/{gid}` document with the applicant as leader and stamps
`createdGroupId` here for the audit trail. Default-deny in
`firestore.rules`.

```json
{
  "applicantUid": "alice",
  "applicantDisplayName": "Alice",
  "applicantEmail": "alice@example.com",
  "proposedGroupName": "Tuesday Night",
  "proposedGroupDescription": "Tuesday night small group, Pleasant Grove.",
  "proposedAudience": "christian",
  "motivation": "...",
  "status": "pending",
  "createdAt": "<serverTimestamp>",
  "decidedAt": null,
  "decidedBy": null,
  "decisionNotes": "",
  "createdGroupId": null
}
```

* `status` ∈ `"pending" | "approved" | "rejected"`.
* `decidedBy` is the owner uid that decided; `decisionNotes` is free
  text recorded against the application (approval comment or rejection
  reason — both share the field).
* `createdGroupId` is set when `status == "approved"`. It is the gid of
  the group the approval produced; the applicant is its leader.

## Minor-escalation fields on `groups/{gid}/joinRequests/{uid}` (ADR 0015)

The join-request schema introduced in PR #284 grows five new fields to
support the owner-side minor-review queue. Existing rows pre-dating
ADR 0015 lack these fields and default to "adult / leader-decided" —
the leader-side queue treats `requiresOwnerReview` as `false` when
missing.

```json
{
  "isMinor": false,
  "requiresOwnerReview": false,
  "inviteCode": null,
  "parentalConsentObtained": null,
  "parentalConsentNotes": ""
}
```

* `requiresOwnerReview` — true when the request must be decided by the
  ministry owner. Stamped on creation from `users/{uid}.isMinor`. The
  leader-side approve/reject endpoints refuse rows with this flag set
  (`403 minor_owner_review_required`).
* `isMinor` — denormalised from the user doc so the owner CG query
  doesn't have to re-fetch every user.
* `inviteCode` — set when the join-request was created from an invite
  landing (`POST /api/groups/join` for a minor). The owner approval
  endpoint runs `consume_invite(code, uid)` at decision time; failures
  are logged but never block the approval.
* `parentalConsentObtained` / `parentalConsentNotes` — owner-supplied
  attestation, mirroring the ADR 0012 § 3 model now relocated to the
  per-join-request decision.

---

## `bans/{uid}` (backend only)

Active bans. The presence of `bans/{request.auth.uid}` with
`expiresAt > now` causes every write rule in the system to deny via
`notBanned()`.

```json
{
  "reason": "Repeated violation of community guidelines",
  "bannedBy": "uid_admin",
  "expiresAt": "2026-06-01T00:00:00Z"
}
```

---

## `audit_log/{eventId}` (backend only)

Append-only record of admin/moderator actions. No client access; written
exclusively by the backend.

```json
{
  "actorUid": "uid_admin",
  "action": "ban_user",
  "targetRef": "users/uid_eve",
  "createdAt": "<serverTimestamp>",
  "payload": {
    "reason": "Repeated violation",
    "expiresAt": "2026-06-01T00:00:00Z"
  }
}
```

---

## `boards/{boardId}` (T32)

Top-level cross-group forums. Anyone signed in can read every board and
post. Boards are created exclusively via the backend (Admin SDK) by a
platform admin; there is no per-board admin role.

```json
{
  "name": "Prayer & praise",
  "slug": "prayer-praise",
  "description": "Cross-group prayer requests.",
  "audience": "christian",
  "createdAt": "<serverTimestamp>",
  "archivedAt": null,
  "postCount": 4,
  "schemaVersion": 1
}
```

- `slug` is globally unique and used in URLs (`/boards/<boardId>`).
- `archivedAt` is set by `DELETE /api/admin/boards/{id}` and prevents
  new posts/replies/reactions at the rule level.
- `postCount` is maintained by `onBoardPostWrite` (idempotent via
  `_post_events/{eventId}`) and is decremented on soft-delete.

### `boards/{boardId}/posts/{postId}`

```json
{
  "authorUid": "alice",
  "body": "Praying for you all this week.",
  "stickerIds": ["pray"],
  "mediaRefs": [],
  "createdAt": "<serverTimestamp>",
  "editedAt": null,
  "deletedAt": null,
  "pinnedAt": null,
  "pinnedBy": null,
  "mentions": [],
  "reactionCounts": {"pray": 4},
  "replyCount": 2,
  "moderation": { "state": "scored", "reasons": [], "scores": {} }
}
```

- **Stickers required.** Posts must include ≥1 sticker (the only
  categorisation on boards). Replies do not require a sticker.
- **Edit window:** authors can edit `body` within 15 minutes; soft-delete
  is open to author or platform admin at any time.
- **Pin / unpin:** platform-admin only via
  `POST /api/admin/boards/{boardId}/posts/{postId}/pin`.
- `mediaRefs` reuses the moderated upload pipeline with
  `purpose: "board_post"`.

### `boards/{boardId}/posts/{postId}/replies/{replyId}`

Same shape as posts, minus `pinnedAt`/`pinnedBy`/`reactionCounts`/
`replyCount`. Stickers are optional.

### `boards/{boardId}/posts/{postId}/reactions/{slug}/users/{uid}`

Mirrors T26 reactions: one doc per (slug, uid). `reactionCounts` on the
parent post is maintained by `onBoardReactionWrite` (which reuses the
shared `reactionDelta` / `runReactionTxn` helpers from
`onReactionWrite.ts`). Idempotent via `_reaction_events/{eventId}` under
the parent post.

---

## `ministry_feed/{postId}` (ADR 0011)

Top-level broadcast surface — readable by every signed-in member,
writable by users holding the `ministry_owner` Firebase custom claim.
All access flows through `/api/ministry-feed/*`; rules are default-deny.

```json
{
  "title": "Sunday devotional",
  "body": "Markdown body...",
  "sermonUrl": "https://...",
  "coverImageRef": "https://storage.googleapis.com/jacob-media-public-...",
  "authorUid": "owner-uid",
  "createdAt": "Timestamp",
  "editedAt": null,
  "deletedAt": null,
  "pinnedAt": null,
  "pinnedBy": null,
  "reactionCounts": { "pray": 12 }
}
```

Soft-delete only (`deletedAt` timestamp). Pinning is multi-allowed —
the list endpoint orders `pinnedAt DESC, createdAt DESC`.

### `ministry_feed/{postId}/reactions/{slug}/users/{uid}`

Same primitive as boards / group messages. `reactionCounts` denormed
by `onMinistryReactionWrite` via the shared `runReactionTxn` helper.

### Notifications fan-out

`onMinistryPostCreate` collection-group-queries `notificationPrefs`
where `ministryFeed == true` and writes one
`users/{uid}/notifications/{nid}` per opted-in user (excluding the
author and users who blocked them). The opt-in default is `false`
(see ADR 0011 §5). The standard `onNotificationCreate` trigger
dispatches FCM for each row.

---

## `orgs/{orgId}` (T54)

A church / ministry / school that owns one or more groups. The
parent of the group tier; backward-compatible because every
existing group has `orgId = null` (unaffiliated).

```json
{
  "name": "Pilot Church",
  "slug": "pilot-church",
  "description": "...",
  "audience": "christian",
  "logoUrl": null,
  "primaryColor": null,
  "customDomain": null,
  "customSubdomain": null,
  "createdBy": "<platform-admin-uid>",
  "createdAt": "<serverTimestamp>",
  "schemaVersion": 1,
  "billing": { "tier": "free", "customerId": null, "status": "active" },
  "llmModerationPolicy": "off",
  "threadSummaryEnabled": false,
  "semanticSearchEnabled": false,
  "prayerClusteringEnabled": false,
  "transparencyReportEnabled": false
}
```

* `slug` — URL-safe; reserved as the T55 subdomain claim. Stored
  also as the doc id of `org_slugs/{slug}` for at-most-one
  uniqueness.
* `audience` — `christian` / `bjj` / `general`. Immutable once set;
  changing it would invalidate every group's sticker history.
* `billing` — placeholder shape so Phase 4 paid tiers don't reshape
  the doc.
* AI policy fields (`llmModerationPolicy`, `*Enabled`) — reserved
  for T43–T47 if those tickets ship; UI not surfaced today.

### `orgs/{orgId}/admins/{uid}`

```json
{ "addedBy": "<actor-uid>", "addedAt": "<serverTimestamp>" }
```

* The platform admin creates the first admin at `POST /api/orgs`.
* Subsequent admins are added by existing admins via
  `POST /api/orgs/{orgId}/admins`.
* Last-admin removal is refused (mirrors T22's leader-count rule
  but enforced at the service layer because the rule engine can't
  enumerate a subcollection).

### `orgs/{orgId}/members/{uid}` (denormalized, T54)

Maintained by `onMemberWrite` (functions/src/onMemberWrite.ts).
Mirrors "user is in some group attached to this org." Querying it
live by collection-group filter would be expensive; the
denormalization keeps the dashboard cheap.

```json
{
  "joinedAt": "<serverTimestamp>",
  "groupIds": ["g1", "g3"]
}
```

* `groupIds` is the set of org-internal groups the user is a member
  of. The trigger arrayUnions on join, removes on leave, and deletes
  the doc when `groupIds` becomes empty.
* `attach_group` / `detach_group` in the service layer also
  back-fill / clear so attach + detach surfaces are self-repairing
  if the trigger ever drifts.

### `orgs/{orgId}/invites/{inviteId}` (T54 schema; UI Phase 3.5)

Same shape as `groups/{gid}/invites/{inviteId}` (T25), scoped to
the org. The endpoint that consumes it is Phase 3.5 work; the
schema is reserved here so the doc shape stays stable.

## `org_slugs/{slug}` (T54, backend only)

Acts as the slug uniqueness primitive. `{ orgId, createdAt }`. The
single-doc `create()` semantic on Firestore makes this an
at-most-one guarantee without needing a transaction.

## `org_consent_tokens/{token}` (T54, backend only)

Issued by `orgs_service.issue_consent_token` when an org admin
attempts to attach a group whose leader they are not. Sent to each
group leader by email; the org admin re-issues the attach call with
the consumed code.

```json
{
  "orgId": "o1",
  "gid": "g1",
  "issuedTo": "<leader-uid>",
  "issuedBy": "<org-admin-uid>",
  "expiresAt": "<+60min>",
  "consumedAt": null
}
```

* TTL: 60 minutes. Single-use. `consume_consent_token` marks
  `consumedAt` inside the verify transaction.

## `devotionals/{slug}` (T51)

Short scripture-paired reflections. Flat top-level collection, slug
globally unique — backed by `/api/devotionals*`; default-deny rules
keep every direct path closed.

```json
{
  "slug": "psalm-23",
  "title": "The Lord is my shepherd",
  "scriptureRef": "Psalm 23",
  "body": "Markdown body...",
  "audioUrl": null,
  "sourceAttribution": "Public domain.",
  "publishedAt": "<serverTimestamp>",
  "audience": "christian",
  "groupId": null,
  "createdBy": "<actor-uid>",
  "schemaVersion": 1
}
```

* `groupId` — **null** = platform-wide, authored by a `ministry_owner`
  and visible to every signed-in user. **Set** = scoped to that group,
  authored by a leader of the group, visible only to its members.
  Mirrors how `groups/{gid}/sermons/{sermonId}` works for sermons, but
  kept as one flat collection so platform + group entries can be merged
  into a single feed with a single Firestore query per scope (no
  per-group fan-out).
* The merged feed `GET /api/devotionals` returns platform entries plus
  every devotional whose `groupId` is in the caller's membership set,
  joined with the group name for labelling.
* The group-scoped surface `GET /api/groups/{gid}/devotionals` returns
  only entries with `groupId == gid` and is gated on membership.
* Mutations: platform-wide entries → `ministry_owner` or admin;
  group-scoped entries → leader of that group or admin. The same role
  rules apply to patch/delete (resolved against the doc's `groupId`,
  not the request body).
* Slugs are unique across the platform — a leader's choice of slug
  collides with everyone else's. Pick narrow group-prefixed slugs.

## `feature_flags/{flagKey}` (T58, backend only)

Self-evaluated server-side; clients call `GET /api/flags` and the
server returns a `{flagKey: bool}` map for the caller. Documented
in `docs/runbooks/feature-flags.md`.

```json
{
  "enabled": true,
  "rolloutPercentage": 50,
  "cohorts": {
    "uids": ["..."],
    "orgIds": ["..."],
    "roles": ["admin"]
  },
  "description": "Phase 3 mobile native app",
  "updatedBy": "<actor-uid>",
  "updatedAt": "<serverTimestamp>",
  "fullRolloutAt": null,
  "schemaVersion": 1
}
```

## Composite indexes

Defined in [firestore/firestore.indexes.json](../firestore/firestore.indexes.json):

| Collection         | Fields                                                | Used by                                   |
|--------------------|-------------------------------------------------------|-------------------------------------------|
| `messages`         | `parentMessageId ASC`, `createdAt DESC`               | top-level feed (parentMessageId == null) and thread reads (parentMessageId == <id>) |
| `moderation_queue` | `status ASC`, `createdAt ASC`                         | admin dashboard pending-queue listing     |
| `devotionals`      | `groupId ASC`, `publishedAt DESC`                     | group-scoped + platform-wide listings; supports `where groupId in […]` for the merged feed |
| `devotionals`      | `groupId ASC`, `audience ASC`, `publishedAt DESC`     | same listings with the optional audience filter applied |
