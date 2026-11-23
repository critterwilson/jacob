# JACOB — Phase 2 Dev Plan

This is the development plan for Phase 2 of JACOB. Phase 1 (T01–T18) shipped: a working small-group messaging app with auth, profiles, stickers, chat with threading and edit/delete, photo upload + moderation, the welcome/home shell, Google-Form reporting, an admin dashboard, account deletion with grace, observability, backups, rate limiting, and transactional email.

Phase 2's job is to take that foundation from "pilot-ready" to "early-public-beta-ready." Read `CLAUDE.md` first — it pins the conventions every task here inherits. Read `DEV_PLAN.md` for the original task vocabulary; this file is a direct continuation and uses the same idioms.

## How to use this document with Sonnet

Each task is a standalone spec sized for one focused Sonnet session. To run a task:

1. Open a new Claude Code session in the repo. `CLAUDE.md` loads automatically.
2. Tell Sonnet: *"Implement task `Tnn` from `PHASE_2_DEV_PLAN.md`. Read the task spec, then propose a plan before writing code."*
3. Review the plan. Ask for revisions if any acceptance criterion is missing or any out-of-scope item is being touched.
4. Approve, and let it implement.
5. Review the diff against the acceptance criteria. Don't merge if any criterion is unmet.

Reserve Opus for: `T19` (feature flags — architectural foundation), `T21` (push notifications — token lifecycle and delivery correctness are easy to get wrong), `T29` (roles + permissions — rules + audit + UX all interlock), `T35` (native reporting — replaces an existing system; data must not regress), and `T40` (GDPR export — PII correctness is non-negotiable). Use Opus on any task where Sonnet's plan looks shaky.

## Phase 2 goals

- **Engagement** — bring users back via push, mentions, reactions, search, and a real notification center. Phase 1 has no pull beyond opening the app yourself.
- **Group maturity** — let groups outlive their founder: multiple leaders, role hierarchy, archival, pinned content, and a real member-management UI.
- **Moderation maturity** — replace the Google-Form report stub with in-app reporting, add user-level mute/block, and tighten the queue UI.
- **Performance & mobile** — PWA polish, virtualized lists, image optimization, and pagination beyond 50 so groups can grow past 30 active members without UI degradation.
- **Compliance & access** — GDPR export, retention controls, a real a11y pass, and the under-13 waitlist promised by the privacy policy.
- **Observability of the product, not just the system** — feature flags so we can ship dark, and product analytics so we can tell what works.

## Success criteria (end of Phase 2)

- An invited user can install the PWA, receive a web push when mentioned, and react to a message — all without leaving the browser.
- A group with two leaders can manage members, archive itself, and pin a message without admin intervention.
- A user can request and download a JSON export of their data within 24 hours.
- 100% of in-app reports flow through native UI and land in `moderation_queue` (the Google Form is decommissioned).
- Median message-list paint time on a 1,000-message group is under 500ms on a mid-tier Android.
- All admin/leader actions surface in `audit_log`; nothing meaningful happens off-record.

## Non-goals

- Native iOS/Android apps (Phase 3).
- Monetization, billing, paid tiers (Phase 3).
- Org/network layer, multi-group routing (Phase 4).
- BJJ sticker set + brand-voice variant (Phase 3).
- Cloud Trace / full APM (defer until latency is a real problem).
- Realtime presence / typing indicators (intentionally cut — see "What's intentionally not in Phase 2" below).
- Distributed rate limiting via Redis (still fine on slowapi single-instance until traffic warrants).

## Task overview

| ID  | Task                                                  | Theme                  | Depends on        | Notes               |
|-----|-------------------------------------------------------|------------------------|-------------------|---------------------|
| T19 | Feature flags + remote config wrapper                 | Foundation             | T15               | **Use Opus**        |
| T20 | Product analytics + retention dashboards              | Foundation             | T15               |                     |
| T21 | Web push notifications (FCM)                          | Engagement             | T19               | **Use Opus**        |
| T22 | In-app notification center                            | Engagement             | T21               |                     |
| T23 | Mentions (@user) + mention notifications              | Engagement             | T22               |                     |
| T24 | Sticker reactions on messages                         | Engagement             | T08, T19          |                     |
| T25 | Per-group full-text message search                    | Chat depth             | T08               |                     |
| T26 | Link unfurls (server-fetched, moderated)              | Chat depth             | T10, T17          |                     |
| T27 | Markdown rendering with safe sanitization             | Chat depth             | T08               |                     |
| T28 | Voice notes (audio attachments)                       | Chat depth             | T10               |                     |
| T29 | Multiple leaders, role hierarchy, member mgmt UI      | Group lifecycle        | T07, T13          | **Use Opus**        |
| T30 | Group settings: invite expiry, archival, transfer     | Group lifecycle        | T29               |                     |
| T31 | Pinned messages + announcements                       | Group lifecycle        | T08, T29          |                     |
| T32 | Group discovery for new users                         | Growth                 | T07               |                     |
| T33 | Profile editing + account settings page               | Growth                 | T05               |                     |
| T34 | Under-13 waitlist + parent-verification flow          | Growth                 | T05, T18          |                     |
| T35 | Native in-app reporting (retire Google Form)          | Moderation             | T12, T13          | **Use Opus**        |
| T36 | User-level mute / block + reputation signals          | Moderation             | T29, T35          |                     |
| T37 | PWA install + offline shell                           | Mobile / Perf          | T11               |                     |
| T38 | Image optimization (next/image, sized variants)       | Mobile / Perf          | T10               |                     |
| T39 | Virtualized message list + pagination upgrade         | Mobile / Perf          | T08               |                     |
| T40 | GDPR data export + retention controls                 | Compliance             | T14, T18          | **Use Opus**        |
| T41 | Accessibility audit + keyboard nav + screen reader    | Compliance             | T11               |                     |

A reasonable solo cadence: 1 task per 3–5 days. Phase 2 lands in 12–16 weeks if foundational tasks (T19, T20, T29) go cleanly, longer if T29 surfaces rule rewrites.

**Suggested ordering:** land T19 and T20 first — they unblock measurement and dark launches for the rest. Then T29 (because role/permission changes ripple into half the remaining tasks). Then engagement (T21–T24) and chat depth (T25–T28) in any order. T35 should come before T36 (mute/block leans on the new report pipeline). T40 is independent — slot it whenever Christopher needs it for the privacy policy.

---

## T19 — Feature flags + remote config wrapper

**Goal:** A typed feature-flag system that gates frontend and backend code from a single source of truth, with safe defaults for offline / cold-start scenarios.

**This is foundational — every other Phase 2 task should ship behind a flag. Use Opus.**

**Files:**
- `frontend/lib/flags.ts` — typed flag registry, `useFlag(name)` hook, server-side `getFlag(name)` for RSC
- `backend/app/services/flags.py` — server-side flag evaluation (uses Firebase Remote Config server SDK)
- `firestore/firestore.rules` — no rule change; flags are not in Firestore
- `docs/feature-flags.md` — how to add a flag, default policy, removal policy
- `docs/adr/0002-feature-flag-strategy.md` — why Remote Config over LaunchDarkly/GrowthBook for v1

**Behavior:**
- Flags are declared in code: a single `FLAGS` const object in `frontend/lib/flags.ts` mirrored in `backend/app/services/flags.py`. Each flag has a default value and a description. CI fails if the two registries diverge.
- Frontend: `useFlag('reactions')` returns `{ value, loading }` with the default while Remote Config is loading.
- Backend: `await flags.get('reactions', user)` returns the resolved value, with a 60-second in-memory cache per instance.
- Targeting: per-user (uid), per-group (gid), and percentage rollout. No string-match targeting in v1.
- Kill switches: any flag can be flipped to `false` from the Firebase console without a redeploy.
- Removal: flags older than 60 days surface in a weekly Slack/Sentry digest reminding Christopher to remove them.

**Acceptance criteria:**
- A new flag added in code and pushed to Remote Config can be flipped on/off and the frontend reflects the change within 60 seconds (no redeploy).
- A backend endpoint gated on a flag returns 404 (or the appropriate fallback) when the flag is off.
- The CI step fails when frontend and backend registries diverge.
- The ADR explains the trade-off and names a migration trigger ("if we exceed 50 flags or need string-match targeting, revisit").
- Tests cover: default returned during load, server cache hit/miss, percentage rollout determinism (same uid → same bucket).

**Out of scope:** A/B testing infrastructure (use the percentage rollouts manually for v1), automatic flag-cleanup PRs.

---

## T20 — Product analytics + retention dashboards

**Goal:** Every meaningful product event (sign-up, group create, group join, message post, reaction, mention, report) emits to a product-analytics tool. A small set of dashboards answers "are we growing, are people coming back, where do they fall off?"

**Files:**
- `frontend/lib/analytics.ts` — `track(event, props)` wrapper
- `backend/app/services/analytics.py` — server-side event emission for backend-originated events
- `docs/analytics-events.md` — event catalog (name, when emitted, properties, PII status)
- `docs/dashboards.md` — links to the dashboards and what each one answers

**Behavior:**
- Use PostHog (self-hosted or cloud free tier — decide in the ADR) for event capture and dashboards.
- Frontend events: `signup_completed`, `onboarding_completed`, `group_created`, `group_joined`, `message_sent`, `reaction_added`, `mention_received`, `report_submitted`, `account_deleted`.
- Backend events: `moderation_decision`, `ban_applied`, `email_sent`.
- Identity: associate events with the Firebase uid via `posthog.identify`. Sign-out calls `posthog.reset()`.
- PII: never send email, display name, message body, group name, or invite code as a property. Emit IDs only. Lint rule (`eslint-plugin-no-pii` or a custom rule) catches violations.
- North Star metric definition in `docs/dashboards.md`: "weekly active small groups" — a group counts if it had ≥3 messages from ≥2 users in the last 7 days.

**Acceptance criteria:**
- Each Phase 1 event surface emits the documented event with the documented properties.
- The North Star dashboard is live and computes correctly against seeded test data.
- A dashboard for the funnel `signup_completed → onboarding_completed → group_joined OR group_created → message_sent` shows drop-off rates.
- The PII lint rule runs in CI and fails the build on a deliberate violation.

**Out of scope:** session replay, heatmaps, in-product feature-discovery surveys (Phase 3 if at all).

---

## T21 — Web push notifications (FCM)

**Goal:** A user who has granted notification permission receives a push when something they care about happens in JACOB (mention, thread reply where they participated, leader-pinned announcement).

**Push correctness — token lifecycle, permission UX, delivery — is the kind of thing that silently breaks. Use Opus.**

**Files:**
- `frontend/lib/push.ts` — request permission, fetch FCM token, register with backend
- `frontend/public/firebase-messaging-sw.js` — service worker for background notifications
- `backend/app/routers/push.py` — `POST /api/push/register`, `DELETE /api/push/register/{tokenId}`
- `backend/app/services/push.py` — FCM send wrapper with retry + dead-token cleanup
- `functions/src/onMentionCreate.ts` — Firestore trigger that sends push for mentions
- `firestore/firestore.rules` — rules for `users/{uid}/pushTokens/{tokenId}` (user-only read/write of own tokens)

**Behavior:**
- Permission UX: never prompt on page load. Prompt only after the user takes a meaningful action (sends their third message, joins a second group, or visits `/settings/notifications` — pick one and document).
- Token storage: `users/{uid}/pushTokens/{tokenId}` with `token`, `userAgent`, `createdAt`, `lastSeenAt`. Stale tokens (lastSeenAt > 30d) get reaped weekly.
- Send pipeline: a Cloud Function trigger reads the target user's tokens, batches send via the Admin SDK, and on `messaging/registration-token-not-registered` deletes the dead token.
- Delivery rules: don't push to a user who is currently active in the app (heartbeat to a `users/{uid}/sessions/{sessionId}` doc with TTL — covered by T22's notification-center work). Dedup pushes within 30s for the same target+source.
- Quiet hours: respect `users/{uid}.private/profile.quietHours` if set (default off in v1).

**Acceptance criteria:**
- A mention triggers a push that arrives on a backgrounded tab in Chrome and Safari (manually verified — capture screenshots in `docs/runbooks/push-verification.md`).
- A revoked-permission state is recoverable: the settings page shows the current state and provides a re-enable affordance.
- Dead tokens are cleaned up: a test simulates a `not-registered` response and asserts the token is removed.
- No push fires when the user is active in the app (verify via integration test against the heartbeat doc).
- Backend tests cover the register/unregister/list endpoints and the leader-only paths.

**Out of scope:** APNs (native iOS) — Phase 3. Email fallback for missed pushes — Phase 3 (unless Christopher wants it explicitly; if so, scope as T18-extension).

---

## T22 — In-app notification center

**Goal:** A bell icon in the app shell that surfaces unread notifications with a count and a dropdown of recent items. Click takes the user to the relevant message/thread/group.

**Files:**
- `frontend/components/nav/NotificationBell.tsx`
- `frontend/components/nav/NotificationList.tsx`
- `frontend/lib/hooks/useNotifications.ts`
- `firestore/firestore.rules` — rules for `users/{uid}/notifications/{notificationId}`
- `firestore/firestore.indexes.json` — index for `notifications` ordered by `createdAt desc` filtered by `readAt == null`
- `functions/src/onNotificationFanout.ts` — writes notification docs when triggers fire

**Behavior:**
- Notifications are stored at `users/{uid}/notifications/{notificationId}` with `type`, `sourceRef` (DocumentReference), `groupId`, `actorUid`, `createdAt`, `readAt`.
- Types in v1: `mention`, `thread_reply`, `pinned_message`, `group_invite_accepted` (visible to leaders), `moderation_decision` (when a user's content is approved/rejected after report).
- Bell shows unread count up to 9+; dropdown shows the 20 most recent; "View all" goes to a full page at `/notifications`.
- Click on a notification: marks it read (`readAt = serverTimestamp()`) and routes to the source.
- "Mark all read" action.
- Live update via `onSnapshot` on the most-recent 20 unread.
- Heartbeat: while the bell mounts, write to `users/{uid}/sessions/{sessionId}` every 30s with TTL, used by T21 to suppress redundant push.

**Acceptance criteria:**
- Posting a mention in another tab causes the bell to flip to an unread state in real time.
- Dropdown is keyboard-navigable (arrow keys, Enter).
- Rule tests: a user can read their own notifications; nobody else can read them.
- "Mark all read" updates ≤ 50 docs per call (chunked) and is idempotent.
- The `/notifications` full page paginates back beyond 20.

**Out of scope:** notification preferences per type (Phase 3 — defaults are fine), notification grouping ("3 people replied" rollups — Phase 3).

---

## T23 — Mentions (@user) + mention notifications

**Goal:** A user can type `@displayName` (autocomplete from group members) and the mentioned user is linked and notified.

**Files:**
- `frontend/components/chat/MentionAutocomplete.tsx`
- `frontend/lib/mentions.ts` — parse mentions in a message body, render to a token format
- `firestore/firestore.rules` — `messages` writes include a `mentions: string[]` field validated to be a subset of group member UIDs
- `functions/src/onMessageWrite.ts` — extend (existing T09 trigger) to fan out mention notifications

**Behavior:**
- Typing `@` in `MessageInput` opens an autocomplete listing the current group's members (excluding self), filtered by display-name prefix.
- On submit, the message body is stored as plain text (with `@displayName` literal) plus a sibling `mentions: string[]` field of resolved UIDs.
- Render: in `MessageItem`, mentions are styled as a chip and link to the mentioned user's mini-profile (or a popover — pick one).
- Notifications: the existing fanout trigger writes a `mention` notification for each mentioned UID. T21 sends push.
- Edge cases: deleted users (`[deleted]`) are not mentionable. Self-mention is dropped silently. `@everyone` is **not** supported in v1 — the autocomplete won't surface it; a typed literal is treated as plain text.

**Acceptance criteria:**
- Autocomplete debounces and doesn't fire a Firestore read per keystroke (the member list is fetched once when the input mounts).
- Rule tests confirm `mentions` cannot include UIDs outside the group's `members` subcollection.
- Tests cover: parse a body with two mentions, render correctly, fan out two notifications.
- A mention to a banned user does not produce a notification (filter in the trigger).

**Out of scope:** group-wide mentions (`@here`, `@channel`), mention-only notification preference (Phase 3).

---

## T24 — Sticker reactions on messages

**Goal:** A user can react to any message with one of the existing stickers (or a small emoji subset). Reactions are visible inline; counts roll up.

**Files:**
- `frontend/components/chat/MessageReactions.tsx`
- `frontend/components/chat/ReactionPicker.tsx`
- `frontend/lib/hooks/useMessageReactions.ts`
- `firestore/firestore.rules` — `groups/{gid}/messages/{mid}/reactions/{uid}` (one doc per user per message)
- `firestore/firestore.indexes.json` — none needed (subcollection with small fan-out)
- `functions/src/onReactionWrite.ts` — maintains a denormalized `reactionCounts: { [stickerId]: number }` on the parent message

**Behavior:**
- Reactions are a subcollection at `groups/{gid}/messages/{mid}/reactions/{uid}` with `stickerId`, `createdAt`. One reaction per user per message; toggling replaces or removes.
- The counts are denormalized onto the message document by a Firestore trigger so the message render doesn't need a subcollection read.
- Picker: hover a message → small "+" button → picker shows the 6 Phase 1 sticker categories. Click adds, click again removes.
- Display: chips like "🙏 Prayer · 3" inline below the message body. Click a chip to see who reacted.

**Acceptance criteria:**
- Reaction is gated by a feature flag (`reactions`) so it can be disabled without a redeploy.
- Rule tests confirm: only group members can write reactions; a user cannot write a reaction doc with a `uid` other than their own (the doc ID is the uid).
- The denormalized count never drifts more than one increment behind reality (verified by a test that deletes a reaction and checks the count).
- Reaction pickers respect keyboard nav (arrow + Enter).

**Out of scope:** custom emoji upload, reaction analytics dashboards (T20 will count `reaction_added` events), reaction-only notifications (Phase 3).

---

## T25 — Per-group full-text message search

**Goal:** A user can search messages within a group they're a member of by keyword.

**Files:**
- `frontend/app/groups/[gid]/search/page.tsx`
- `frontend/components/chat/SearchInput.tsx`
- `backend/app/routers/search.py` — `GET /api/groups/{gid}/messages/search?q=...`
- `backend/app/services/search.py` — search backend (Algolia free tier or Typesense — decide in the ADR)
- `functions/src/onMessageWrite.ts` — extend to mirror messages into the search index, removing on soft-delete
- `docs/adr/0003-search-backend.md`

**Behavior:**
- Search runs server-side (the FastAPI endpoint enforces group membership and proxies to the search service — clients never get the search service's API key).
- Indexed fields: `body`, `authorUid`, `groupId`, `createdAt`, `parentMessageId`. PII consideration: the search service stores message bodies; document this in `docs/data-model.md` under "where data lives."
- Soft-deleted messages are removed from the index.
- Banned users' content remains searchable for moderators (admin-only flag) but not for regular users.
- Rate-limited via T17: 30 searches / minute / user.

**Acceptance criteria:**
- A search for a known phrase in a member's group returns the matching messages within 500ms p95.
- A search across groups the user isn't in returns 0 results (the endpoint enforces group scope).
- Soft-deleting a message removes it from results within 60 seconds.
- The ADR documents the chosen search backend, cost projection, and migration trigger.

**Out of scope:** cross-group search (Phase 3), search filters by sticker / author / date range (Phase 3 — open the door but don't ship the UI), regex / fuzzy / synonym tuning beyond the search service's defaults.

---

## T26 — Link unfurls (server-fetched, moderated)

**Goal:** When a message contains a URL, a preview card (title, description, thumbnail) renders below the message body. Previews are server-fetched and moderation-gated.

**Files:**
- `backend/app/routers/unfurl.py` — `POST /api/unfurl` (called server-side from a function or once at message-write time, not from the client)
- `backend/app/services/unfurl.py` — fetch + parse OpenGraph/oEmbed, run thumbnail through the T10 moderation pipeline
- `functions/src/onMessageWrite.ts` — extend: when a message has a URL, write a `unfurls: [...]` field after the moderation result
- `frontend/components/chat/LinkPreview.tsx`

**Behavior:**
- Server fetches the URL with a 5-second timeout, max 1 MB body, and a strict allowlist of protocols (`https://` only).
- Parses OpenGraph tags (title, description, image, site_name).
- The thumbnail goes through the T10 moderation pipeline before being attached to the message.
- A blocklist of domains (gambling, adult, known scam — seed list in `docs/unfurl-blocklist.md`) skips unfurling entirely.
- Cache: unfurl results are cached in Firestore at `unfurl_cache/{urlHash}` with a 7-day TTL.
- SSRF protection: the fetcher refuses private IP ranges (RFC 1918), `localhost`, and link-local addresses.
- Rate limited per group: max 5 unfurls per message, max 50 unique URLs / hour / user.

**Acceptance criteria:**
- A message with a public URL renders a preview within 5 seconds of post (function cold-starts excepted).
- An SSRF attempt (a URL pointing at `169.254.169.254` or `10.0.0.1`) is rejected with a logged error.
- A URL whose thumbnail fails moderation produces an unfurl with no image (text only).
- The cache keeps repeated identical URLs to one fetch within the TTL window.
- Tests cover: happy path, SSRF rejection, blocklist hit, oversize body, moderation fail.

**Out of scope:** YouTube/Twitter/Instagram embeds (special-case in Phase 3), inline GIF picker (Phase 3).

---

## T27 — Markdown rendering with safe sanitization

**Goal:** Messages render basic markdown (bold, italic, code, inline links, lists, blockquote) safely.

**Files:**
- `frontend/components/chat/MessageBody.tsx` — rendering with `react-markdown` + `rehype-sanitize`
- `frontend/lib/markdown.ts` — allowed tags / attributes config
- `frontend/components/chat/MessageInput.tsx` — small format toolbar (bold / italic / code / link)

**Behavior:**
- Message body is still stored as plain text (no AST). Rendering is a pure transform at display time. This means no migration.
- Allowed: `**bold**`, `*italic*`, `` `code` ``, ```` ```fenced``` ````, `[link](https://...)` with `https://` protocols only, unordered/ordered lists, `>` blockquote, `---` horizontal rule.
- Disallowed: HTML, images (Phase 1's photo attachment is the only image path), arbitrary URLs schemes, autolinking of bare URLs (T26 handles unfurls; bare URLs render as plain text unless wrapped in `[...](...)`).
- A "Markdown supported" affordance in the input shows a tooltip with the cheat sheet.
- Sanitization config is the source of truth — `rehype-sanitize` schema is defined explicitly, not extended from defaults.

**Acceptance criteria:**
- A message with `<script>alert(1)</script>` renders as plain text (no script execution). Test asserts `DOMPurify`-style.
- A `javascript:` link is stripped.
- A fenced code block preserves whitespace.
- Mention chips (T23) render correctly inside markdown context (a mention inside a blockquote is still styled and linked).
- The format toolbar inserts the right tokens at the cursor position.

**Out of scope:** WYSIWYG editing, tables, embedded video, syntax-highlighted code blocks (Phase 3 — `prism` adds weight; defer).

---

## T28 — Voice notes (audio attachments)

**Goal:** Users can record a short voice note in-app, attach it to a message, and play back.

**Files:**
- `frontend/components/chat/VoiceRecorder.tsx`
- `frontend/components/chat/VoicePlayer.tsx`
- `backend/app/routers/uploads.py` — extend to support `audio/webm`, `audio/mp4` mime types
- `backend/app/services/moderation.py` — extend with audio moderation (transcribe via Speech-to-Text → run through Cloud Natural Language for toxicity)
- `infra/buckets.tf` — extend bucket sizing limits to allow audio (≤ 5 MB)

**Behavior:**
- Recording: in-browser via `MediaRecorder` API, max 60 seconds, encoded to webm/opus. Permission flow handles denial gracefully.
- Upload follows the same signed-URL flow as T10 (quarantine bucket → moderate → public bucket).
- Moderation pipeline for audio:
  1. Cloud Speech-to-Text transcribes (with profanity filter on).
  2. Transcript runs through Cloud Natural Language API for toxicity (same threshold as text moderation in T35).
  3. On fail: held in moderation queue with reason `"audio_transcript_toxic"`.
  4. The transcript is stored alongside the audio in the message doc as `transcripts.[messageId].text` for accessibility.
- Player: minimal UI (play/pause, scrub bar, time elapsed, "View transcript" button).

**Acceptance criteria:**
- A recorded clip uploads, moderates, and plays back end-to-end in dev.
- An over-limit recording (>60s) is truncated client-side with a warning, not silently dropped.
- The transcript is shown to screen-reader users via an accessible region.
- Permission denial shows a recoverable error state, not a silent failure.
- Rate limited: 5 voice notes / hour / user (extend T17 limit table).

**Out of scope:** voice-call / room features (Phase 4), waveform visualization (Phase 3 — defer until users ask), voice transcription languages beyond English (Phase 3).

---

## T29 — Multiple leaders, role hierarchy, member management UI

**Goal:** A group can have more than one leader. Leaders can promote other members, demote co-leaders, remove members, and view a member-management panel. Permissions ripple consistently into security rules and the audit log.

**Permissions changes touch security rules, every group-mutation surface, and the audit log. Use Opus and re-derive the rules carefully.**

**Files:**
- `frontend/app/groups/[gid]/members/page.tsx` — member management UI
- `frontend/components/groups/MemberList.tsx`, `MemberRow.tsx`
- `backend/app/routers/groups.py` — extend with `POST /api/groups/{gid}/members/{uid}/role`, `DELETE /api/groups/{gid}/members/{uid}`
- `firestore/firestore.rules` — multi-leader read/write semantics
- `firestore/tests/groups.rules.test.ts` — extend
- `docs/data-model.md` — update `members` schema to include role enum

**Data model changes:**
- `groups/{gid}/members/{uid}.role` becomes an enum: `member`, `leader`, `co_leader`. (Or just `leader` and `member` — the open question is whether co-leaders need a distinct level. **Decide in an ADR before coding.** Default: keep two roles for v1, just allow multiple `leader`s.)
- `groups/{gid}.leaderCount` (denormalized counter) maintained by a trigger. The last leader cannot be demoted/removed (rule-enforced read of `leaderCount`).

**Behavior:**
- Leaders can promote any member to leader.
- Leaders can demote any other leader (not themselves if they're the last).
- Leaders can remove any member except the last leader.
- A user can leave (remove themselves) unless they're the last leader — in which case they must transfer leadership first (handled by T30).
- Every role change writes to `audit_log`.
- The member list shows role badges, last-seen (from the heartbeat doc when present), and join date.

**Acceptance criteria:**
- The last leader cannot be demoted or removed (rule-enforced and tested).
- A demoted leader's writes to the group document are denied (rule-tested).
- The member list paginates beyond 50 members.
- Audit log entries have `actorUid`, `targetUid`, `action: "promote_leader"|"demote_leader"|"remove_member"`, `groupId`.
- Tests: 6 rule tests minimum (allow + deny for promote, demote, remove, plus the last-leader guard).

**Out of scope:** custom roles (Phase 4), role-based message permissions ("only leaders can post" mode — Phase 3), per-channel permissions (no channels in JACOB yet).

---

## T30 — Group settings: invite expiry, archival, ownership transfer

**Goal:** Leaders can configure invite-link expiry, archive a group, and transfer ownership.

**Files:**
- `frontend/app/groups/[gid]/settings/page.tsx`
- `backend/app/routers/groups.py` — extend with `POST /api/groups/{gid}/archive`, `POST /api/groups/{gid}/unarchive`, `POST /api/groups/{gid}/transfer`, `POST /api/groups/{gid}/invite/expiry`
- `firestore/firestore.rules` — archived groups become read-only for non-admins
- `infra/scheduled/expire_invites.py` — Cloud Scheduler job (daily) that nullifies expired invite codes

**Behavior:**
- Invite expiry: leader sets a duration (24h, 7d, 30d, never). The scheduled job clears `inviteCode` past the expiry. Joining a group with an expired code returns 404 with `"invite_expired"`.
- Archival: a leader-initiated action that:
  - Adds `archivedAt` to the group doc.
  - Rules: archived groups deny new messages, new joins, role changes. Reads remain allowed for current members. Owner transfer requires unarchive first.
  - UI: archived groups appear in a "Archived" section of the home, dimmed and read-only.
  - Unarchive is leader-only and writes to `audit_log`.
- Transfer ownership: leader picks a current member, who becomes a leader; the original transferring leader can choose to step down to `member` or stay leader. Single API call, transactional (the new leader and demotion happen atomically).

**Acceptance criteria:**
- An expired invite code returns a clear error in the join UI.
- An archived group cannot accept messages (rule-enforced and tested).
- Transfer ownership works in a single transaction; a partial-failure test simulates a write conflict and asserts no orphaned roles.
- Audit log captures each action.
- The settings page is reachable only by leaders.

**Out of scope:** scheduled archival ("auto-archive after 90 days of inactivity" — Phase 3), bulk member CSV export (Phase 3).

---

## T31 — Pinned messages + announcements

**Goal:** A leader can pin a message in a group; pinned messages render at the top of the chat. An announcement is a special pin that triggers a notification to all members.

**Files:**
- `frontend/components/chat/PinnedBanner.tsx`
- `frontend/components/chat/PinAction.tsx` (visible to leaders)
- `frontend/lib/hooks/useGroupPins.ts`
- `firestore/firestore.rules` — `groups/{gid}/pins/{messageId}` writable only by leaders
- `functions/src/onPinCreate.ts` — fanout `pinned_message` notification when `isAnnouncement: true`
- `firestore/firestore.indexes.json` — index on `pins` ordered by `pinnedAt desc`

**Behavior:**
- Pin: leader clicks "Pin" on any message. Writes `groups/{gid}/pins/{messageId}` with `pinnedBy`, `pinnedAt`, `isAnnouncement`.
- Up to 5 pins per group. Pinning a 6th surfaces a UI prompt to unpin one first.
- Render: `PinnedBanner` at the top of the chat shows the most recent pin with a "View all pins" link.
- Announcement: pin with `isAnnouncement: true` fans out a `pinned_message` notification to every member (via T22's notification system).
- Unpin: leader-only; deletes the pin doc.

**Acceptance criteria:**
- Pin creates a notification only for `isAnnouncement: true`.
- Rule tests confirm a non-leader cannot write to `pins`.
- The 5-pin limit is enforced server-side (rule + Cloud Function check) — pin #6 is rejected.
- Pinned-banner click scrolls the chat to the pinned message.

**Out of scope:** announcement scheduling (Phase 3), per-pin expiry (Phase 3).

---

## T32 — Group discovery for new users

**Goal:** A new user — or any user looking for a group — can browse a directory of public groups, filter by audience, and request to join.

**Files:**
- `frontend/app/discover/page.tsx`
- `frontend/components/discover/GroupCard.tsx`
- `backend/app/routers/discover.py` — `GET /api/discover/groups?audience=&q=&page=`
- `backend/app/services/discover.py` — query the public-groups index (Firestore collection-group query is a no-go per CLAUDE.md; backend filters using a denormalized `public_groups/{gid}` collection mirrored by a trigger)
- `functions/src/onGroupWrite.ts` — mirrors `groups/{gid}` to `public_groups/{gid}` when `isPrivate: false`, removes when private

**Behavior:**
- Only groups with `isPrivate: false` appear. Private groups never surface here.
- Listing shows: name, description, member count, audience tag, "Request to join" button.
- "Request to join": a request flow where the user sends a join request that surfaces in the leader's notification center; the leader approves or denies. (For v1, keep it simple — leader approval, no questions form.)
- Search: name + description text match. The backend uses the search service from T25 if available; otherwise a simple Firestore prefix query on `name`.
- Pagination: 24 cards per page.
- Onboarding integration: after onboarding (T05), users land at `/discover` if they haven't joined a group yet.

**Acceptance criteria:**
- A private group never appears in `/discover` (rule-tested via the mirror absence).
- Joining a public group via the discover flow creates a join request that the leader sees as a notification.
- The leader can approve/deny from the notification dropdown or the member-management page (T29).
- The page is performant: 24 cards load in under 500ms p95 on a warm cache.

**Out of scope:** featured groups / curation (Phase 3), group categories/tags beyond audience (Phase 3), leader-side rich applications form (Phase 3).

---

## T33 — Profile editing + account settings page

**Goal:** Users can edit their display name, photo, location, faith background, and notification preferences after onboarding. (Phase 1 left this out intentionally.)

**Files:**
- `frontend/app/settings/profile/page.tsx`
- `frontend/app/settings/notifications/page.tsx`
- `frontend/app/settings/layout.tsx` — settings shell with sidebar nav
- `frontend/components/settings/ProfileEditor.tsx`
- `firestore/firestore.rules` — already covers user-self writes to `users/{uid}`; verify no changes needed

**Behavior:**
- Profile fields editable: `displayName`, `photoURL` (re-uses the T10 moderation upload flow), `location`, `faithBackground`.
- Display-name changes propagate via the existing denormalization (none needed — clients fetch user docs by UID for display).
- Photo changes: old photo is deleted from GCS after the new one moderates and saves.
- Notification preferences: per-type toggles (mention, thread reply, pinned message, moderation decision) saved to `users/{uid}/private/profile.notificationPrefs`. T21's send pipeline checks this before pushing.
- Email and password changes go through Firebase's built-in flows (don't rebuild them).
- Sign-out button.
- Link to the existing account-deletion flow (T14).

**Acceptance criteria:**
- A display-name change propagates to existing messages on next render (no backfill needed — rendering reads from `users/{uid}` lazily).
- Notification prefs are respected by the push pipeline (verify with a test that toggles `mention: false` and asserts no push fires).
- Photo replacement deletes the old GCS object.
- The settings page is reachable from the home shell sidebar (extend `AppShell` from T11).

**Out of scope:** changing email (Phase 3 — Firebase supports it but the verification UX is fiddly), 2FA setup UI (Phase 3 — Firebase Auth supports it but the v1 priority is push, not 2FA).

---

## T34 — Under-13 waitlist + parent-verification flow

**Goal:** A user who self-attests as under 13 during sign-up enters a waitlist with parent-verification — they don't get auto-deleted (the Phase 1 behavior was a quick hack; this is the real fix).

**Files:**
- `frontend/app/onboarding/waitlist/page.tsx`
- `backend/app/routers/waitlist.py` — `POST /api/waitlist/parent-email`, `POST /api/waitlist/verify-parent`
- `backend/app/services/parent_verify.py`
- `firestore/firestore.rules` — `waitlist/{uid}` collection writable only by the waitlister and admin

**Behavior:**
- Onboarding flow: under-13 selection routes to `/onboarding/waitlist` instead of failing the flow.
- The minor enters a parent's email. We send a verification email (T18) to the parent with a link.
- Parent clicks the link, lands on a parent-verification page, completes a brief parent attestation (name, relationship, consent text, click-through), and submits.
- On verification, the minor's account moves from `waitlist/{uid}` to a normal `users/{uid}` doc with `isMinor: true` and `parentVerifiedAt`.
- If parent does not verify within 30 days, the waitlist entry expires and the auth account is disabled.
- A minor user with `isMinor: true`:
  - Cannot create groups (rule-enforced).
  - Cannot join private groups (rule-enforced).
  - Their photo uploads route to the strictest moderation tier (T35 will hook in).
  - Cannot DM (no DMs in JACOB yet — placeholder for Phase 3).

**Acceptance criteria:**
- A minor self-attesting under 13 lands on the waitlist page, not a deletion flow.
- Parent email verification, on success, transitions the user to `users/{uid}` with `parentVerifiedAt`.
- Expired waitlist entries are cleaned up by a daily Cloud Scheduler job.
- Rule tests confirm a minor cannot create a group.
- The COPPA-relevant claims (parent attestation text, retention rules) are documented in `docs/coppa.md`.

**Out of scope:** real KYC for parents (Phase 4 — verifiable parental consent through a third-party service is out of v2 scope; the email-verification flow is the v2 bar).

---

## T35 — Native in-app reporting (retire Google Form)

**Goal:** Replace the Google Form with native in-app reporting that writes directly to `moderation_queue`, surfaces in the admin dashboard (T13), and notifies the reporter when resolved.

**This task replaces a working production system. Use Opus and don't lose any reports during the cutover.**

**Files:**
- `frontend/components/moderation/ReportLink.tsx` — replace existing T12 implementation
- `frontend/components/moderation/ReportDialog.tsx` — modal with reason categories + free-text
- `backend/app/routers/reports.py` — extend with `POST /api/reports`
- `backend/app/services/reports.py`
- `frontend/app/settings/reports/page.tsx` — reporter sees the status of their reports
- `docs/moderation-runbook.md` — update for the new flow

**Behavior:**
- Reasons: `harmful_content`, `harassment`, `spam`, `misinformation`, `csam` (escalated), `other`. Free-text optional except for `other`.
- Submitting a report writes to `moderation_queue` with `reporterUid`, `reasonCategory`, `reasonText`, `targetRef`, `groupId`, `status: "pending"`.
- Rate limited: 10 reports / day / user (already in T17's table — verify limits.py).
- Reporter visibility: in `/settings/reports`, the user sees their own reports with status (`pending`, `approved`, `rejected`, `escalated`). They never see who else reported the same item or moderator notes.
- Cutover: the Google Form remains operational during T35's rollout; flag-gate via T19. Once the in-app reporting is verified for two weeks, manually dispose of the Form Sheet and remove `ReportLink`'s old URL builder.
- The admin queue page (T13) gains a column for `reasonCategory` and a filter dropdown.
- A `moderation_decision` notification (T22) fires to the reporter when status flips off `pending`.

**Acceptance criteria:**
- Submitting a report writes a `moderation_queue` doc that appears in the admin queue within 5 seconds.
- Rate limit triggers correctly.
- The CSAM category triggers the existing T10 escalation path (NCMEC stub call) immediately, before queue write.
- The reporter sees their own report on `/settings/reports`; another user does not.
- The Google Form path remains functional under the `legacy_reporting` flag for 2 weeks; document the rollback plan.
- All Phase 1 `ReportLink` call sites continue to work (the component's external API is unchanged).

**Out of scope:** anonymous reports (require sign-in for v2 — anonymity gameable); reporter-to-moderator chat (Phase 3).

---

## T36 — User-level mute / block + reputation signals

**Goal:** A user can mute or block another user; muted/blocked users' content is hidden in the muter's view. Repeated reports against a user accumulate a reputation signal that surfaces to admins.

**Files:**
- `frontend/components/users/MuteBlockMenu.tsx`
- `frontend/lib/hooks/useUserBlocks.ts`
- `firestore/firestore.rules` — `users/{uid}/blocks/{blockedUid}` writable by self only
- `backend/app/services/reputation.py` — computes a per-user reputation score from `moderation_queue` history
- `frontend/app/admin/users/[uid]/page.tsx` — extend to show the reputation panel

**Behavior:**
- Mute: hide a user's messages from the muter's view. The mute is local to the muter (other users still see normally).
- Block: a stronger version of mute that also prevents the blocked user from mentioning the muter or seeing the muter's profile (data minimization — the muter's display name + photo render as `[blocked user]` to the blocked party). A block does not remove the blocked user from shared groups (would be social drama). Blocking is symmetric: the blocked user implicitly has the muter blocked too.
- Reputation: a back-end score per user combining: number of `approved` reports against them, ban history, weighted by recency. Surfaced only on the admin user page; never shown to regular users.
- Rate limit: 50 blocks / day / user (anti-abuse — bulk-block doesn't make sense for v2).

**Acceptance criteria:**
- A muted user's messages render as `[muted]` placeholders for the muter; for everyone else, normal.
- A block is symmetric: the blocked user cannot mention the blocker (autocomplete filters them out).
- Rule tests confirm a user can write only their own `blocks` subcollection.
- The reputation score updates within 1 minute of a moderation decision (function trigger).
- Tests cover: mute / unmute / block / unblock paths, blocked-user mention attempt rejected by rules.

**Out of scope:** block import from other platforms (Phase 4), public reputation badges (Phase 4 — and probably never).

---

## T37 — PWA install + offline shell

**Goal:** JACOB installs as a PWA on iOS/Android home screens, with an offline shell that loads the app skeleton even without network.

**Files:**
- `frontend/public/manifest.webmanifest`
- `frontend/app/layout.tsx` — link the manifest
- `frontend/lib/sw.ts` — service worker (or use `next-pwa`)
- `frontend/components/offline/OfflineBanner.tsx`
- `frontend/public/icons/` — icon set per platform (192, 512, maskable)

**Behavior:**
- Manifest: `display: standalone`, brand colors from `docs/design-tokens.md`, full icon set.
- Service worker caches the app shell (`/_next/static`, the home route, the auth routes) for offline cold-start.
- Offline mode: an `OfflineBanner` shows when the network is down. Reads from the offline cache where Firestore SDK has already cached recent data (Firestore client SDK handles its own offline persistence — enable it on init).
- Writes while offline: Firestore queues them automatically; show a small "Will send when online" indicator on pending messages.
- Install prompt: a small banner on `/home` after the user's third visit prompts to "Install JACOB." Dismissable, remembered.
- The same service worker registered by T21 (push) cohabits with this one — verify no conflicts.

**Acceptance criteria:**
- Lighthouse PWA score ≥ 90.
- App installs on Chrome (Android) and Safari (iOS) — manually verified, screenshots in `docs/runbooks/pwa-install.md`.
- A cold offline visit shows the app shell within 1 second.
- A message sent offline arrives when the device reconnects.
- The push service worker's lifecycle still works (T21's tests pass).

**Out of scope:** Capacitor / hybrid native (Phase 3), background sync API beyond Firestore's defaults (Phase 3).

---

## T38 — Image optimization (next/image, sized variants)

**Goal:** Photos render fast, responsive, and bandwidth-aware. The current Phase 1 implementation serves the original image at full size.

**Files:**
- `frontend/components/chat/PhotoMessage.tsx` — replace `<img>` with `next/image`
- `backend/app/services/storage.py` — extend the moderation pipeline to generate sized variants on pass
- `infra/buckets.tf` — bucket structure for variants

**Behavior:**
- On moderation pass (T10), the backend generates three sized variants from the original: `400w`, `800w`, `1600w` (long edge), all converted to webp.
- Original is kept (for re-encoding if formats change in the future) but never served to users.
- `mediaRefs[]` on messages now stores a record `{ original, w400, w800, w1600 }` instead of a single URL. Migration: a one-shot script in `infra/scripts/backfill_image_variants.py` re-processes existing photos. Old single-URL records remain readable (the renderer falls back to the single URL).
- Frontend uses `next/image` with `sizes` and `srcSet` derived from the variant URLs.
- Cache-Control: 1 year on the public bucket for the variants (immutable file names — content-hashed).

**Acceptance criteria:**
- A new photo upload produces all three variants visible in the public bucket within 30 seconds of moderation pass.
- The chat renderer requests the smallest variant that fits the viewport.
- The backfill script is idempotent and resumable.
- Median photo download size in the chat drops by ≥ 60% on a measurement run (record before/after numbers).

**Out of scope:** AVIF (webp is enough for v2), CDN provider migration (Firebase Hosting CDN is fine for v2), per-image blurhash placeholders (Phase 3 — nice-to-have).

---

## T39 — Virtualized message list + pagination upgrade

**Goal:** A message list with 1,000+ messages renders smoothly. Pagination defaults move from 50 to a windowed virtual list backed by cursor pagination.

**Files:**
- `frontend/components/chat/MessageList.tsx` — replace flat list with `react-virtuoso` (or `@tanstack/react-virtual`)
- `frontend/lib/hooks/useGroupMessages.ts` — cursor-paged loader with windowed loading
- `firestore/firestore.indexes.json` — none new; existing message indexes already work

**Behavior:**
- Initial load: 50 most recent (unchanged from T08).
- On scroll-up past a threshold (e.g., 30 from the top), load the next 50 older.
- Windowed virtualization: only DOM-render the visible + buffer items. Keep all loaded data in memory (a 1,000-message group is ~250 KB serialized — no need to evict).
- Real-time `onSnapshot` listener still scoped to the most recent 50; older windows are static.
- Scroll position preservation: appending messages at the top (load older) does not jank the scroll.
- A "Jump to latest" button appears when the user has scrolled up past 200 messages.

**Acceptance criteria:**
- A test group seeded with 1,000 messages renders the chat below 500ms p95 paint on a mid-tier Android (manual measurement against a Chrome DevTools throttled CPU profile — record numbers in `docs/runbooks/perf-baselines.md`).
- Scroll position is preserved across "load older" calls (no jump).
- Listener teardown still happens on unmount (regression test on T08's listener-count assertion).
- "Jump to latest" works while a real-time message arrives mid-scroll.

**Out of scope:** offline-first message loading (T37 covers offline persistence at the SDK level), per-message read receipts (Phase 3), infinite scroll forward (load newer is unnecessary because the listener pushes new ones).

---

## T40 — GDPR data export + retention controls

**Goal:** A user can request a JSON export of their data and download it within 24 hours. Retention controls let admins set per-collection retention windows.

**Data correctness for PII export is high-stakes. Use Opus.**

**Files:**
- `frontend/app/settings/data/page.tsx`
- `backend/app/routers/data_export.py` — `POST /api/data/export`, `GET /api/data/export/{requestId}`
- `backend/app/services/data_export.py` — orchestrates the export
- `infra/scheduled/data_export_worker.py` — Cloud Run job that builds the export
- `infra/scheduled/retention_sweeper.py` — Cloud Scheduler job for retention pruning
- `docs/gdpr.md` — update with the runbook and DSAR (Data Subject Access Request) policy

**Behavior:**
- Request: `POST /api/data/export` writes `data_exports/{requestId}` with `userUid`, `requestedAt`, `status: "pending"`. User is emailed (T18) when the export is ready.
- Worker: a Cloud Run job processes the queue every hour. For each pending request:
  1. Reads the user's `users/{uid}`, `users/{uid}/private/profile`, all `groups/{gid}/messages` they authored, all reactions, all reports they filed.
  2. Excludes data about other users (no other UIDs in messages they authored beyond `[redacted-uid]`).
  3. Writes a JSON archive to a private bucket with a 7-day signed URL.
  4. Sends the email with the link.
- Retention controls: admins can set, per collection, a max age (e.g., `audit_log` retained 1 year). The retention sweeper deletes docs past the window. Defaults documented in `docs/gdpr.md` and reviewed before launch.
- Rate limit: 1 export request / 30 days / user.

**Acceptance criteria:**
- A test request produces a valid downloadable JSON archive matching a documented schema (`docs/gdpr-export-schema.json`).
- Other users' UIDs in the export are redacted to `[redacted-uid]`.
- The signed URL expires after 7 days.
- The retention sweeper has a dry-run mode (default) and runs in dry-run for the first week post-deploy.
- All retention windows are documented; no data is silently deleted.

**Out of scope:** account export to other formats (CSV, etc. — Phase 3), GDPR data correction requests (covered by T33's profile editing for the user's own data; admin correction requests are Phase 3).

---

## T41 — Accessibility audit + keyboard nav + screen reader

**Goal:** JACOB meets WCAG 2.1 AA on all primary user paths. Keyboard nav and screen reader work end-to-end for sign-in → join group → post message → react → mention.

**Files:**
- `frontend/lib/a11y.ts` — shared utilities (focus traps, skip links, etc.)
- Updates across `frontend/components/**` — each user-facing component
- `docs/a11y-audit.md` — audit report with findings and fixes
- `frontend/tests/a11y.test.tsx` — vitest + `axe-core` smoke tests on key pages

**Behavior:**
- Run `axe-core` against each primary route in CI; gate the build on no critical violations.
- Keyboard navigation: every interactive element reachable, focus visible, focus traps in modals (report dialog, mention picker, reaction picker), Esc closes overlays.
- Screen reader: every form field labeled, every button has an accessible name, decorative images marked `alt=""`, live regions for chat ("New message arrived"), pinned-banner announces.
- Color contrast: text and interactive elements meet 4.5:1 (or 3:1 for large text). Update `docs/design-tokens.md` if the existing palette fails.
- Skip-to-content link on every page.
- Reduced-motion: respect `prefers-reduced-motion` on transitions, scroll animations, the reaction-picker open animation.

**Acceptance criteria:**
- `axe-core` reports zero critical violations on `/`, `/sign-in`, `/home`, `/groups/[gid]/chat`, `/admin/queue`.
- A keyboard-only test (manual, scripted in `docs/a11y-audit.md`) covers sign-in → group join → message post → react → mention without a mouse.
- A screen-reader pass with VoiceOver (Safari) and NVDA (Firefox/Windows) on the same script — recorded in the audit doc.
- Color contrast meets AA on all text + interactive surfaces (verified by axe).
- The CI gate fails the build on a regression.

**Out of scope:** WCAG AAA, multi-language support (i18n is its own initiative — flag for Phase 3), automated screen-reader regression tests (manual per release is the bar).

---

## What's intentionally not in Phase 2

- **Realtime presence + typing indicators.** Tempting but expensive — a client connection cost on every keystroke. Defer until we know users want it (or T20's analytics tells us so).
- **Native iOS/Android.** PWA covers v2; Capacitor or RN come in Phase 3.
- **APNs / iOS push.** Web push covers most install paths; APNs lands with Phase 3 native.
- **Cross-group / global search.** T25 covers in-group search, which is the first ask. Cross-group is rarely useful and expensive to scope correctly.
- **Custom emoji.** Reactions use the existing sticker set + a small canonical emoji subset.
- **Voice / video calls.** Phase 4 territory.
- **Org / network layer.** Multi-group routing, churches as parents of groups — Phase 4.
- **Monetization.** Phase 3.
- **Full-text search across deleted content for users (vs admins).** T25 is correct; do not extend.
- **2FA UX.** Firebase supports it; the v2 priority is push, not 2FA. Defer to Phase 3.
- **AI content moderation beyond Vision SafeSearch / Cloud NL.** Phase 3 if our queue volume justifies it.
- **Distributed rate limiting via Redis.** slowapi single-instance is fine until traffic warrants.
- **Custom roles per group.** Phase 4. v2 ships with leader + member only.

If a Sonnet plan starts touching anything in this list, stop it and check.
