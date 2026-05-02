# JACOB — Phase 2 Dev Plan

This is the development plan for Phase 2 of JACOB (the "Community" phase). Read `CLAUDE.md` first — it pins the conventions every task here inherits — and skim `DEV_PLAN.md` for the Phase 1 task spec format. Phase 2 picks up where Phase 1's `T18` left off.

## Goals

Phase 1 proved the core loop works for two or three pilot small groups. Phase 2 turns JACOB from a single-group messenger into a community platform:

1. **Replace Phase 1 stopgaps** — kill the Google Form report flow, harden moderation, fill the schema/test gaps left as M-class deferred items.
2. **Make groups feel alive** — pinned messages, announcements, reactions, mentions, search, leader analytics.
3. **Connect groups to each other** — discovery, read-only browsing, cross-group message boards.
4. **Get users back into the app** — web push notifications and weekly digest email.
5. **Bring the bar up to "real product"** — group settings UI, multi-leader hierarchy, PWA install, image responsiveness, self-serve data export.

## Success criteria for Phase 2

- Pilot groups stop saying "I have to remember to open the app" — at least one push notification or digest pulls each member back per week.
- A leader can run their group end-to-end without a JACOB engineer touching Firestore (rotate invites, transfer leadership, archive a group, pin announcements, see sticker mix).
- A new visitor can discover and join an open group in under 60 seconds without an out-of-band invite code.
- Every report goes into the in-app queue. The Google Form is decommissioned.
- Every Critical/High/Medium item from the May 2026 codebase review is either fixed or has a Phase 2 task that owns it.

## Non-goals (explicitly deferred to Phase 3+)

- Native iOS/Android. Phase 2 ships a PWA. React Native + Expo is Phase 3.
- Stripe / paid tiers. Phase 2 stays free for pilots.
- Video uploads. Storage cost + Cloud Video Intelligence pricing make this a Phase 3 decision.
- BJJ-specific sticker set + brand-voice variant. Phase 3.
- Real-time presence and typing indicators — they don't justify the listener cost at our group size.
- E2EE. Architecture decision is unchanged: server-side encryption only.
- Cross-group DMs. Phase 4 if at all.

## Dependencies on Phase 1

Phase 2 assumes everything in `DEV_PLAN.md` shipped, plus the merged review-fix PRs (Critical, High, Medium/Low). Where a Phase 2 task touches a Phase 1 surface that was incomplete, the dependency is called out in the task spec.

## How to use this document with Sonnet

Each task below is a standalone spec sized for one focused Sonnet session. Workflow is unchanged from Phase 1:

1. Open a new Claude Code session in the repo. `CLAUDE.md` loads automatically.
2. Tell Sonnet: *"Implement task `Tnn` from `docs/phase-2-dev-plan.md`. Read the task spec, then propose a plan before writing code."*
3. Review the plan. Push back if any acceptance criterion is missing or the model is reaching outside the task's `Out of scope`.
4. Approve, let it implement, review the diff against acceptance criteria.

Reserve **Opus** for: `T20` (automated text moderation), `T22` (multi-leader hierarchy + leaderless-group rule), `T28` (search sidecar — touches the cross-group permission boundary), `T32` (cross-group message boards — new top-level collection with new rule shape), `T38` (data export — irreversible PII surface), and any task whose Sonnet plan looks shaky.

## Task overview

| ID  | Task                                                  | Theme            | Depends on        | Notes        |
|-----|-------------------------------------------------------|------------------|-------------------|--------------|
| T19 | Native in-app reporting + moderation queue UX         | Moderation       | T12, T13          |              |
| T20 | Automated text moderation (Cloud Natural Language)    | Moderation       | T08, T13          | **Use Opus** |
| T21 | User-level mute + block                               | Moderation       | T05, T08          |              |
| T22 | Multi-leader hierarchy + leaderless-group guard       | Group lifecycle  | T07               | **Use Opus** |
| T23 | Group settings page (avatar, description, archival)   | Group lifecycle  | T07, T10, T22     |              |
| T24 | Pinned messages + announcements                       | Group lifecycle  | T08, T22          |              |
| T25 | Invite-link expiry, single-use codes, invite tracking | Group lifecycle  | T07               |              |
| T26 | Sticker reactions on messages                         | Engagement       | T06, T08          |              |
| T27 | @mentions + mention notifications                     | Engagement       | T08               |              |
| T28 | Full-text search sidecar (Typesense)                  | Engagement       | T07, T08          | **Use Opus** |
| T29 | Sticker analytics for leaders                         | Engagement       | T06, T16, T22     |              |
| T30 | Group discovery page                                  | Community        | T07, T23          |              |
| T31 | Cross-group read-only chat browsing                   | Community        | T08, T23, T30     |              |
| T32 | Cross-group message boards (forums)                   | Community        | T02, T06          | **Use Opus** |
| T33 | Bible verse feed (daily, automated)                   | Community        | T11               |              |
| T34 | Web push notifications via FCM                        | Notifications    | T05, T08, T09, T27|              |
| T35 | Weekly email digest with one-click unsubscribe        | Notifications    | T08, T18, T29     |              |
| T36 | PWA install + offline shell + cached recent messages  | Mobile / perf    | T11               |              |
| T37 | Image thumbnails + responsive media                   | Mobile / perf    | T10               |              |
| T38 | Self-serve data export (GDPR / DSAR)                  | Privacy          | T03, T14, T18     | **Use Opus** |
| T39 | Phase 1 deferred pickup — schema, infra, tests        | Foundation       | T01–T18           |              |

A reasonable solo cadence: 1 task per 4–6 days. Phase 2 should land in 14–18 weeks. Themes A (Moderation) and G (Foundation) are the highest-priority blocks — T19, T20, T39 should land before opening the app to a third pilot group.

---

## T19 — Native in-app reporting + moderation queue UX

**Goal:** Decommission the Google Form. Reports are written directly to `moderation_queue` from the app; the admin queue at `/admin/queue` gets filtering, severity, and bulk actions.

**Files:**
- `frontend/components/moderation/ReportDialog.tsx` — replaces `ReportLink`; opens a modal with structured fields
- `frontend/lib/hooks/useReport.ts` — calls the backend report endpoint
- `backend/app/routers/reports.py` — `POST /api/reports`
- `backend/app/services/reports.py` — writes to `moderation_queue`, applies dedup
- `frontend/app/admin/queue/page.tsx` — extended with status filter, reason filter, severity column
- `frontend/components/admin/QueueFilters.tsx`, `QueueRow.tsx`, `BulkActions.tsx`
- `firestore/firestore.rules` — `moderation_queue` create rule for authenticated reporters (server-side write only — see Behavior)
- `docs/moderation-runbook.md` — update: remove the Google Form section, add the in-app flow and SLA
- `frontend/lib/report-url.ts` — **delete** (and remove every import)

**Behavior:**
- Reportable surfaces (message, group, profile) get a "Report" button that opens `ReportDialog`. Fields: `reason` (one of `harassment | sexual | violence | self-harm | spam | other`), free-text context (max 500 chars), `resourceRef` (auto-filled).
- The dialog `POST /api/reports` with body `{ resourceType, resourceId, groupId?, reason, context }`. Backend writes to `moderation_queue` with `status: "pending"`, `severity: 1|2|3` (computed from `reason` — `sexual`/`self-harm`/`violence` start at 3, `harassment` at 2, others at 1), `reporterUid`, dedup key `(reporterUid, resourceRef, reason)` to prevent same-user-same-reason spam within 24h (return 200 with `dedup: true` instead of erroring).
- Queue page: paginated 25/page, sortable by `createdAt` and `severity`, filter chips for `status` (pending/approved/rejected) and `reason`. Each row shows resource preview, reason, severity badge, reporter (admin only), age.
- Bulk actions: select N rows → Approve all / Reject all / Reject + Ban reporter (for false-report clusters). Each action writes one `audit_log` entry per resolved row.

**Acceptance criteria:**
- Clicking Report on a message produces exactly one `moderation_queue` doc and a 200 from `POST /api/reports`. No Google Form is opened anywhere in the app.
- The queue page filters on `reason=sexual` show only those rows; the URL is shareable (`/admin/queue?reason=sexual&status=pending`).
- Dedup: same user reports the same message for `reason=spam` twice within 24h → only one queue doc exists.
- Anonymous (signed-out) report attempts return 401. Banned users return 403.
- The runbook no longer references "Google Form" and `frontend/lib/report-url.ts` is deleted (build fails if any import remains).
- Backend tests cover: happy path, dedup, unauthenticated, banned reporter, invalid `reason`.

**Out of scope:** Reporter-facing status visibility (Phase 3 — "your report was reviewed"), automated heuristics that promote severity (T20 covers content scoring; T19 just plumbs the field).

---

## T20 — Automated text moderation (Cloud Natural Language)

**Goal:** Newly-written messages are scored for toxicity, hate, and harassment by Cloud Natural Language. High-confidence hits auto-flag (or auto-hide) without waiting for a human report.

**This is the second-highest-stakes task in Phase 2 — false positives silence members; false negatives leave abuse up. Use Opus. Do not ship without per-group sensitivity defaults that a leader can override.**

**Files:**
- `functions/src/onMessageCreate.ts` — Firestore trigger on `groups/{gid}/messages/{mid}`, runs only on creation (not edit/delete) to control cost
- `functions/src/services/textModeration.ts` — Cloud NL API client (`moderateText`)
- `backend/app/routers/admin.py` — `POST /api/admin/groups/{gid}/moderation-policy` to set per-group sensitivity
- `firestore/firestore.rules` — `groups/{gid}.moderationPolicy` is a leader-only field; `messages/{mid}.moderation` is system-only
- `frontend/components/chat/MessageItem.tsx` — render the auto-hidden state ("Hidden pending review · Show anyway")
- `docs/moderation-pipeline.md` — extend with the text path
- `docs/runbooks/text-moderation-tuning.md` — thresholds, false-positive triage, kill switch

**Behavior:**
- `onMessageCreate` reads the new message, calls Cloud NL `moderateText` with circuit breaker (5 consecutive errors → open for 5 min, log `moderation_circuit_open`, treat all writes as "score=null" until closed). Default sensitivity per group: `standard`. Options: `lenient | standard | strict`.
- For each NL category (`Toxic`, `Insult`, `Profanity`, `Derogatory`, `Sexual`, `Violent`), compare against the policy threshold. If any category exceeds the **hide** threshold, set `messages/{mid}.moderation = { state: "hidden", reasons: [...], scores: {...}, scoredAt: ts }` and write to `moderation_queue` with severity 2 and `auto: true`. If it exceeds the **flag-only** threshold, just write to `moderation_queue` with severity 1.
- Hidden messages render placeholder text + a "Show anyway" toggle (per-user, client-only — Firestore is unchanged). The author always sees their own message.
- Per-group sensitivity is set by leaders via `POST /api/admin/groups/{gid}/moderation-policy`. Banned categories are platform-wide (sexual content involving minors is always hidden + escalated regardless of policy).
- Cost guardrail: hard cap of 5,000 NL API calls/day across all groups (env var, default in `backend/app/limits.py`). Over the cap, the trigger logs `moderation_quota_exceeded` and falls back to "score=null" for the day. Sentry alert at 80%.

**Acceptance criteria:**
- A test message containing a known toxic phrase under `standard` policy is hidden within 5s (cold-starts excepted) and produces a `moderation_queue` row with `auto: true`.
- A leader switching their group to `lenient` raises the threshold; the same message no longer hides (verified by re-running through the trigger via a manual re-score endpoint or by posting a fresh test message).
- The circuit breaker is exercised by a test that mocks 5 consecutive NL failures; subsequent messages are written with `scores: null` and a `moderation_circuit_open` log line.
- Daily cost guardrail is documented and enforced in code (test mocks the counter).
- `docs/runbooks/text-moderation-tuning.md` includes the kill-switch (`MODERATION_TEXT_DISABLED=true` env var → trigger no-ops).

**Out of scope:** Edit-time re-scoring (Phase 3; for now, an edit just clears `moderation` and a separate review pass is manual), per-user reputation weighting, multi-language support beyond English (Cloud NL handles this — flag in the runbook but don't tune for it).

---

## T21 — User-level mute + block

**Goal:** A user can hide content from another user (mute), or fully block them (no notifications, no mentions, no profile visibility). Per-user, not per-group.

**Files:**
- `firestore.rules` — `users/{uid}/mutes/{otherUid}` and `users/{uid}/blocks/{otherUid}` subcollections, owner-only read/write
- `frontend/lib/hooks/useMutes.ts`, `useBlocks.ts`
- `frontend/components/moderation/MuteButton.tsx`, `BlockButton.tsx` — surfaced on profile preview popover and in the message overflow menu
- `frontend/components/chat/MessageList.tsx` — collapse muted messages ("Muted user · Show"), hide blocked messages
- `frontend/app/settings/blocked/page.tsx` — list + unblock UI
- `docs/data-model.md` — add the two subcollections

**Behavior:**
- Mute is a single doc `users/{uid}/mutes/{otherUid}` with `mutedAt: serverTimestamp()`. The mute is enforced client-side: `MessageList` calls `useMutes()` and renders muted-user messages collapsed. Notifications (T34, T35) check the mute set before sending.
- Block is stronger: `users/{uid}/blocks/{otherUid}`. Blocked-user messages are not rendered at all, mentions from a blocked user do not produce notifications, and the blocker disappears from the blockee's mention autocomplete. Block is one-directional (the blockee can still see the blocker's messages — symmetric blocking is a Phase 3 escalation tool).
- Self-mute / self-block is a no-op (button hidden when `otherUid === currentUid`).
- Unmute / unblock is an immediate hard delete.

**Acceptance criteria:**
- Muting user B as user A collapses B's messages in A's view within one realtime tick.
- Blocking user B prevents B's `@A` mention from generating an in-app notification (test with the T27 hook).
- Rules tests confirm: only the owner can read/write their own mutes/blocks; other users cannot enumerate or read them.
- Unmute/unblock removes the doc and is reflected in the UI without refresh.
- Settings page lists blocked users and allows unblocking.

**Out of scope:** Group-leader-imposed mute (covered by ban in T13), reporting integrated into block flow (a "Block + Report" combo is nice-to-have; Phase 3).

---

## T22 — Multi-leader hierarchy + leaderless-group guard

**Goal:** A group can have multiple leaders. Leaders can grant or revoke leader status from other members and transfer the founder role. Leaderless groups become impossible.

**This task changes role semantics that other tasks rely on. Use Opus. Pair the rule change with rule tests before any client code lands.**

**Files:**
- `firestore.rules` — `groups/{gid}/members/{uid}.role in ['member','leader']`, plus the leaderless guard (see below)
- `firestore.rules` — `groups/{gid}.leaderCount` is system-only (write via Admin SDK / Cloud Function)
- `firestore.rules` — `groups/{gid}.founderUid` is set on create, never written again from clients (founder transfer goes through the backend)
- `functions/src/onMemberWrite.ts` — Firestore trigger that maintains `groups/{gid}.leaderCount` on member create/update/delete
- `backend/app/routers/groups.py` — `POST /api/groups/{gid}/leaders/{uid}/promote`, `POST /api/groups/{gid}/leaders/{uid}/demote`, `POST /api/groups/{gid}/founder/transfer`
- `frontend/app/groups/[gid]/members/page.tsx` — member list with role badges + leader-only actions
- `firestore/tests/leaders.rules.test.ts`

**Behavior:**
- Promote: any current leader can promote a member to leader. Backend validates leader status, writes `members/{targetUid}.role = "leader"` via Admin SDK, writes `audit_log`.
- Demote: any leader can demote another leader **except** the `founderUid` (founder cannot be demoted, only transferred). Self-demote is allowed only if `leaderCount > 1`.
- Founder transfer: the founder calls `POST /api/groups/{gid}/founder/transfer` with a target leader uid. Backend swaps `founderUid` atomically, writes `audit_log`. The previous founder remains a leader (not auto-demoted).
- Leaderless guard: a Firestore rule on `groups/{gid}/members/{uid}` update/delete reads `get(/databases/$(database)/documents/groups/$(gid)).data.leaderCount` and rejects writes that would drop the count to zero (the rule cannot do the math itself — the trigger keeps `leaderCount` updated; the rule rejects member self-deletion when `role == "leader"` and `leaderCount <= 1`).
- The denormalized counter is reconciled by a one-shot backfill script (`infra/scripts/backfill_leader_count.py`) that runs once during deploy.

**Acceptance criteria:**
- A leader can promote a member from the new members page; the badge updates within one realtime tick.
- The founder cannot be demoted via the API or directly from the client (rules tests confirm both paths).
- Self-demote is rejected when the user is the only leader. Self-leave is rejected when the user is the only leader (must transfer first).
- `leaderCount` matches `count(members where role == "leader")` after every write — verified by a Cloud Function unit test that mutates members and reads the counter.
- Backfill script run against the dev project produces a counter on every existing group that matches the truth.
- Rule tests: every `members/{uid}` write now exercises both leader-count cases (`> 1` allowed, `<= 1` blocked).

**Out of scope:** Per-group custom roles (e.g., "deacon", "co-host") — Phase 3; co-leader vs. moderator distinction beyond what `T13` already covers via the `admin` custom claim.

---

## T23 — Group settings page (avatar, description, archival)

**Goal:** Leaders can edit a group's metadata, upload a group avatar, toggle privacy, and archive a group.

**Files:**
- `frontend/app/groups/[gid]/settings/page.tsx` — leader-only settings
- `frontend/components/groups/GroupSettingsForm.tsx`
- `frontend/components/groups/GroupAvatarUpload.tsx` — uses the T10 moderation pipeline
- `firestore.rules` — `groups/{gid}` update accepts `name`, `description`, `isPrivate`, `avatarUrl`, `archivedAt` only when caller is a leader; `archivedAt == request.time && resource.data.archivedAt == null` for the archive transition
- `frontend/lib/hooks/useGroupMessages.ts` — disable message creation when `archivedAt != null`
- `firestore/tests/groups.rules.test.ts` — extend

**Behavior:**
- Edit name (max 80 chars), description (max 1000 chars), `isPrivate` (toggle visible only when group is currently in the discovery index — T30 will gate).
- Avatar upload: same moderated pipeline as user avatars — bytes go to quarantine bucket, `POST /api/uploads/{uploadId}/finalize`, on pass the public URL is written to `groups/{gid}.avatarUrl`.
- Archival: leader sets `archivedAt = serverTimestamp()`. The group becomes read-only for everyone (writes to `messages` are rejected by a new rule); existing messages remain visible. Unarchive is allowed within 60 days; after 60 days, group is hidden from the user's group list and only restorable via admin tooling.
- Members' chat UI shows a banner: "This group is archived. New messages are disabled. Unarchive to resume."

**Acceptance criteria:**
- Leader edits to `name`/`description` propagate within one realtime tick.
- A non-leader cannot reach the settings page (route guard) and cannot write the underlying fields (rules test).
- Avatar upload that fails SafeSearch is rejected (verifies T10 wiring with a new resource type).
- Archived group: `MessageInput` is disabled; new-message writes from the client are rejected by rules; old messages are still readable.
- Unarchiving within 60 days clears `archivedAt` and re-enables writes.

**Out of scope:** Group deletion (a hard-delete with cascading clean-up of messages, members, audit references is Phase 3 — archival is the v2 substitute), per-group theme/branding (Phase 4 playbook layer).

---

## T24 — Pinned messages + announcements

**Goal:** Leaders can pin up to 5 messages to the top of a group. "Announcement" is a pin that also fires a notification to every member.

**Files:**
- `firestore.rules` — `groups/{gid}.pinnedMessageIds` is a leader-only array, max length 5
- `firestore.rules` — `groups/{gid}/messages/{mid}.announcedAt` is leader-set-only
- `frontend/components/chat/PinnedBar.tsx` — collapsible bar at the top of the chat
- `frontend/components/chat/MessageItem.tsx` — pin/unpin overflow action for leaders, "Pin as announcement" variant
- `backend/app/routers/groups.py` — `POST /api/groups/{gid}/messages/{mid}/announce` (publishes notification)
- `functions/src/onAnnouncement.ts` — fan-out to push (T34) and digest queue (T35) — for now, write a notification record per member; T34/T35 read from this collection

**Behavior:**
- Pin: leader pins a message → `pinnedMessageIds` array union (max 5; server rule enforces). Pinned bar shows the latest pinned message body (truncated) with a "View all pinned" link to a sheet.
- Unpin: array remove.
- Announcement: a pin variant. Leader picks "Pin as announcement"; the backend sets `pinnedMessageIds` *and* `messages/{mid}.announcedAt = serverTimestamp()`, then writes one row per member into `users/{uid}/notifications/{nid}` with `kind: "announcement"`. Push (T34) and digest (T35) consume that collection.
- Removing an announcement removes only the pin; the notification rows stay (audit trail) but the pinned bar drops it.

**Acceptance criteria:**
- Pinning a 6th message replaces the oldest (server-enforced, rule test).
- Non-leader pin attempts return permission-denied (rules test).
- Posting an announcement writes one notification row per member of the group, atomically (transaction or batched commit; verified via test).
- The pinned bar is responsive at < 768px (collapses to a single line).
- The pinned bar updates within one realtime tick when a leader pins or unpins from another tab.

**Out of scope:** Scheduled announcements (Phase 3 content tools), pinned-message reactions distinct from regular reactions (T26 covers both — pinned messages just route through the same path).

---

## T25 — Invite-link expiry, single-use codes, invite tracking

**Goal:** Invite codes can expire, can be single-use, and produce tracking so a leader knows who joined via which link.

**Files:**
- New collection `groups/{gid}/invites/{inviteId}` — code, createdBy, createdAt, expiresAt?, maxUses?, useCount, lastUsedAt
- `firestore.rules` — `invites/{inviteId}` read by group members, write by leaders only via backend (Admin SDK)
- `backend/app/routers/groups.py` — `POST /api/groups/{gid}/invites` (create), `GET /api/groups/{gid}/invites` (list), `DELETE /api/groups/{gid}/invites/{inviteId}` (revoke). Modify the existing `POST /api/groups/join` to look up the code in the new collection, increment `useCount`, reject if expired or maxed.
- `frontend/app/groups/[gid]/settings/invites/page.tsx` — invite management UI
- The legacy `groups/{gid}.inviteCode` field is migrated to a single forever-link in `invites/`. Migration script: `infra/scripts/migrate_invite_codes.py`.

**Behavior:**
- Create invite: leader picks `expiry: never | 24h | 7d | 30d`, `maxUses: unlimited | 1 | 10 | 25`. Backend generates a fresh 8-char base32 code (collision-checked across all live invites in the group), writes the doc, returns the URL.
- Join flow consults the invite doc transactionally: if `expiresAt < now` or `useCount >= maxUses`, return 410 Gone with `code: "invite_expired"` (single-use case) or `code: "invite_maxed"`.
- Single-use semantics: `maxUses == 1` flips the invite to "spent" on the first successful join, in the same transaction that adds the joiner to `members/`.
- Revoke: leader deletes the invite doc; subsequent joins return 404.
- Leader sees a list of active invites with usage count, last-used timestamp, and a copy-link button.

**Acceptance criteria:**
- A 1-hour invite that has elapsed returns 410 on join attempt and shows "expired" in the leader's invite list.
- A single-use invite that's already been used returns 410 with `invite_maxed`.
- The migration script run against the dev project moves every `groups/{gid}.inviteCode` into the new collection; the legacy field is then null. Backend tests cover both pre- and post-migration code paths.
- Backend tests cover: create, list, revoke, join expired, join maxed, transactional double-use under concurrent joins (use Firestore emulator transaction semantics).

**Out of scope:** Email-delivered invites (Phase 3 growth surface), invite QR codes (Phase 3), per-link analytics dashboards (T29 covers leader analytics broadly).

---

## T26 — Sticker reactions on messages

**Goal:** Members can react to a message with a sticker. Reaction counts are denormalized and surface beneath the message.

**Files:**
- New subcollection `groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}` — owner-write, member-read
- `firestore.rules` — only the user themselves can add/remove their own reaction; only members of the group can read
- `groups/{gid}/messages/{mid}.reactionCounts` — system-maintained map `{ [stickerSlug]: count }`
- `functions/src/onReactionWrite.ts` — Firestore trigger (with `event.id` idempotency guard like T22's `onMemberWrite`) that updates the parent's `reactionCounts`
- `frontend/components/chat/ReactionBar.tsx`, `ReactionPicker.tsx`
- `frontend/lib/hooks/useReactions.ts`

**Behavior:**
- Hover/long-press a message → reaction picker (the same six stickers from T06). Tap to toggle. Toggling the same sticker the user already reacted with removes it.
- Reaction bar under each message renders only stickers with `count > 0`, ordered by count desc.
- Tapping a reaction with the user's own count > 0 removes their reaction; otherwise adds it.
- The Cloud Function is the only writer of `reactionCounts` (rules deny client writes). The function uses a transaction keyed by `event.id` stored as a sub-doc to avoid double-increment under at-least-once delivery (same pattern as the H1 fix from the Phase 1 review).

**Acceptance criteria:**
- Reacting from one tab updates the bar in another tab within 2s (cold-starts excepted).
- Removing a reaction decrements the count; deleting the underlying message clears all reactions (cascade handled by the trigger when `deletedAt` flips, leaving an empty `reactionCounts` map).
- Rule tests confirm: clients cannot write `reactionCounts`; clients can only write their own `reactions/{stickerSlug}/users/{uid}` doc.
- The trigger handles double-delivery cleanly — a unit test that fires the same `event.id` twice asserts the counter advances by exactly one.

**Out of scope:** Custom-emoji reactions (Phase 4), reaction notifications (deliberately not — too noisy for small groups).

---

## T27 — @mentions + mention notifications

**Goal:** Typing `@` in the message input opens an autocomplete of group members. Sending a message with mentions persists the mention list and produces in-app notifications.

**Files:**
- `frontend/components/chat/MentionInput.tsx` — wraps the existing `MessageInput`; adds the autocomplete dropdown
- `frontend/lib/mentions.ts` — parses `@displayName` tokens and resolves them against the member list
- `groups/{gid}/messages/{mid}.mentions` — array of uids (rule-validated against `members/`)
- `users/{uid}/notifications/{nid}` — used by both T24 announcements and T27 mentions; same shape
- `firestore.rules` — `mentions` array max length 10, every uid must be a member of the group

**Behavior:**
- `@` opens the autocomplete; up/down to navigate, Enter to insert. The displayed text is the member's displayName; the persisted token references their uid.
- On send, the client extracts uids and sets `mentions: [uid, ...]`. A Cloud Function (`onMessageCreate.ts` from T20 — extend it) reads `mentions` and writes one `users/{uid}/notifications/{nid}` row per mentioned user with `kind: "mention"`, `messageRef`, `groupId`.
- Mention rendering: in the chat feed, the token renders as a styled chip that links to the mentioned user's profile preview; if the viewer is the mentioned user, the chip is highlighted.
- Mute and block (T21) are honored: a mention from a blocked user does not generate a notification for the blocker.

**Acceptance criteria:**
- Typing `@` in the input opens the dropdown filtered by displayName prefix; arrow keys move the selection; the inserted token references the right uid.
- A message with `@A` produces exactly one row in `users/A/notifications/`.
- A user mentioning themselves does not produce a self-notification.
- Mentions array > 10 is rejected by the rule.
- Mentions referencing a non-member are rejected by the rule (test exercise).

**Out of scope:** `@here` / `@channel` aliases (Phase 3 — too noisy for small groups today), spell-checked nicknames (the displayName is the source of truth).

---

## T28 — Full-text search sidecar (Typesense)

**Goal:** Members can search messages across their groups with sub-second latency. Search index lives in a Typesense sidecar; a Cloud Function fans Firestore writes.

**Decide before starting:** Typesense Cloud vs. self-hosted Typesense on Cloud Run vs. Algolia. The plan-doc placeholder in `docs/JACOB_APP_PLAN.md` lists all three. **Use Opus.** Write a one-page ADR `docs/adr/0002-search-sidecar.md` before implementing.

**Files:**
- `docs/adr/0002-search-sidecar.md`
- `functions/src/onMessageIndex.ts` — Firestore trigger on `groups/{gid}/messages/{mid}` create/update/delete; upserts/deletes from Typesense
- `backend/app/routers/search.py` — `GET /api/search?q=...` — proxies to Typesense, scopes the query by the caller's group memberships
- `backend/app/services/search.py` — Typesense client wrapper, with circuit breaker + rate limit
- `frontend/components/search/SearchBar.tsx` — opens with `Cmd-K` from the app shell
- `frontend/app/search/page.tsx` — full-page results
- `frontend/lib/hooks/useSearch.ts`

**Behavior:**
- The trigger fans message creates/updates to Typesense with fields `id`, `groupId`, `authorUid`, `authorDisplayName`, `body`, `stickerIds`, `createdAt`, `parentMessageId`. Soft-deletes (deletedAt set) are removed from the index. Hard-deletes (T14 tombstoning) blank the body.
- The backend search endpoint (i) fetches the caller's group ids from `groups/{gid}/members` (single collection-group read on `members where uid == request.auth.uid`, indexed), (ii) issues a Typesense query with a `filter_by: groupId:[g1,g2,...]` clause. **The client cannot query Typesense directly** — that would bypass the per-group permission boundary. Document this in the ADR.
- Cost guardrail: `SEARCH_QUERY` rate limit (T17 style), 30/min/user. Circuit breaker around Typesense errors.
- Reindex script: `infra/scripts/reindex_messages.py` for full rebuild after a schema change.

**Acceptance criteria:**
- A new message is searchable within 5 seconds in another tab (cold-starts excepted).
- A user not in group `g1` cannot retrieve a `g1` message via search — verified by an integration test that calls the endpoint with a mocked id token from a non-member.
- Soft-delete a message → it disappears from search within 5s.
- The reindex script run against the dev project rebuilds the index from a fresh Typesense container; counts match Firestore counts to within a 1% margin.
- The ADR captures the chosen vendor, the cost projection, and the operational ownership.

**Out of scope:** Boolean operators, fuzzy nicknames, search-within-thread (Phase 3 — current scope is "find any message I can read"), search analytics (T29 covers leader-facing analytics).

---

## T29 — Sticker analytics for leaders

**Goal:** Leaders see a weekly breakdown of sticker mix, top contributors, and posting cadence in their group. Reads come from BigQuery, not Firestore.

**Files:**
- `infra/scheduled/firestore_to_bigquery.py` — Cloud Scheduler + Cloud Run job that runs a Firestore export → BigQuery load step daily (the daily Firestore export from T16 already lands in `gs://jacob-backups-...`; this job re-uses it)
- `infra/bigquery/views.sql` — three views: `messages_daily`, `sticker_mix_weekly`, `top_contributors_weekly`
- `backend/app/routers/analytics.py` — `GET /api/groups/{gid}/analytics?range=7d|30d` (leader-only)
- `frontend/app/groups/[gid]/analytics/page.tsx` — read-only dashboard
- `frontend/components/analytics/StickerMixChart.tsx`, `ContributorList.tsx`, `CadenceChart.tsx`
- `docs/runbooks/bigquery-export.md`

**Behavior:**
- Daily job: read yesterday's Firestore export from GCS, load into BigQuery dataset `jacob_analytics.messages_raw`. Idempotent: re-running the same day's load replaces the partition.
- Three pre-baked views aggregate by group + day + sticker.
- Backend endpoint authenticates leader (`require_admin` or membership-with-leader-role check), queries BigQuery scoped to `WHERE groupId = ?`, returns a small JSON payload (total messages, sticker mix, top 5 contributors, daily cadence). Cached in-memory for 1h per group.
- Cost guardrail: query cost ceiling (`maximum_bytes_billed = 10 GiB` per query). BigQuery slot reservation is not required at this scale.

**Acceptance criteria:**
- Posting fresh messages today appears in the dashboard tomorrow (the export is daily).
- Non-leader members hitting `/groups/[gid]/analytics` are redirected to the chat (route guard) and the API returns 403 (backend test).
- Sticker mix percentages sum to 100 (within a rounding margin) and match a hand-counted tally for a known week in the test fixture.
- The BigQuery load is idempotent — running it twice for the same day produces the same row count.
- Runbook covers backfill (re-run the loader for a date range) and schema migration (re-create views).

**Out of scope:** Real-time analytics (the daily lag is acceptable; real-time analytics require streaming export which is paid), platform-wide admin analytics across all groups (Phase 3), exporting analytics CSV (Phase 3).

---

## T30 — Group discovery page

**Goal:** A signed-in user can browse public groups, filter, and request to join.

**Files:**
- `frontend/app/discover/page.tsx`
- `frontend/components/discover/GroupCard.tsx`, `DiscoverFilters.tsx`
- `firestore.rules` — `groups/{gid}` read with `isPrivate == false` accessible to any signed-in user (a narrowing of the current member-only rule)
- `firestore.indexes.json` — composite index on `(isPrivate, memberCount desc, createdAt desc)`
- `backend/app/routers/groups.py` — `POST /api/groups/{gid}/join-request` for groups that opt into "request to join" rather than open join

**Behavior:**
- Discovery list shows public groups ordered by `memberCount desc`, with filters `audience` (christian | bjj | general — for now only `christian`), and search by `name` prefix.
- Each group card shows name, description, member count, leaders, sticker mix snapshot (read from T29's view).
- Two join modes: open (current behavior — invite code or one-click join via the discovery page) and request-to-join (a new mode set on the group; leader must approve). Pending requests live at `groups/{gid}/joinRequests/{uid}`.
- Group leaders see a "Join requests" tab in their settings (T23).

**Acceptance criteria:**
- The discovery list excludes private groups (rules test confirms).
- Pagination works (50 per page, cursor-based).
- A user requesting to join a request-only group cannot read the group's messages until approved (rules test).
- A leader approving a join request adds the user to `members/` and writes an audit row.
- The audience filter renders correctly even when only one option exists today (forward-compat for Phase 3 BJJ).

**Out of scope:** Discovery ranking that uses engagement signals (Phase 3), group recommendations ("groups like yours") (Phase 3), paid promotion (never).

---

## T31 — Cross-group read-only chat browsing

**Goal:** A user can browse the recent feed of any public group they're not a member of, read-only.

**Files:**
- `firestore.rules` — `groups/{gid}/messages` read access widened to "any signed-in user when `groups/{gid}.isPrivate == false` AND message has `parentMessageId == null` AND `deletedAt == null`"
- `frontend/app/discover/[gid]/page.tsx` — read-only feed (no input box, no reply, no react)
- `frontend/components/chat/MessageList.tsx` — accepts a `readonly` prop

**Behavior:**
- The reused `MessageList` renders the public group's feed identically minus interactive affordances (no react, no reply, no thread-open — threads are private).
- Photos in a public group are served via the public bucket (T10), so they're visible.
- A "Join group" button at the top of the read-only feed routes through T30's join flow (open or request).

**Acceptance criteria:**
- A non-member of a public group can read its top-level feed but cannot see threads.
- Reading a private group as a non-member is denied (rules test).
- The "Reply" / "React" / "Pin" affordances do not render in read-only mode.
- Soft-deleted messages are not visible to non-members (rule test).

**Out of scope:** Cross-group thread visibility (intentionally private), cross-group search (T28 deliberately scopes to memberships).

---

## T32 — Cross-group message boards (forums)

**Goal:** A new top-level resource — message boards. Anyone signed in can read and post; posts require a sticker tag like messages do. Used for cross-group conversation that doesn't belong inside one group.

**Use Opus. New top-level collection means a new rule shape; the Phase 1 review found that ad-hoc rules drift quickly.**

**Files:**
- New collections `boards/{boardId}` (top-level), `boards/{boardId}/posts/{postId}`, `boards/{boardId}/posts/{postId}/replies/{replyId}`
- `firestore.rules` — full ruleset for boards: read for any signed-in user, create post for any signed-in user with `authorUid == request.auth.uid`, edit/delete only by author or admin, report supported via T19
- `firestore.indexes.json` — composite indexes for board listings and post-by-recency
- `backend/app/routers/boards.py` — `POST /api/boards` (admin-only create), `GET /api/boards`
- `frontend/app/boards/page.tsx`, `frontend/app/boards/[boardId]/page.tsx`, `frontend/app/boards/[boardId]/[postId]/page.tsx`
- Boards are seeded by an admin script: `infra/scripts/seed_boards.py` creates an initial set (e.g., "Prayer & praise", "Resources", "Events").

**Behavior:**
- Posts require a sticker tag (T06). Replies inherit (same rule as T09 chat threads).
- Posts and replies go through T20's text moderation trigger by reusing the `onMessageCreate` shape on a different path (the trigger registers two paths).
- Reactions (T26) and mentions (T27) work the same way on board posts.
- Board admins (a new custom claim or a `boards/{boardId}.adminUids` array) can pin a post or remove a post; ordinary admins (T13) retain platform-wide moderation.

**Acceptance criteria:**
- A signed-in user can read every board, post to any board, and react to posts.
- A signed-out user is redirected to sign-in when posting (route guard); rule denies anonymous writes.
- The text-moderation trigger fires on a board post the same way it fires on a group message (T20 test extended).
- Posts and replies are tombstoned correctly when the author deletes their account (T14 + new path coverage).
- Rule tests cover: create as signed-in, edit as non-author (denied), delete as author, delete as admin, report (denied to client write — must go through T19).

**Out of scope:** Per-board membership/follow (Phase 3), board-level moderation queues separate from the platform queue (Phase 3), rich content blocks (markdown is Phase 3).

---

## T33 — Bible verse feed (daily, automated)

**Goal:** Authed home page shows a daily Bible verse, fetched from a public-domain API and cached.

**Files:**
- `infra/scheduled/daily_verse.py` — Cloud Scheduler job (07:00 UTC) that fetches a verse and writes `daily_verse/{YYYY-MM-DD}` in Firestore
- `backend/app/services/verse.py` — wraps the upstream API (e.g., `bible-api.com` for KJV/WEB; switch to a paid translation later if needed)
- `frontend/components/home/DailyVerse.tsx` — renders today's verse
- `frontend/lib/hooks/useDailyVerse.ts`
- `firestore.rules` — `daily_verse/{day}` read for any signed-in user, write Admin SDK only
- `infra/seed/verse_calendar.json` — curated overrides for liturgical seasons (Advent, Lent, Easter, Pentecost)

**Behavior:**
- Job logic: if today's date is in `verse_calendar.json`, use that verse reference. Otherwise fall back to a deterministic rotation through a list of 365 references (commit the list to the seed file).
- Job fetches the verse text, stores both the reference and the rendered text in Firestore.
- Frontend reads `daily_verse/{today}`. If the doc is missing (job hasn't run yet), `DailyVerse` renders a placeholder ("A new verse will appear shortly").
- Translation: WEB or KJV (public domain). Document the choice and the upgrade path.

**Acceptance criteria:**
- The job populates today's verse by 07:30 UTC daily for 7 consecutive days in dev.
- The home page renders today's verse without an additional network call (Firestore listener — single read).
- Liturgical override: a calendar entry for `2026-04-05` (a sample Lent date) renders that override even if the rotation would have chosen something else.
- Job idempotency: running the job twice on the same day overwrites only the same doc; doesn't duplicate.

**Out of scope:** Multi-translation support (Phase 3), per-user reading plans (Phase 4), commentary/devotionals (Phase 4 playbook layer).

---

## T34 — Web push notifications via FCM

**Goal:** Members receive a web push notification for thread replies in threads they posted in, for `@mentions`, and for announcements.

**Files:**
- `frontend/public/firebase-messaging-sw.js` — service worker for FCM
- `frontend/lib/push.ts` — token registration, permission flow
- `frontend/lib/hooks/usePushSetup.ts`
- `users/{uid}/devices/{deviceId}` — { fcmToken, createdAt, lastSeenAt, userAgent }
- `functions/src/onNotificationCreate.ts` — Firestore trigger on `users/{uid}/notifications/{nid}`; reads the user's devices and sends an FCM message to each
- `frontend/app/settings/notifications/page.tsx` — per-kind opt-in toggles (mentions, replies, announcements, digest)

**Behavior:**
- On first sign-in after T34 ships, the home page shows an in-app banner offering push enrollment. Clicking accepts the browser permission and registers the FCM token at `users/{uid}/devices/{deviceId}`. Skip is honored — banner doesn't reappear for 7 days.
- The `notifications/` collection from T24 + T27 is the single source of truth for "things to notify about." `onNotificationCreate` reads the user's preference toggles and devices, sends an FCM payload with deeplink, and writes back `deliveredAt` (or `failedAt` + reason).
- Token rotation: on each app load, refresh the token; if it changed, update the device doc.
- Stale token cleanup: a daily Cloud Scheduler sweep deletes device docs where `lastSeenAt > 60 days`.
- Per-kind preferences default to: mentions on, replies on, announcements on, digest on.

**Acceptance criteria:**
- Posting a reply in a thread user A previously replied in surfaces a push notification on user A's device within 10s.
- A user with mentions disabled does not get a mention push (the trigger checks the preference).
- Token cleanup runs and removes stale device docs in dev (verified with a back-dated `lastSeenAt`).
- Firefox + Safari support is documented (Safari requires APNs-via-FCM web push, available since Safari 16+ — capture the caveats in `docs/runbooks/push.md`).
- Sentry captures FCM send failures with the device id (no PII).

**Out of scope:** Native iOS/Android push (Phase 3), notification grouping/badges (Phase 3), in-app notification center separate from push (the `notifications/{nid}` collection is the v2 substitute — Phase 3 builds the inbox UI on top).

---

## T35 — Weekly email digest with one-click unsubscribe

**Goal:** Every member with email opted in receives a weekly digest summarizing activity in their groups.

**Files:**
- `infra/scheduled/weekly_digest.py` — Cloud Scheduler + Cloud Run job (Sundays 16:00 user-local — see Behavior)
- `backend/app/services/digest.py` — assembles per-user payload
- `backend/app/templates/email/weekly_digest.html.j2`, `weekly_digest.txt.j2`
- `users/{uid}.notificationPrefs.digest` (boolean, default true)
- `backend/app/routers/account.py` — `GET /api/unsubscribe?token=...` for one-click unsubscribe (no auth required — token is a signed JWT with `uid` + `kind`)

**Behavior:**
- Job iterates over users with `notificationPrefs.digest != false`. For each, build a digest from BigQuery (T29 views): top 3 stickers across their groups, count of replies missed, count of new members across their groups, today's verse.
- Sends via SendGrid (T18). Includes a one-click unsubscribe URL (`/api/unsubscribe?token=...`) in both the body and `List-Unsubscribe` header (RFC 8058 one-click compliance).
- Job runs in batches of 200 with a 1s sleep between batches to stay under SendGrid's burst limit.
- Local-time approximation: schedule by user-stored `tz` (best-effort; default UTC if unset). For Phase 2 we accept "Sunday afternoon" granularity; precise per-tz is Phase 3.

**Acceptance criteria:**
- Job sends to a dev SendGrid sandbox key for 100 fake users in under 5 minutes.
- Unsubscribe link flips `notificationPrefs.digest` to false; subsequent runs skip the user.
- `List-Unsubscribe` header is set and Gmail's "Unsubscribe" button is shown (verified by sending one to a real Gmail in dev).
- Digest body shows zero rows for a user whose groups had no activity (the email still sends but says "Quiet week — see you next Sunday").

**Out of scope:** Daily digest, per-group digests, transactional retries beyond SendGrid's built-in backoff, GDPR data residency for EU users (T38 + the GDPR doc cover that).

---

## T36 — PWA install + offline shell + cached recent messages

**Goal:** JACOB is installable as a PWA. The app shell loads offline. The active group's last 50 messages are available in read-only mode without network.

**Files:**
- `frontend/public/manifest.webmanifest`, icons
- `frontend/app/sw.ts` — service worker built via `next-pwa` or hand-rolled (decide before starting)
- `frontend/lib/offline-cache.ts` — IndexedDB wrapper for messages
- `frontend/components/chat/MessageList.tsx` — fall back to cached snapshot when Firestore listener errors with offline
- `frontend/components/nav/InstallPrompt.tsx` — surfaces the install banner once per device

**Behavior:**
- Install prompt: shown on home page on first authed visit, dismissible. iOS/Android variants (Add to Home Screen flow on iOS).
- Service worker caches the app shell (HTML, JS chunks, fonts, CSS) with stale-while-revalidate. Skips Firestore writes (those go through the SDK's own offline queue).
- Active group's recent messages are mirrored into IndexedDB every time the realtime listener fires. On app reload offline, the cached messages render in read-only mode with a banner: "Offline — showing your last loaded messages."
- Cache size cap: 10 MB across all active groups; evict oldest groups first when over.
- Cache lifetime: clear on sign-out (privacy — no other user should see the cached messages on a shared device).

**Acceptance criteria:**
- The app loads offline after one online visit (Lighthouse PWA score ≥ 90).
- Last 50 messages of the active group remain visible offline.
- Sign-out clears IndexedDB (verified in a test).
- Install prompt does not reappear after dismissal (verified across page reloads).
- Service worker is unregistered cleanly during `npm run dev` if `NEXT_PUBLIC_DISABLE_SW=true` (developer ergonomics).

**Out of scope:** Offline writes (the user types while offline → message queued for send) — Phase 3, requires conflict resolution; native install (Capacitor / RN — Phase 3).

---

## T37 — Image thumbnails + responsive media

**Goal:** Photos served from the public bucket have generated 320/640/1280 variants. The chat UI uses `srcset` for bandwidth and layout shift.

**Files:**
- `functions/src/onPhotoUploadFinalize.ts` — Cloud Function (Storage trigger on the public bucket) that generates 320/640/1280 JPEGs via `sharp` and writes them under `derived/{originalName}_{w}.jpg`
- `backend/app/services/storage.py` — return `{ original, w320, w640, w1280 }` from the finalize endpoint
- `frontend/components/chat/PhotoView.tsx` — uses `<img srcset="...">`, supports lazy loading + AVIF fallback
- `infra/buckets.tf` — derived path lifecycle: keep for 90 days then re-derive on demand

**Behavior:**
- Trigger fires when an object is created in `public/` and not in `derived/`. Generates three variants. Cost: ~50ms CPU per image at memory 256MB.
- Existing photos (pre-T37) are backfilled by `infra/scripts/backfill_thumbnails.py`.
- Chat UI prefers the smallest variant ≥ container width; lazy-loads images outside viewport.
- AVIF: out of scope for v1. Document a feature-flagged add-on path.

**Acceptance criteria:**
- A new photo upload produces three derived files within 30s of the original (cold-starts excepted).
- Chat photo grid renders the 320 variant at < 768px and the 640 variant at desktop, verified via DevTools network tab.
- Backfill script processes a synthetic dataset of 50 originals in dev under 5 minutes.
- Layout shift score (CLS) on the chat page drops measurably (Lighthouse before/after included in PR description).

**Out of scope:** Server-side image optimization (already handled by Sharp in the function), CDN configuration changes (the public bucket is already CDN-fronted), client-side lossy preview placeholders (Phase 3).

---

## T38 — Self-serve data export (GDPR / DSAR)

**Goal:** A user can request an export of their data and download a JSON archive. Required for GDPR DSAR compliance and a courtesy for any user.

**This task ships PII out of the system. Use Opus. Pair with a privacy review of the bundle shape before any user-facing endpoint is enabled.**

**Files:**
- `frontend/app/settings/export/page.tsx` — request UI
- `backend/app/routers/account.py` — extend with `POST /api/account/export` (requests an export), `GET /api/account/export/status`
- `backend/app/services/export.py` — assembles the bundle
- `infra/scheduled/process_export_jobs.py` — Cloud Run job that consumes a queue of pending export jobs (rate-limited to 5 concurrent)
- `users/{uid}/exports/{jobId}` — { requestedAt, completedAt?, downloadUrl?, expiresAt? }
- `docs/gdpr.md` — extend with the DSAR runbook
- `backend/app/templates/email/export_ready.html.j2`, `export_ready.txt.j2`

**Behavior:**
- Request: user submits → backend writes `exports/{jobId}` with `requestedAt`. Rate limit: one in-flight export per user; second request returns 409.
- Job: assembles a JSON archive containing
  - the user's profile (`users/{uid}` + `users/{uid}/private/profile`)
  - all messages they authored across all groups (including soft-deleted ones, with their tombstone status)
  - all reactions and mentions tied to the user
  - audit trail of admin actions taken against them (relevant subset of `audit_log`)
  - all photos uploaded by them (URLs only — bytes are linked, not bundled, to keep export size reasonable)
- Writes the archive to `gs://jacob-exports-{env}/{uid}/{jobId}.json.gz`. Generates a 7-day signed URL. Sends the user an email (T18) with the link.
- The signed URL expires after 7 days; the bucket has a 14-day lifecycle delete.
- Concurrency: only one export at a time per user; system-wide cap of 5 concurrent jobs.

**Acceptance criteria:**
- A user requesting an export receives an email with a working download link within 30 minutes.
- The downloaded archive contains every category listed above, validated against a JSON schema (`backend/app/services/export_schema.py`).
- Photos are linked but not embedded (verified in the schema).
- Re-requesting an export within an in-flight window returns 409.
- The signed URL after 7 days returns 403 from GCS (lifecycle test).
- The runbook in `docs/gdpr.md` covers how a privacy-rights ticket gets triaged: who the responder is, the SLA (30 days for GDPR DSAR), and the failure escalation path.

**Out of scope:** Account portability to a different provider (this is read-only export, not migrate-out), bulk admin export (Phase 3 platform-wide tooling), CCPA "delete my data" — covered by T14, but document the cross-reference in `docs/gdpr.md`.

---

## T39 — Phase 1 deferred pickup — schema, infra, and tests

**Goal:** Close out the M-class deferred items from `docs/follow-ups/phase-1-deferred.md` that don't have their own Phase 2 task. This is one PR's worth because each sub-item is small.

**Files:** several — see Sub-items.

**Sub-items (each is a commit inside this task's PR):**

1. **M4 — Cloud Scheduler IAM/OIDC Terraform.** Add `google_cloud_scheduler_job` resources for `firestore_export` and `finalize_deletions` with dedicated least-privilege service accounts. Document SA emails in `infra/README.md`.
2. **M5 — Pin Dockerfile base image by digest.** Replace `FROM python:3.12-slim` with a digest-pinned form. Set up Dependabot to auto-update digests (already configured for tags — extend).
3. **M6 — Functions deploy lockfile.** Commit `functions/package-lock.json` produced by `npm install` inside the workspace; add a CI check that this stays consistent with `pnpm-lock.yaml` (or document the divergence).
4. **M9 — Frontend integration tests with the emulator.** Add `frontend/tests/integration/` with two specs: send + read by member; send + read denied for non-member. Run via `firebase emulators:exec` in CI.
5. **M10 — Test coverage gaps.** Add tests called out in the Phase 1 review: rate-limit decorator presence, `onMessageWrite` idempotency, `useUser` auth-state-change cookie race, minor-user rules, expired-ban rules.
6. **M11 — Resolve `groupIds` schema drift.** Remove `groupIds` from `users/{uid}` and update `useGroups` to derive memberships from `groups/{gid}/members/{uid}` via a collection-group query (requires an ADR if not already covered — `docs/adr/0003-collection-group-memberships.md`).
7. **M12 — `useRecentMessages` N+1 reads.** Wrap the per-group reads in SWR (or React Query, decide once) with a stable cache key. Document the cache strategy.
8. **L7 — Terraform remote state + provider pins.** Add `infra/backend.tf` (GCS backend), `infra/versions.tf` (provider pins), commit `.terraform.lock.hcl`. Document bucket creation in `infra/README.md`.

**Acceptance criteria:**
- Every sub-item lands in this PR or has a follow-up issue linked from the PR description.
- `docs/follow-ups/phase-1-deferred.md` is updated: each addressed item is moved into a "Resolved in T39 / commit `<sha>`" section. Items that turn out to need their own Phase 3 task are moved to a "Punted to Phase 3" section.
- Frontend integration tests run in CI and pass.
- Terraform `init` + `plan` from a clean clone runs end-to-end (verified by a fresh CI job).

**Out of scope:** M8 (restore drill timing) — the drill itself needs operator time and is tracked separately as an operational task; the runbook update lands here only if the drill has been done before this task starts.

---

## What's intentionally not in Phase 2

- Native mobile (iOS / Android) → Phase 3.
- Push notifications on iOS native → Phase 3 (FCM web push covers PWA users now).
- Stripe subscriptions / paid tiers → Phase 3.
- BJJ sticker set + brand-voice variant → Phase 3.
- Real-time presence + typing indicators → not justified at our group size.
- Voice notes, video uploads → Phase 3 (cost + moderation).
- Rich text / markdown / link unfurls → Phase 3 (content surface).
- E2EE → never (architectural decision; JACOB is community visibility, not private messaging).
- Org/network layer + playbook distribution → Phase 4.
- Third-party API → Phase 4.
- Full i18n (multi-language UI strings) → Phase 3; copy is English-only in Phase 2 but accessibility work (keyboard nav, screen reader labels, color contrast) is part of every front-end task's acceptance bar — call it out in PR review if missed.

If a Sonnet plan starts touching anything in this list, stop it and check.
