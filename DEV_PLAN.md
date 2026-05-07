# JACOB — Phase 1 Dev Plan

> **Status (2026-05-06):** Phase 1 plan; useful as historical context for *why* each surface was originally designed the way it was. Several implementation paths in the per-task specs below are **superseded** by the M1–M6 data-layer migration: every task that originally described direct Firestore client SDK writes or `onSnapshot` realtime now goes through `/api/*` and the HTTP polling pattern. See `docs/data-layer-migration-plan.md` for the current frontend ↔ backend boundary, and `CLAUDE.md` ("Architectural rule of thumb", "Polling and event hygiene", "Default-deny rules + backend-mediated writes") for the live conventions. When working a Phase 1 task today, treat the spec as direction-of-travel and read the current `backend/app/routers/` + `frontend/lib/hooks/` for the actual contract.

This is the development plan for Phase 1 of JACOB (the MVP for Christian small-group pilots). Read `CLAUDE.md` first — it pins the conventions every task here inherits.
 
## How to use this document with Sonnet
 
Each task below is a standalone spec sized for one focused Sonnet session. To run a task:
 
1. Open a new Claude Code session in the repo. `CLAUDE.md` loads automatically.
2. Tell Sonnet: *"Implement task `Tnn` from `DEV_PLAN.md`. Read the task spec, then propose a plan before writing code."*
3. Review the plan. Ask for revisions if any acceptance criterion is missing or any out-of-scope item is being touched.
4. Approve, and let it implement.
5. Review the diff against the acceptance criteria. Don't merge if any criterion is unmet.
Reserve Opus for: `T02` (data model + security rules), `T11` (image moderation pipeline), `T15` (account deletion), and any task where Sonnet's plan looks shaky.
 
## Task overview
 
| ID  | Task                                          | Depends on        | Notes                       |
|-----|-----------------------------------------------|-------------------|-----------------------------|
| T01 | Repo scaffold + CI/CD                         | —                 | Foundation                  |
| T02 | Firestore data model + security rules         | T01               | **Use Opus**                |
| T03 | Backend auth dependency + ID-token verify     | T01, T02          |                             |
| T04 | Firebase Auth (email/password + Google)       | T01, T02          |                             |
| T05 | User profile creation + onboarding            | T03, T04          |                             |
| T06 | Stickers seed data + sticker components       | T02               |                             |
| T07 | Group creation + invite/join                  | T03, T04, T05     |                             |
| T08 | Group chat: top-level messages                | T06, T07          |                             |
| T09 | Threading                                     | T08               |                             |
| T10 | Photo upload + moderation pipeline            | T03, T07          | **Use Opus**                |
| T11 | Welcome page + navigation                     | T04, T07, T08     |                             |
| T12 | Reporting via Google Form                     | T08               |                             |
| T13 | Admin dashboard                               | T03, T07, T08     |                             |
| T14 | Account deletion + grace period               | T03, T05          | **Use Opus**                |
| T15 | Observability: logging, Sentry, uptime        | T01               |                             |
| T16 | Backups + restore drill                       | T02               |                             |
| T17 | Rate limiting                                 | T03               |                             |
| T18 | Email service (transactional)                 | T03               |                             |
 
A reasonable solo cadence: 1 task per 3–5 days, parallelizing where dependencies allow. Phase 1 should land in 10–12 weeks.
 
---
 
## T01 — Repo scaffold + CI/CD
 
**Goal:** Working monorepo with Next.js frontend, FastAPI backend, Firebase project linked, GitHub Actions deploying both on merge to `main`. Hello-world endpoints reachable.
 
**Files:**
- `frontend/` — `pnpm create next-app` (TypeScript, Tailwind, App Router, no `src/` dir)
- `backend/` — FastAPI app, `app/main.py` exposing `GET /health`
- `backend/Dockerfile` — multi-stage, non-root user, listens on `$PORT`
- `functions/` — Cloud Functions for Firebase (TypeScript) scaffold via `firebase init functions`. Empty placeholder export. ESLint + tsc configured.
- `.github/workflows/ci.yml` — lint + test on PR (frontend, backend, functions, rules)
- `.github/workflows/deploy.yml` — deploy on merge to `main` (frontend, backend, functions, rules)
- `firebase.json`, `.firebaserc`, `firestore/firestore.rules` (deny-all placeholder), `firestore/firestore.indexes.json`, `firestore/tests/` with `@firebase/rules-unit-testing` installed and a smoke test
- Root `README.md` with local dev instructions
- Root `pnpm-workspace.yaml` declaring `frontend`, `functions`, `firestore` as workspaces
**Acceptance criteria:**
- `pnpm dev` in `frontend/` serves at `localhost:3000`
- `uvicorn app.main:app --reload` in `backend/` serves at `localhost:8000` and `GET /health` returns `{"status":"ok"}`
- `firebase emulators:start` runs auth + firestore emulators successfully
- A PR opened against `main` runs CI (lint + type-check + tests, all passing on the empty scaffold)
- A merge to `main` deploys the frontend to Firebase Hosting, the backend image to Cloud Run, the functions to Firebase, and the Firestore rules + indexes — all from a single workflow
- `firestore/firestore.rules` is `allow read, write: if false;` and is deployed
- A smoke rule test in `firestore/tests/` runs against the emulator in CI and passes
- Secrets used by deploy (Firebase token, GCP service account JSON) are GitHub Actions secrets, not in the repo
**Out of scope:** any business logic, any actual rules, any styling beyond defaults.
 
---
 
## T02 — Firestore data model + security rules
 
**Goal:** Complete Firestore schema with security rules and rule tests. This is the contract every other task depends on.
 
**Files:**
- `firestore/firestore.rules` — full ruleset
- `firestore/firestore.indexes.json` — composite indexes for known queries
- `firestore/tests/rules.test.ts` — rule tests using `@firebase/rules-unit-testing`
- `docs/data-model.md` — human-readable schema doc with example documents per collection
**Data model:** as specified in `CLAUDE.md` under "Firestore conventions." Implement exactly that layout. Add a `schemaVersion` field on `users/{uid}` and `groups/{gid}` documents (initial value `1`) for future migrations.
 
**Security rules — required behaviors (each must have a passing rule test, both allowed and denied case):**
- Any authenticated user can read their own `users/{uid}` document; nobody can read another user's `users/{otherUid}` directly. Public profile fields are exposed via separate read rules on `users/{uid}` (name, photoURL only) — i.e., the document is always readable but `private/profile` subcollection is restricted to the user themselves.
- Group reads: only members of the group (existence of `groups/{gid}/members/{uid}`) can read `groups/{gid}` and its `messages` subcollection.
- Group writes: anyone authenticated can create a group (becomes its leader). Only the leader can update the group document (name, description, isPrivate).
- Members: a leader can add or remove members. A user can remove themselves. Nobody else can write to `members`.
- Messages: a member can create a message in their group with `authorUid == request.auth.uid`. Messages are immutable for non-authors. Authors can update only `editedAt` and `body` (soft-edit) and `deletedAt` (soft-delete). `threadReplyCount` is updated only by Cloud Functions / Admin SDK.
- Threading: replies set `parentMessageId` to a message ID in the same group. The parent must exist (rules can't enforce existence cheaply — enforce in client and verify in tests).
- Stickers: read-only for all authenticated users; writes only via Admin SDK.
- `moderation_queue`, `bans`, `audit_log`: no client access. Backend (Admin SDK) only.
- Banned users: a top-level rule that denies all writes if `bans/{request.auth.uid}` exists and `expiresAt` is in the future.
**Composite indexes to declare:**
- `groups/{gid}/messages` ordered by `createdAt desc` filtered by `parentMessageId == null`
- `groups/{gid}/messages` ordered by `createdAt desc` filtered by `parentMessageId == <id>` (for thread reads)
- `moderation_queue` ordered by `createdAt asc` filtered by `status == "pending"`
**Acceptance criteria:**
- All rule tests pass
- The deny-all default at the bottom of `firestore.rules` is preserved
- `docs/data-model.md` shows an example document for every collection
- A reviewer can read the rules top-to-bottom in under 10 minutes; long, branching expressions are extracted into named functions
**Out of scope:** any UI, any client SDK code, performance tuning of indexes.
 
---
 
## T03 — Backend auth dependency + ID-token verification
 
**Goal:** Reusable FastAPI dependency that authenticates requests via Firebase ID token and exposes the current user.
 
**Files:**
- `backend/app/deps.py` — `get_current_user`, `require_admin`
- `backend/app/services/firebase.py` — Admin SDK init (singleton)
- `backend/app/models/user.py` — `CurrentUser` pydantic model
- `backend/tests/test_deps.py`
**Behavior:**
- `get_current_user` reads `Authorization: Bearer <id_token>`, verifies with `firebase_admin.auth.verify_id_token`, returns `CurrentUser(uid, email, claims)`. Raises 401 on missing/invalid/expired token.
- `require_admin` depends on `get_current_user` and raises 403 unless `claims.get("admin") is True`.
- A small CLI script `backend/scripts/grant_admin.py <uid>` sets the `admin: true` custom claim. Documented in `backend/README.md`.
**Acceptance criteria:**
- Unit tests cover: valid token → user; missing header → 401; malformed header → 401; expired token (mocked) → 401; non-admin hitting admin endpoint → 403; admin → success.
- The Firebase Admin SDK is initialized exactly once per process, using application default credentials.
- Firebase emulator support: when `FIREBASE_AUTH_EMULATOR_HOST` is set, `verify_id_token` uses the emulator.
**Out of scope:** any routes, any rate limiting (T17 covers that).
 
---
 
## T04 — Firebase Auth (email/password + Google sign-in)
 
**Goal:** A user can sign up, sign in, and sign out via the web app.
 
**Files:**
- `frontend/lib/firebase.ts` — initialize app, `getAuth`, `getFirestore`
- `frontend/lib/auth-context.tsx` — `AuthProvider`, `useAuth()`
- `frontend/app/(auth)/sign-in/page.tsx`
- `frontend/app/(auth)/sign-up/page.tsx`
- `frontend/app/(auth)/forgot-password/page.tsx`
- `frontend/components/auth/SignInForm.tsx`, `SignUpForm.tsx`
- `frontend/tests/auth.test.tsx`
**Behavior:**
- Email/password sign-up triggers Firebase email verification (block sign-in until verified, except for Google sign-in which is pre-verified).
- Google sign-in via popup (no redirect for simplicity in v1).
- Forgot-password sends a reset email via Firebase.
- `AuthProvider` exposes `{ user, loading, signOut }`. `loading: true` until the auth state is hydrated; pages that require auth show a spinner during hydration.
- Sign-out clears the session and redirects to `/`.
**Acceptance criteria:**
- Sign-up form validates with zod (email format, password ≥ 10 chars, one number, one symbol).
- Inline error messages for: email already in use, weak password, network error, unverified email at sign-in.
- Tests cover: form validation rules, sign-out clears `user`, `loading` flips to `false` after auth state resolves.
- After successful sign-up, the user lands on `/onboarding` (T05 implements that page).
**Out of scope:** profile fields beyond email — that's T05. 2FA is Phase 1 scope (T17 area) but not in T04.
 
---
 
## T05 — User profile creation + onboarding
 
**Goal:** First-run onboarding that captures profile fields and creates the `users/{uid}` document.
 
**Files:**
- `frontend/app/onboarding/page.tsx`
- `frontend/components/onboarding/ProfileForm.tsx`
- `frontend/components/onboarding/PhotoUpload.tsx` (uses signed URL flow from T10 *or* a placeholder if T10 isn't done — see notes)
- `frontend/lib/hooks/useUser.ts`
**Behavior:**
- On first sign-in with no `users/{uid}` document, the user is routed to `/onboarding`.
- Required fields: `displayName`, `photoURL` (uploaded, see notes), agreement to community guidelines (checkbox).
- Optional: phone, location (city-level, free text), faith background (free text), `isMinor` self-attestation (under 18). Under-13 selection blocks the flow with "JACOB requires you to be at least 13."
- On submit, write to `users/{uid}` with server timestamp `createdAt`. Set `role: "member"` and `schemaVersion: 1`.
**Notes on photo upload sequencing:**
- If T10 is already done, use the moderation-gated upload endpoint.
- If T10 isn't done yet, allow a temporary path: photo is uploaded to a `users/{uid}/uncheckedAvatar` location, displayed only to the uploader, and replaced with a moderated avatar once T10 lands. Document this in `docs/temporary-avatar-flow.md` and remove the doc when T10 is integrated.
**Acceptance criteria:**
- A signed-in user with no profile doc cannot reach `/groups` or `/chat` — middleware redirects to `/onboarding`.
- Form validation matches T04 patterns. Server-side enforcement lives in `firestore/firestore.rules` (T02): required fields, length limits, that `authorUid == request.auth.uid`, and that `isMinor` self-attestation cannot exceed the user's claimed age. No Cloud Function for profile validation — security rules cover it.
- Under-13 selection results in account deletion (immediate, no grace period — they should never have been there).
- Tests cover: redirect logic, form validation, under-13 path.
**Out of scope:** changing profile fields after onboarding (a `/settings/profile` page is Phase 2).
 
---
 
## T06 — Stickers seed data + sticker components
 
**Goal:** The six Phase 1 sticker categories exist in Firestore and the UI has reusable components for displaying and selecting them.
 
**Files:**
- `firestore/seed/stickers.ts` — script that seeds the `stickers` collection (idempotent)
- `frontend/components/stickers/StickerBadge.tsx` — display component
- `frontend/components/stickers/StickerPicker.tsx` — selection UI (multi-select, max 2)
- `frontend/lib/hooks/useStickers.ts` — fetch + cache the sticker list
**Sticker data:** the six categories from the plan doc, each with `slug`, `name`, `audience: "christian"`, `order` (integer for sort), and a hex color (define palette in `docs/design-tokens.md`):
- prayer-request
- offering-help
- need-help
- praise-report
- check-in (default)
- event-meetup
**Acceptance criteria:**
- `pnpm seed:stickers` runs the seed against the project's Firestore (and against the emulator with `--emulator`).
- The seed is idempotent: running twice doesn't duplicate or corrupt.
- `StickerPicker` enforces max 2 selections and shows the default ("Check-In") pre-selected if nothing chosen at submit time.
- `useStickers` fetches once per session and caches; doesn't subscribe in real time.
- Visual snapshot tests for `StickerBadge` (one per sticker) using vitest + Testing Library.
**Out of scope:** BJJ sticker set (Phase 3), sticker analytics (Phase 2), sticker creation UI for moderators (Phase 2).
 
---
 
## T07 — Group creation + invite/join
 
**Goal:** A user can create a group, invite others via a code, and join via a code.
 
**Files:**
- `frontend/app/groups/new/page.tsx` — create group form
- `frontend/app/groups/page.tsx` — list user's groups
- `frontend/app/groups/[gid]/page.tsx` — group home (placeholder; chat lives at `/groups/[gid]/chat`, T08)
- `frontend/app/join/page.tsx` — join via code
- `frontend/components/groups/CreateGroupForm.tsx`
- `frontend/lib/hooks/useGroups.ts`, `useGroup.ts`
- `backend/app/routers/groups.py` — backend role only for invite-code generation/regeneration (uses Admin SDK to set codes that aren't trivially guessable)
- `firestore/tests/groups.rules.test.ts` — extends T02 tests
**Behavior:**
- Create group: name (required), description (optional), `isPrivate` toggle. Backend generates an 8-char base32 invite code (collision-checked) and writes the group doc + the creator's `members/{uid}` doc with `role: "leader"` in a single transaction.
- Join via code: `/join?code=XXXXXXXX` → frontend calls `POST /api/groups/join` with the code. Backend validates the code, checks the user isn't already a member, writes `members/{uid}` with `role: "member"`, increments `memberCount`. Returns the group ID for redirect.
- Leader can regenerate the invite code from the group settings page (calls `POST /api/groups/{gid}/invite/rotate`, leader-only).
**Acceptance criteria:**
- Creating a group lands the user on `/groups/[gid]` with leader permissions.
- Trying to join a group you're already in returns 409 with code `"already_member"`.
- Trying to join with an invalid code returns 404 with code `"invalid_invite"`.
- Code rotation invalidates the old code immediately.
- Rule tests confirm: a non-member cannot read the group; after joining, they can. A non-leader cannot rotate the code (enforce on backend; rules don't see the code).
- Backend tests cover the three error paths above plus the happy path.
**Out of scope:** removing members (admin/leader actions land in T13), private invite links via email (Phase 2), group avatars (Phase 2).
 
---
 
## T08 — Group chat: top-level messages
 
**Goal:** Members of a group can post and read top-level messages with sticker tagging. Real-time updates via Firestore `onSnapshot`.
 
**Files:**
- `frontend/app/groups/[gid]/chat/page.tsx`
- `frontend/components/chat/MessageList.tsx`
- `frontend/components/chat/MessageInput.tsx`
- `frontend/components/chat/MessageItem.tsx`
- `frontend/lib/hooks/useGroupMessages.ts` — paginated, realtime hook scoped to top-level messages
**Behavior:**
- Message creation: the user types a body, picks up to 2 stickers (default Check-In if none), submits. Client writes directly to `groups/{gid}/messages/{mid}` (Firestore client SDK, with security rules enforcing membership and `authorUid`).
- Message body: max 4000 characters. Plain text only in v1 — no markdown rendering, no link previews.
- Pagination: load 50 most recent top-level messages (`parentMessageId == null`) on mount; "Load older" button paginates back by 50 using a cursor.
- Real-time: a single `onSnapshot` listener on the most-recent 50 surfaces new messages and edits. Older pages are non-realtime.
- Edit: author can edit their own message body within 15 minutes of posting. After 15 minutes, edit is disallowed in the UI (backend rules enforce this via a write guard on `editedAt`).
- Soft-delete: author or group leader can delete a message (sets `deletedAt`). Deleted messages render as "[message removed]" but stay in the thread.
**Acceptance criteria:**
- Messages appear in real time in another browser tab without refresh.
- Sticker selection is required (UI defaults to Check-In if nothing chosen).
- Switching groups tears down the old listener — verified in a test that asserts on `onSnapshot` mock unsubscribe count.
- Pagination doesn't refetch already-loaded messages on scroll-up.
- Rule tests confirm a non-member cannot read messages and cannot create messages.
**Out of scope:** threading (T09), photo attachments (T10), search, mentions, reactions, typing indicators.
 
---
 
## T09 — Threading
 
**Goal:** Slack-style threads: any top-level message can have a thread of replies. Reply count shows on the parent. Notifications scope to thread participants.
 
**Files:**
- `frontend/components/chat/ThreadPanel.tsx` — slide-over panel
- `frontend/components/chat/ThreadReplyInput.tsx`
- `frontend/lib/hooks/useThreadMessages.ts` — paginated realtime hook for one thread
- `functions/src/onMessageWrite.ts` — Firestore trigger (Cloud Functions for Firebase v2, TypeScript) that increments/decrements `threadReplyCount` on the parent message when a reply is created or soft-deleted
- `functions/src/index.ts` — exports the trigger
**Behavior:**
- Clicking "Reply" on a top-level message opens the thread panel showing all replies for that `parentMessageId`.
- Replies inherit the parent's stickers — no sticker UI inside the thread (per the revised plan).
- "Also post to channel" checkbox on a reply: if checked, reply is duplicated as a top-level message that links back to the thread (set a `repostOfThread: <parentMessageId>` field).
- `threadReplyCount` on the parent is maintained by a Firestore trigger, not by the client (clients can't be trusted with the increment).
- Notifications: in v1, only an in-app indicator (a small unread dot) on threads where the user has previously replied. Email/push come in Phase 3.
**Acceptance criteria:**
- Posting a reply increments the parent's `threadReplyCount` within 2 seconds (function cold-starts excepted).
- Soft-deleting a reply decrements the count.
- The parent message in the main feed shows "N replies" when `threadReplyCount > 0`.
- A user who has not replied in a thread does not see the unread indicator.
- Rule tests confirm: clients cannot write `threadReplyCount`; the function's service-account writes do.
**Out of scope:** thread following without participation (Phase 2), email digest of new replies (Phase 2).
 
---
 
## T10 — Photo upload + moderation pipeline
 
**Goal:** Users can attach photos to messages. Every photo is gated by Cloud Vision SafeSearch and a CSAM hash check before becoming visible to anyone but the uploader.
 
**This is the highest-stakes task in Phase 1. Use Opus. Get the resulting code reviewed by a lawyer familiar with NCMEC reporting before opening uploads to real users.**
 
**Files:**
- `backend/app/routers/uploads.py` — `POST /api/uploads/photos`
- `backend/app/services/moderation.py` — SafeSearch wrapper, hash-service wrapper, NCMEC report stub
- `backend/app/services/storage.py` — GCS signed URL generation
- `frontend/components/chat/PhotoAttachButton.tsx`
- `frontend/lib/hooks/useUploadPhoto.ts`
- `infra/buckets.tf` (or equivalent gcloud script) — defines two buckets: `jacob-media-public-{env}` (CDN-served, public reads) and `jacob-media-quarantine-{env}` (private, no public reads). Object lifecycle: quarantine bucket auto-deletes after 90 days.
- `docs/moderation-pipeline.md` — sequence diagram and the lawyer-review checklist
**Pipeline (executes server-side; the client never gets the public URL until the photo passes):**
1. Client requests an upload from `POST /api/uploads/photos` with `groupId`, `mimeType`, `byteCount`.
2. Backend validates: user is a member of the group, mime is `image/jpeg|png|webp`, size ≤ 8 MB.
3. Backend generates a signed PUT URL into the **quarantine bucket** with a 5-minute expiry. Returns it to the client along with an `uploadId`.
4. Client PUTs the bytes to GCS directly.
5. Client calls `POST /api/uploads/{uploadId}/finalize`.
6. Backend (a) hashes the image and queries the CSAM hash service. On hit: quarantine permanently, log to `moderation_queue` with reason `"csam_hash_match"`, file an NCMEC report (stub implementation in v1, real integration before launch — see lawyer-review checklist), 451 to the client. (b) calls Vision SafeSearch. If `adult` or `violence` is `LIKELY` or `VERY_LIKELY`, quarantine and 422 with reason. (c) on pass: copy the object to the public bucket, delete from quarantine, return the public URL.
7. Client adds the public URL to `mediaRefs[]` on the message it's about to send.
**Acceptance criteria:**
- A SafeSearch-failing image is held in the quarantine bucket and never reaches the public bucket.
- A CSAM hash hit triggers a `moderation_queue` write and a NCMEC report stub call (verified via mock).
- The public bucket has IAM that allows public reads but disallows the backend service account from writing — only the SafeSearch-pass code path can write, via a separate, narrowly-scoped service account.
- The signed URL flow rejects oversize uploads at the GCS layer (bucket-level size limits) as a defense in depth, not just at the API.
- Tests cover: happy path, oversize, wrong mime, non-member of group, SafeSearch fail, hash-service hit.
- The lawyer-review checklist in `docs/moderation-pipeline.md` is filled in (or explicitly marked "PENDING — must be complete before public launch").
**Out of scope:** video uploads (Phase 2), image transformations (resize/thumbnails — Phase 2), avatar moderation (T05 has a temporary path; integrate this pipeline there as the final step of T10).
 
---
 
## T11 — Welcome page + navigation
 
**Goal:** A logged-in user lands on a welcome page that shows their groups, recent activity, and primary navigation.
 
**Files:**
- `frontend/app/page.tsx` — public landing for non-authed
- `frontend/app/(authed)/home/page.tsx` — authed home
- `frontend/components/nav/AppShell.tsx` — sidebar with Chats, About/FAQ
- `frontend/components/home/RecentActivity.tsx`
- `frontend/app/about/page.tsx`
- `frontend/app/faq/page.tsx`
**Behavior:**
- Non-authed `/` shows brand pitch + sign-in CTA.
- Authed `/home` shows: list of the user's groups, "Recent in your groups" feed (last 10 messages across the user's groups, ordered by `createdAt desc`), maintenance-mode banner (controlled via a Remote Config flag).
- Sidebar persistent: Chats (`/groups`), About, FAQ. No Forums in Phase 1 — that's Phase 2.
- About and FAQ pages: static MDX/Markdown content. Content stub in v1; copy to be filled in by Christopher before launch.
**Acceptance criteria:**
- Maintenance flag flipped on shows the banner without redeploy (Remote Config).
- "Recent in your groups" doesn't leak messages from groups the user isn't in (rule-enforced — verify via test that simulates a non-member).
- Mobile layout: sidebar collapses to a hamburger at < 768px.
**Out of scope:** group discovery (Phase 2), Bible verse feed (Phase 2), playbooks (Phase 4).
 
---
 
## T12 — Reporting via Google Form
 
**Goal:** Every reportable surface has a "Report" link that opens a pre-filled Google Form. Reports land in a Sheet that moderators triage daily.
 
**Files:**
- `frontend/components/moderation/ReportLink.tsx`
- `frontend/lib/report-url.ts` — builds the prefilled URL
- `docs/moderation-runbook.md` — how moderators use the Sheet, SLA, escalation
**Behavior:**
- A Google Form is created out-of-band (manual setup in v1; documented in the runbook). The form has fields: `content_type` (message | profile | group | other), `content_id`, `group_id`, `reporter_uid`, `reason` (free text), `timestamp`.
- `ReportLink` renders a small icon button near each message, profile header, and group header. Clicking it opens the prefilled form in a new tab.
- The prefill uses Google Forms' `entry.<id>` URL parameters. IDs are stored in `frontend/lib/report-url.ts` as constants; `docs/moderation-runbook.md` documents how to find them.
**Acceptance criteria:**
- A click on Report from a message includes `content_id`, `group_id`, and `reporter_uid` (the user's uid, sourced from `useAuth()`) in the URL.
- A click on Report from a group page includes `group_id` and `reporter_uid`.
- A click on Report when not signed in still works but `reporter_uid` is left blank (anonymous reports allowed).
- No PII is logged to Cloud Logging on click.
**Out of scope:** native in-app reporting (Phase 2), report status visibility for the reporter (Phase 2).
 
---
 
## T13 — Admin dashboard
 
**Goal:** A web UI for admin and moderator actions: review the moderation queue, ban/unban users, view groups, manually flag content.
 
**Files:**
- `frontend/app/admin/layout.tsx` — admin shell, requires admin claim
- `frontend/app/admin/queue/page.tsx` — moderation queue
- `frontend/app/admin/users/page.tsx` — user search + actions
- `frontend/app/admin/groups/page.tsx` — group search + actions
- `backend/app/routers/admin.py` — `POST /api/admin/users/{uid}/ban`, `POST /api/admin/users/{uid}/unban`, `POST /api/admin/moderation/{itemId}/resolve`
- `backend/app/services/audit.py` — write to `audit_log` for every admin action
**Behavior:**
- Admin layout client-side guards on the `admin` custom claim; backend enforces with `require_admin`.
- Queue page: paginated list of `moderation_queue` items where `status == "pending"`, ordered by `createdAt asc`. Click an item to see the resource (message/photo) and choose Approve, Reject, or Reject + Ban.
- Ban: sets `bans/{uid}` with `expiresAt` (24h, 7d, or permanent — three buttons). Writes an `audit_log` entry.
- Unban: deletes `bans/{uid}`, writes an `audit_log` entry.
**Acceptance criteria:**
- Non-admin users hitting `/admin` are redirected to `/home`.
- All admin actions write an `audit_log` entry with `actorUid`, `action`, `targetRef`, `payload`.
- Backend tests cover: non-admin → 403, admin happy path, idempotent unban (unbanning a non-banned user is a no-op, returns 200).
- Rule tests confirm `audit_log` is unreadable and unwritable from the client.
**Out of scope:** analytics dashboards (Phase 2), exporting reports (Phase 2), per-group moderator tooling distinct from platform mods (Phase 2).
 
---
 
## T14 — Account deletion + grace period
 
**Goal:** Users can request account deletion. After a 14-day grace period, profile and PII are hard-deleted; authored messages are tombstoned.
 
**This task touches data-correctness flows that are hard to undo. Use Opus.**
 
**Files:**
- `frontend/app/settings/delete-account/page.tsx` — confirmation flow
- `backend/app/routers/account.py` — `POST /api/account/delete`, `POST /api/account/delete/cancel`, `GET /api/account/delete/status`
- `backend/app/services/deletion.py` — orchestrates the deletion job
- `infra/scheduled/finalize_deletions.py` — Cloud Scheduler job that runs daily and finalizes accounts past their grace window
- `firestore/tests/deletion.rules.test.ts`
**Behavior:**
- Request: `POST /api/account/delete` sets `users/{uid}.deletionRequestedAt = serverTimestamp()`. The user is signed out. Subsequent sign-ins during the grace window show a "Your account is scheduled for deletion on YYYY-MM-DD. Cancel?" banner.
- Cancel: `POST /api/account/delete/cancel` clears `deletionRequestedAt` if within 14 days.
- Finalize: the daily job finds users with `deletionRequestedAt + 14d <= now` and:
  1. Disables the Firebase Auth account.
  2. Tombstones authored messages: replace `authorUid` with the constant `"[deleted]"`, blank `body` if the user opted for hard-delete-content, otherwise keep body.
  3. Deletes `users/{uid}/private/profile`.
  4. Deletes the user's avatar object from GCS.
  5. Deletes `users/{uid}` document.
  6. Logs a final `audit_log` entry with `actorUid: "system"`.
- A user who hard-deleted-content keeps a `keepBody: false` flag set at request time.
**Acceptance criteria:**
- Cancellation works any time within the 14-day window.
- After finalization: the Firebase Auth account is disabled (sign-in fails with `account-disabled`); `users/{uid}` is gone; messages remain readable to other group members but show "[deleted user]" as author; if the user opted for body deletion, body is empty.
- Tests cover: request, cancel, finalize-too-early-no-op, finalize-on-time, the rule that no other user can write `deletionRequestedAt` on someone else's doc.
**Out of scope:** GDPR data export (also Phase 1 if Christopher has EU users at launch, but as a separate task — flag in `docs/gdpr.md`).
 
---
 
## T15 — Observability: logging, Sentry, uptime
 
**Goal:** Every error, slow request, and downtime event is visible without SSH'ing into anything.
 
**Files:**
- `backend/app/middleware/logging.py` — structured logging middleware (request id, latency, status)
- `backend/app/services/sentry.py` — init + integration
- `frontend/lib/sentry.ts`
- `infra/uptime-checks.tf` (or equivalent)
**Behavior:**
- All backend logs are JSON with `request_id`, `uid` (if authed), `route`, `status`, `latency_ms`. Cloud Logging picks them up.
- Sentry captures unhandled exceptions on backend and frontend, with PII scrubbing (no message bodies, no email addresses).
- Cloud Monitoring uptime checks on the public site root and the backend `/health`. Alerts go to Christopher's email and a webhook to a private Slack/Discord (whichever he prefers — captured in `docs/oncall.md`).
- A budget alert fires at 50% and 100% of a configured monthly GCP budget. Initial budget: $150/month.
**Acceptance criteria:**
- Triggering a deliberate `raise ValueError("test")` from a dev-only endpoint surfaces in Sentry with a stack trace and no PII.
- The uptime check is visible in Cloud Monitoring and has fired at least one synthetic alert in dev.
- Budget alerts are configured and the alert recipient is verified.
**Out of scope:** APM tracing (Cloud Trace integration is Phase 2 unless latency becomes an issue).
 
---
 
## T16 — Backups + restore drill
 
**Goal:** Firestore data is backed up daily and can be restored. A documented restore drill has been run.
 
**Files:**
- `infra/scheduled/firestore_export.py` — Cloud Scheduler + Cloud Run job that triggers `firestore export` to a backup bucket
- `infra/buckets.tf` — `jacob-backups-{env}` bucket with object lifecycle: delete after 30 days for daily exports, 90 days for weekly
- `docs/runbooks/restore.md` — step-by-step restore procedure, including how to restore to a non-prod project for verification
**Behavior:**
- Daily export at 03:00 UTC to `gs://jacob-backups-{env}/daily/{YYYY-MM-DD}/`.
- Weekly export on Sundays to `gs://jacob-backups-{env}/weekly/{YYYY-WW}/`.
- Media bucket has object versioning enabled with 60-day retention on overwritten objects.
- Restore drill: Christopher runs `docs/runbooks/restore.md` end-to-end against a dev project once. Time taken is recorded.
**Acceptance criteria:**
- Two consecutive daily exports succeed (verify in the bucket).
- Restore drill produces a working dev project from yesterday's backup, with sign-in and at least one group's messages readable.
- The runbook has timing notes (how long export, copy, restore each took).
**Out of scope:** point-in-time recovery (Firestore PITR is a separate paid feature; defer until paying users).
 
---
 
## T17 — Rate limiting
 
**Goal:** Abuse vectors (auth, posting, uploads, invites, reports) have per-user/per-IP limits.
 
**Files:**
- `backend/app/limits.py` — limit definitions
- `backend/app/middleware/rate_limit.py` — slowapi setup
- `firestore/firestore.rules` — additions for write-rate guards via timestamp comparisons (where rules can express it; see notes)
**Limit table:**
 
| Surface                 | Limit                              |
|-------------------------|------------------------------------|
| Auth (sign-in attempts) | 5 / minute / IP                    |
| Sign-up                 | 3 / hour / IP                      |
| Password reset emails   | 3 / hour / email                   |
| Message posting         | 30 / minute / user                 |
| Photo upload init       | 10 / hour / user                   |
| Group invite generation | 20 / day / leader                  |
| Reports                 | 10 / day / user                    |
 
**Notes on Firestore rule limits:** for message posting, a rule can compare `request.resource.data.createdAt` against the latest message in the user's history, but expressing "30 in the last 60s" cleanly is hard. In v1, enforce posting limits at the backend tier — but reads/writes that bypass the backend (the chat write path is direct-to-Firestore) require a creative approach: either route message writes through the backend (cost: an extra hop), or accept that the limit is best-effort via a Cloud Function that disables the account on egregious bursts. **Decide this trade-off explicitly before implementing T17 — write a one-page ADR in `docs/adr/0001-rate-limit-strategy.md`.**
 
**Acceptance criteria:**
- Hitting any limit returns 429 with a `Retry-After` header.
- Tests cover at least one limit per surface.
- The ADR is written and links to the chosen approach.
**Out of scope:** distributed rate limiting via Redis (single-instance slowapi is fine for v1).
 
---
 
## T18 — Email service (transactional)
 
**Goal:** Transactional emails (verification, password reset, moderation notice, deletion confirmations) are sent reliably with consistent branding.
 
**Files:**
- `backend/app/services/email.py` — SendGrid client wrapper
- `backend/app/templates/email/` — Jinja2 templates per email type
- `docs/email-templates.md` — preview screenshots
**Behavior:**
- Firebase handles email-verification and password-reset emails by default (use Firebase's templates with Christopher's branding configured in the Firebase console — capture screenshots in `docs/email-templates.md`).
- App-originated emails (moderation notice, deletion confirmation, deletion finalized) go through SendGrid using the wrapper.
- Templates live in `backend/app/templates/email/{name}.html.j2` and `{name}.txt.j2`. Plain-text fallback is required.
- Sender: `JACOB <noreply@<domain>>`. Reply-to: an inbox Christopher actually monitors.
**Acceptance criteria:**
- Sending each app-originated template against a dev SendGrid key succeeds and the resulting email looks correct in Gmail and Apple Mail (screenshots in `docs/email-templates.md`).
- SPF, DKIM, and DMARC are configured for the sender domain (verified via `mail-tester.com` or equivalent — score ≥ 9/10).
- A failed send (e.g., 5xx from SendGrid) is retried up to 3 times with backoff; final failure goes to Sentry.
**Out of scope:** marketing email, weekly digests (Phase 2), unsubscribe management (Phase 2 — but the privacy policy from day one must mention it).
 
---
 
## What's intentionally not in Phase 1
 
- Cross-group browsing and message boards (Phase 2)
- Native in-app reporting + queue UI (Phase 2 — Phase 1 uses Google Form)
- Video uploads (Phase 2)
- Bible verse feed (Phase 2)
- Sticker analytics (Phase 2)
- Group discovery (Phase 2)
- Mobile app (Phase 3)
- BJJ sticker set + brand-voice variant (Phase 3)
- Monetization (Phase 3)
- Org/network layer, playbooks, third-party API (Phase 4)
- Full-text search across messages (deferred — Firestore filters are enough for v1; revisit before public beta)
If a Sonnet plan starts touching anything in this list, stop it and check.
