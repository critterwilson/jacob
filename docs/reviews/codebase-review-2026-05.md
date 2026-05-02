# JACOB codebase review — Phase 1 (T04–T18)

**Date:** 2026-05-02
**Branch reviewed:** `main` @ `97584f8` (T16: Firestore backups + restore runbook)
**Reviewer:** Claude (automated review)
**Scope:** backend, frontend, Firestore rules + indexes, Cloud Functions, infra (Terraform / Dockerfile / scheduled jobs), CI/CD, tests, docs.

The Phase 1 surface is small but dense. The architecture is consistent with `CLAUDE.md` (Firestore client SDK + rules for end-user data, FastAPI for trusted ops, Cloud Functions for fan-out), and most routers/components hew to the documented conventions. The findings below are concentrated in three areas: (1) Firestore rules are missing positive shape validation, (2) several T15-era launch features are wired up but not actually invoked, and (3) the moderation pipeline's CSAM check fails *open* when misconfigured. None of these are difficult to fix; most are one-PR.

---

## TL;DR — top 5

1. **Group members cannot read each other's profile docs** (`firestore.rules:60-61`) — `allow read: if isUser(uid)`. The chat UI consequently renders raw UIDs as author names (`MessageItem.tsx:91`). Either widen the read rule to "any signed-in user" (matches the comment at line 57-59 about "public-safe fields") or denormalize displayName onto each message. **Functional bug; fix before any beta.**

2. **CSAM hash check silently passes when `JACOB_HASH_SERVICE_URL` is unset** (`backend/app/services/moderation.py:80-83`) — a misconfigured prod deploy logs a warning and returns `matched=False`, and the upload is approved. CSAM gating must fail closed. **Pre-launch blocker.**

3. **Frontend Sentry is dead code** (`frontend/lib/sentry.ts:47` is exported but never invoked anywhere in `frontend/`). T15 claims Sentry is wired up; on the frontend it is not. **No frontend exception telemetry today.**

4. **The in-app reporting flow links to a non-existent Google Form** (`frontend/lib/report-url.ts:3-12`) — `FORM_ID = "YOUR_FORM_ID"` and every entry ID is a placeholder. Every report click opens a 404. T12 ships dead. **Pre-launch blocker.**

5. **Firestore rules accept arbitrary fields and arbitrary sizes on every create/update** — message body has no length cap, group `name`/`description` have no length cap, `users/{uid}` update accepts any non-locked field of any type/size including a `javascript:` `photoURL`, `stickerIds` is unvalidated, member `role` is not constrained to the known set, and `inviteCode` can be set to `""` by a leader and matched by every join attempt. See findings 1-4, 7, 13-15 in the **Critical/High** sections. **Hardening pass needed before opening to real users.**

---

## Critical

### C1 — Author identity is hidden behind the rules; chat UI shows raw UIDs
- **Where:** `firestore/firestore.rules:60-61`, `frontend/components/chat/MessageItem.tsx:91`, `frontend/lib/hooks/useUser.ts:38`.
- **Evidence:** `match /users/{uid} { allow read: if isUser(uid); }` — only the user themselves can read their own profile. `MessageItem.tsx` renders `{isAuthor ? "You" : message.authorUid}` because the SDK call would be denied.
- **Why it matters:** Chat is unusable when every author except yourself appears as a 28-char UID. Group rosters, recent-activity feeds, admin context all share the same hole.
- **Fix:** Either change the read rule to `allow read: if isSignedIn()` (matches the comment that the doc holds "public-safe fields"; move PII to `users/{uid}/private/profile`), or denormalize `authorDisplayName`/`authorPhotoURL` onto each message at write time (and tighten the user doc to private). The first is a one-line rules change; the second is more honest if displayName changes are expected.

### C2 — CSAM hash check fails open when not configured
- **Where:** `backend/app/services/moderation.py:80-83`.
- **Evidence:**
  ```python
  endpoint = os.environ.get(HASH_SERVICE_URL_ENV)
  if not endpoint:
      logger.warning("CSAM hash service not configured; allowing image without check")
      return HashCheckResult(matched=False)
  ```
- **Why it matters:** The "Things to never do" list in `CLAUDE.md` and the lawyer-review checklist treat CSAM gating as table-stakes. A production deploy that drops `JACOB_HASH_SERVICE_URL` (typo, secret-rotation gap) will still accept uploads and let them straight to the public bucket.
- **Fix:** Fail closed in production. Acceptable patterns: (a) raise on missing env in non-test environments, gated by `JACOB_DISABLE_MODERATION` for emulator runs; (b) on a separate startup health check, require both `JACOB_HASH_SERVICE_URL` and `JACOB_NCMEC_ENDPOINT` and refuse to start without them. Add a backend test that asserts a missing-endpoint configuration raises rather than returns "no match."

### C3 — Frontend Sentry is never initialised
- **Where:** `frontend/lib/sentry.ts:47-58`.
- **Evidence:** `initSentry()` is exported but no caller exists anywhere in `frontend/` (verified with `grep -r "initSentry\|Sentry.init" frontend/`). T15 documentation says exceptions flow to Sentry from both ends.
- **Why it matters:** Frontend exception telemetry is the primary way you'll find regressions in App Hosting deploys. Today there is none. The on-call runbook's "Open Sentry and filter by request_id" step (`docs/oncall.md:72`) is unreachable.
- **Fix:** Call `initSentry()` from `frontend/app/layout.tsx` (or from a small `"use client"` wrapper that sits inside `AuthProvider`). Add a smoke test that asserts `Sentry.init` was called when `NEXT_PUBLIC_SENTRY_DSN` is set, mirroring the backend test.

### C4 — Reporting links go to a placeholder Google Form
- **Where:** `frontend/lib/report-url.ts:3-12`.
- **Evidence:** `const FORM_ID = "YOUR_FORM_ID"; ENTRY = { contentType: "entry.000000001", ... }`. The form has not been created and the entry IDs are placeholder strings.
- **Why it matters:** Every "Report" click on a message (`MessageItem.tsx:215-222`) opens `https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform` — a Google 404. Users believe they reported; nothing is captured. T12 is functionally not done.
- **Fix:** Create the form per `docs/moderation-runbook.md`, paste the real `FORM_ID` and entry IDs into `report-url.ts`. Add a build-time guard: throw if `FORM_ID === "YOUR_FORM_ID"` and `NODE_ENV !== "test"`, or fail in CI via a regex check.

### C5 — Service-account JSON key in GitHub secrets for deploys
- **Where:** `.github/workflows/deploy.yml:46-48`.
- **Evidence:** `google-github-actions/auth@v2` is invoked with `credentials_json: ${{ secrets.GCP_SA_KEY }}`.
- **Why it matters:** Long-lived SA keys are the worst-case credential to lose. Workload Identity Federation (OIDC) is the documented Google replacement. A leaked key is a full project compromise until manual rotation; nothing in the repo describes a rotation procedure.
- **Fix:** Switch to Workload Identity Federation (`workload_identity_provider:` + `service_account:` inputs on `auth@v2`). Add `permissions: { id-token: write, contents: read }` to the deploy job. Delete `GCP_SA_KEY`.

---

## High

### H1 — Cloud Functions message trigger has no idempotency, no error handling, no region pin
- **Where:** `functions/src/onMessageWrite.ts` (entire file).
- **Evidence:** `onDocumentWritten("groups/{gid}/messages/{mid}", ...)` runs `parentRef.update({ threadReplyCount: FieldValue.increment(1), ... })` unconditionally on the create branch. v2 event triggers are at-least-once; same event can fire twice, doubling the counter. Hard deletes (`!after?.exists`) and undeletes (`deletedAt: null → ts → null`) are also unhandled. No `region`, no `maxInstances`, no `try/catch`, no `logger`.
- **Why it matters:** `threadReplyCount` will silently drift in production and there is no log to find which event caused the drift. Default region is likely `us-central1` while Firestore is `nam5` — every write incurs cross-region egress.
- **Fix:** Add an idempotency record (write a sub-doc keyed by `event.id` inside the parent before incrementing, in a transaction). Wrap writes in `try/catch` and log with `event.id`. Pass `{ region: "us-central1", maxInstances: 10, retry: false }` to `onDocumentWritten`. Add the missing branches.

### H2 — Group create / join / message-send have no rate limit
- **Where:** `backend/app/routers/groups.py:67-100, 103-137`, message writes go straight to Firestore (`frontend/components/chat/MessageInput.tsx:65`).
- **Evidence:** `create_group` and `join_group` have no `@limiter.limit(...)` decorator. ADR 0001 explicitly defers message-posting limits to "best-effort future Cloud Function" but the function does not exist.
- **Why it matters:** A signed-in attacker can churn groups (each costs ~3 Firestore writes + an invite-code search), churn join attempts, or spam messages directly to Firestore. Cloud Run cost and Firestore quota will absorb most of it; abusive UX inside groups won't.
- **Fix:** Add `GROUP_CREATE = "5/hour"` and `GROUP_JOIN = "20/hour"` to `limits.py` and decorate. For message writes, either rate-limit in security rules via a per-user "last write at" doc or build the deferred Cloud Function circuit-breaker (ADR 0001 §"Message posting").

### H3 — Firestore rules accept arbitrary keys and arbitrary values on every mutation
- **Where:** `firestore.rules` throughout — see `users/{uid}` create (lines 63-66) and update (lines 68-70), `groups/{gid}` create (86-90) and update (94-95), `groups/{gid}/messages/{mid}` create (128-136), `groups/{gid}/members/{uid}` (108-119), `users/{uid}/private/{docId}` (76-79).
- **Evidence:** No `request.resource.data.keys().hasOnly([...])` anywhere. No length caps on `body`, `name`, `description`, `displayName`, `photoURL`. No type assertions on `stickerIds`, `mediaRefs`, `participants`. `role` on a member doc can be set by a leader to any string (`""`, `"admin"`, `"owner"`). `inviteCode` can be set by a leader to `""`, after which `where("inviteCode","==","")` matches every group with the same. `users/{uid}/private/{docId}` allows any subdoc id and any field shape — a user can self-claim `email = anyone@anywhere.com`.
- **Why it matters:** Any single bug in client code (or a malicious client crafted by anyone with a Firebase ID token) can write 1MB of garbage into a doc, attribute messages to other users via the unlisted-field gap, or set fields that other code might trust later. CLAUDE.md's "Things to never do" rule about reading/writing arbitrary fields applies here.
- **Fix:** Add `keys().hasOnly([...])` plus per-field type/length checks on every create and update predicate. Required fields go positive (`request.resource.data.foo is string && size() <= N`), optional fields are still bounded if present. Pin `role in ['member','leader']`. Pin `inviteCode is string && size() >= 6`. Pin `body is string && size() <= 4000`. Pin `stickerIds is list && size() <= 5`. Pin `mediaRefs is list && size() <= 4`. Same for `name`/`description`/`displayName`.

### H4 — Message soft-delete does not pin `deletedAt = request.time`; client can backdate or "undelete"
- **Where:** `firestore.rules:141-148`.
- **Evidence:**
  ```
  || ((resource.data.authorUid == request.auth.uid || isGroupLeader(gid))
       && onlyChanges(['deletedAt']))
  ```
  No `request.resource.data.deletedAt == request.time`, no `!= null`. The edit branch correctly pins `editedAt == request.time`; the delete branch does not.
- **Why it matters:** A client can soft-delete with a future `deletedAt` (UI shows "deleted in 2099") or set `deletedAt = null` after a previous soft-delete (un-delete). The Cloud Function (`onMessageWrite.ts:36-42`) keys off `deletedAt` transitions, so this directly produces wrong `threadReplyCount`s.
- **Fix:** Add `request.resource.data.deletedAt == request.time && resource.data.deletedAt == null` to the soft-delete branch.

### H5 — Public media bucket is world-listable, not just world-readable
- **Where:** `infra/buckets.tf:145-151`.
- **Evidence:** `roles/storage.objectViewer` granted to `allUsers`. That role includes `storage.objects.list`, not just `get`.
- **Why it matters:** Anyone on the internet can list every uploaded photo URL. Object names are uuid-based (good), but listing leaks total upload volume, growth rate, and lets future bug-bounty-style reporters enumerate previously-deleted-but-versioned objects (the bucket has `versioning = true` with 60-day retention — `buckets.tf:130-142`). For a Christian small-group app whose users include minors, the listability gap is reputational.
- **Fix:** Either drop `allUsers` and serve via Cloud CDN with signed URLs, or use a cookie-based access proxy. If you keep public reads, deny `storage.objects.list` (custom role granting only `storage.objects.get`).

### H6 — Admin user/group search is broken; `q + ""` is not a prefix
- **Where:** `backend/app/routers/admin.py:165-169, 270-275`.
- **Evidence:**
  ```python
  .where("displayName", ">=", q).where("displayName", "<=", q + "")
  ```
  `q + ""` evaluates to `q`, so this is `>= q && <= q` (exact match), not a prefix search.
- **Why it matters:** Admin search returns at most exact-name matches. An admin searching "ali" cannot find "Alice." This is a UX hole reachable on every admin page.
- **Fix:** Use `q + ""` as the upper bound (Firestore prefix-range idiom).

### H7 — Admin "browse without query" needs descending `createdAt` indexes that don't exist
- **Where:** `backend/app/routers/admin.py:172-173, 277-279`, `firestore/firestore.indexes.json` (no `fieldOverrides`).
- **Evidence:** `db.collection("users").order_by("createdAt", direction="DESCENDING").limit(...)` — Firestore auto-builds single-field indexes ASCENDING only at collection scope; DESCENDING needs an explicit `fieldOverrides` entry. Same for `groups`.
- **Why it matters:** First time an admin loads the Users or Groups page in production with no `q`, the query throws `FAILED_PRECONDITION` and the whole page errors. Will not be caught by the rules emulator (no rule involved); only by hitting prod.
- **Fix:** Add `fieldOverrides` for `users.createdAt` and `groups.createdAt` with `DESCENDING` to `firestore.indexes.json`, deploy via the existing `firebase deploy --only firestore` step.

### H8 — Quarantine bucket auto-deletes after 90 days regardless of moderation state
- **Where:** `infra/buckets.tf:86-94`.
- **Evidence:** `lifecycle_rule { condition { age = 90 } action { type = "Delete" } }` — applies to every prefix.
- **Why it matters:** A CSAM-flagged object moved to `_held/` (`storage.py:101-111`) lives in the same bucket and will be deleted at day 90. CSAM evidence retention requirements typically demand longer hold (talk to counsel). The rule also kills any moderation-queue item that sat in the bucket past 90 days for less obvious reasons.
- **Fix:** Add `matches_prefix = ["uploads/"]` to scope the 90-day delete to abandoned uploads only. Add a separate, longer-retention rule for `_held/` (or move `_held/` to a separate bucket with its own legal-hold lifecycle).

### H9 — Admin `ban_user` silently overwrites an existing ban
- **Where:** `backend/app/routers/admin.py:206-233`.
- **Evidence:** `db.collection("bans").document(uid).set({...})` with no read-then-write check. Calling `POST /api/admin/users/{uid}/ban` on an already-banned user replaces `expiresAt` and `bannedBy` without surfacing that the user was already banned.
- **Why it matters:** A 24h ban can accidentally shorten an active permanent ban; a permanent ban can be silently extended without an audit-log diff showing the prior state. Audit log records the new ban but not the overwrite.
- **Fix:** Read first, include `previousExpiresAt` and `previousBannedBy` in the audit payload, optionally return `409` if the existing ban is *longer* than the requested one.

### H10 — Production deploy from `workflow_dispatch` has no branch restriction
- **Where:** `.github/workflows/deploy.yml:6-15, 79`.
- **Evidence:** `workflow_dispatch` allows any branch (`ref` parameter is the user's choice). `environment: production` references a GitHub Environment but the repo doesn't ship a setting confirming required reviewers / protected branches.
- **Why it matters:** Any contributor with `write` access can deploy any branch (including a feature/PR branch with arbitrary code) to production by selecting it from the "Run workflow" UI.
- **Fix:** Configure the `production` GitHub Environment with required reviewers and `Deployment branches → Selected branches: main`. Document this in `README.md` so the protection isn't lost on repo migration.

### H11 — No dependency, container, or SAST scanning in CI
- **Where:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`. No `dependabot.yml` either.
- **Evidence:** No `pnpm audit`, no `pip-audit`, no Trivy on the built image, no CodeQL, no Semgrep, no Dependabot config.
- **Why it matters:** A messaging app handling minor users with a CSAM pipeline (T11) without any supply-chain or SAST scanning is hard to defend in a future audit. Recent ecosystem incidents (e.g. 2025 `tj-actions/changed-files` compromise) make tag-pinned actions a real risk.
- **Fix:** Minimum: add `.github/dependabot.yml` covering `pip`, `npm`, `github-actions`, `docker`. Add CodeQL workflow for JS/TS + Python. Add Trivy scan in `deploy.yml` before pushing the backend image, fail on HIGH/CRITICAL.

### H12 — `_unique_invite_code` collision check is racy; client-write of `users.groupIds` is unaudited and self-mutable
- **Where:** `backend/app/routers/groups.py:51-61, 96, 133`.
- **Evidence:** Backend reads `groups where inviteCode == code` then commits a batch — two concurrent requests can both pick the same code. Backend writes `users/{uid}.groupIds` via `ArrayUnion`, and the rules allow the client to write any non-locked field of any value to `users/{uid}` (see H3); a user can self-write `groupIds: ['some-other-gid']` to fake group membership in any UI hook (`useGroups.ts:38-49` reads it directly).
- **Why it matters:** Collision: silent inconsistency / 500 once in a blue moon, low impact. UID self-mutation: every UI that trusts `groupIds` can be fooled — useGroups will then `getDoc(groups/{gid})`, fail the security read because the user isn't actually a member, and either show empty groups (UX), or worse, leak structural info if any UI assumes presence in groupIds implies membership.
- **Fix:** Collisions: use a transaction or write to `groups/{gid}` with a client-provided code in a transaction that aborts on duplicate. `groupIds`: either move to a backend-only `users/{uid}/private/membership.groupIds` doc (lock writes via the rules pinning `private/profile` only — see L5), or compute group membership from `groups/{gid}/members/{uid}` directly via a collection-group read (would require a CG index and a rule change).

---

## Medium

### M1 — Group leaders can self-demote and leave; group can be left with zero leaders
- **Where:** `firestore.rules:118-122`.
- **Evidence:** Leader can `update` any member's `role` (including their own to `member`) and `delete` any member doc (including the only leader's).
- **Why it matters:** Once leaderless, no one can rotate the invite, edit metadata, or moderate. Group is bricked.
- **Fix:** Either require the actor not to be acting on their own member doc when changing role / deleting, or enforce in a Cloud Function (count remaining leaders before allowing). Rules-only enforcement requires denormalizing `leaderCount` onto `groups/{gid}` and rejecting updates that drop it to zero.

### M2 — Banned users cannot leave a group
- **Where:** `firestore.rules:121`.
- **Evidence:** `allow delete: if (isGroupLeader(gid) || isUser(uid)) && notBanned();`
- **Why it matters:** A user who is banned (correctly blocked from posting) is also blocked from removing themselves from groups. Surprising UX; not malicious.
- **Fix:** Drop `notBanned()` from the member self-delete branch.

### M3 — `ban_user` accepts unvalidated `body.reason` (length, content); admin actions are not rate-limited
- **Where:** `backend/app/routers/admin.py:206-233`, `backend/app/models/admin.py:10-12`.
- **Evidence:** `BanRequest.reason: str` — no `Field(max_length=...)`. Admin endpoints have no `@limiter.limit(...)`.
- **Why it matters:** A malicious admin (or a compromised admin account) can write 1MB into `bans/{uid}.reason`, then it shows up in audit_log and any future "ban reason" UI. Lack of rate limit on admin endpoints means a compromised admin can ban every user in N minutes with no friction.
- **Fix:** `Field(min_length=1, max_length=500)`. Add a global "10/min" rate limit on `/api/admin/*` mutations.

### M4 — Cloud Scheduler jobs lack codified IAM / OIDC config; `firestore_export` is non-idempotent on retry
- **Where:** `infra/scheduled/finalize_deletions.py`, `firestore_export.py`. No `google_cloud_scheduler_job` resource in `infra/`.
- **Evidence:** No Terraform resource creates the scheduler job or pins `oidc_token.service_account_email`. `firestore_export` writes to `daily/{YYYY-MM-DD}/`; a Cloud Scheduler retry into the same prefix returns `OUT_DIR_NOT_EMPTY` and stays failed for the day.
- **Why it matters:** A by-hand Cloud Scheduler job is easy to leave unauthenticated and running as the default Compute Engine SA (project-Editor). For `firestore_export` that's the entire DB exposed. Idempotency hole means a transient blip = a missed daily backup.
- **Fix:** Add `google_cloud_scheduler_job` Terraform resources with `oidc_token` pointing at the right service account, plus matching `roles/run.invoker` IAM. Suffix the export prefix with `-HHMMSS` so retries don't collide.

### M5 — Backend Dockerfile not pinned by digest, no HEALTHCHECK; CI actions all pinned by tag
- **Where:** `backend/Dockerfile`, `.github/workflows/*.yml`.
- **Evidence:** `FROM python:3.12-slim` (mutable tag). No `HEALTHCHECK`. Every `uses:` in CI is `@v4` / `@v5` / `@v2` (mutable tag).
- **Why it matters:** Reproducible builds and supply-chain integrity. The 2025 `tj-actions/changed-files` compromise shipped via mutable tag.
- **Fix:** Pin base image by digest. Pin GitHub Actions by SHA and rely on Dependabot to bump.

### M6 — Functions are deployed via `firebase deploy --only functions` which runs `npm install` server-side, ignoring the workspace lockfile
- **Where:** `.github/workflows/deploy.yml:99-105`, `functions/package.json` (caret deps, no lockfile in `functions/`).
- **Evidence:** Workspace lockfile lives at root (`pnpm-lock.yaml`). `firebase deploy` for functions invokes the Firebase CLI's deploy path which `npm install`s from `package.json`. Caret ranges (`^12`, `^6`) mean prod resolves different transitive deps than CI.
- **Why it matters:** "Tested in CI ≠ what runs in prod."
- **Fix:** Either commit `functions/package-lock.json` (npm) or pre-package functions before `firebase deploy` (set `predeploy` to use the workspace lockfile output).

### M7 — Backend docs and runbook drift from deployed reality
- **Where:** `docs/oncall.md:74-76`, `README.md` prerequisites.
- **Evidence:**
  - `oncall.md` says "Cloud Run outage … `gcloud run services update-traffic jacob-api`" — service is named `jacob-backend` per `deploy.yml:63`.
  - `oncall.md` says "Firebase Hosting outage: `firebase hosting:rollback`" — project uses Firebase **App Hosting**, not Hosting; rollback flow is different.
  - `README.md` says pnpm 9.x and Java JDK 17; CI uses pnpm 10 (`ci.yml:17, 33, ...`) and Java 21 (`ci.yml:103-104`).
- **Why it matters:** When you wake up at 3 AM to roll back, every wrong command costs minutes.
- **Fix:** Update the runbook with the real service name and the App Hosting rollback path (`firebase apphosting:rollouts:list / :delete`). Bump README versions.

### M8 — Restore runbook has not been dry-run-tested; timing rows are blank
- **Where:** `docs/runbooks/restore.md:106-114`.
- **Evidence:** "Step | Duration | _____ min" — no actual numbers filled in. T16 spec says the drill is part of acceptance criteria.
- **Why it matters:** A runbook that has never been executed is a runbook that will fail in the incident.
- **Fix:** Run the restore against `jacob-staging-494515` end-to-end. Fill in the table. Commit.

### M9 — Frontend tests over-mock the Firestore SDK; integration confidence is thin
- **Where:** `frontend/tests/setup.ts`, every `*.test.tsx`.
- **Evidence:** Tests `vi.mock("firebase/firestore", ...)` and assert on what the mocked SDK was called with. There is no test that runs against the Firestore emulator the way `firestore/tests/` does.
- **Why it matters:** A test passes when the code "called `addDoc` with the right shape," but a security-rule rejection (permissions, missing field) is invisible. The Firestore rule tests cover the rules side; nothing covers "client code + rules" together.
- **Fix:** Add one or two end-to-end vitest specs that boot the emulator and exercise the real send-message + read-message paths. Existing rules-emulator infra (`firebase emulators:exec`) can host them.

### M10 — Test coverage gaps that matter
- **Where:** `backend/tests/`, `frontend/tests/`, `firestore/tests/`.
- **Evidence:**
  - No backend test asserts that the `@limiter.limit(UPLOAD_INIT)` decorator is *applied* to `create_photo_upload`. The "limit value" tests only check the constant. Removing the decorator would not be caught.
  - No backend test for the moderation fail-open path (C2 above) — would have caught it.
  - No backend test for `ban_user` overwriting an existing ban (H9).
  - No rules tests for: minor users, expired bans, leader self-demotion, last-leader-leaves, message body length cap (none exists), tombstoned-message edits.
  - No tests for `functions/src/onMessageWrite.ts` at all.
  - No frontend test for the auth-state-change → middleware-cookie-set race (`useUser.ts:46-54`).
- **Fix:** One test per gap; the ones to write *first* are the moderation fail-open and the missing function tests.

### M11 — Backend writes `users/{uid}.groupIds` from the client SDK gap (rules don't lock it); see H12 for the security side
- **Where:** `frontend/lib/hooks/useGroups.ts:38-49`, `backend/app/routers/groups.py:96, 133`, `firestore.rules:68-70`.
- **Evidence:** Backend writes `groupIds` via `ArrayUnion`. Rules allow the client to write to `users/{uid}` for any field other than the explicitly locked ones. `groupIds` is not in the lock list and is not in the canonical `users/{uid}` schema documented in `CLAUDE.md` or `docs/data-model.md`.
- **Why it matters:** Schema drift between docs and reality. UI hooks now trust a field the client itself can write. See H12 for the fix.

### M12 — `useRecentMessages` does N independent reads per group every mount; no caching
- **Where:** `frontend/lib/hooks/useRecentMessages.ts:42-83`.
- **Evidence:** `Promise.all(groups.map(g => getDocs(...)))` — N round-trips on every group-list change, with `groupKey` dependency that re-fires whenever the array order or contents shift.
- **Why it matters:** A user in 12 groups pays 12 round-trips on home-page mount. No `onSnapshot` here so every navigate-back re-fetches.
- **Fix:** Either cache via SWR/React Query, or merge into a smaller number of queries (collection-group on `messages` with `where("authorUid", "in", [...])` if the rule supports it — currently it does not because there's no CG read rule).

### M13 — `Sentry.init` `tracesSampleRate: 0.1` hardcoded on the frontend; backend uses a setting; same setting exists in the env example but the frontend ignores it
- **Where:** `frontend/lib/sentry.ts:54`, `backend/app/services/sentry.py:55-57`, `backend/.env.example:27`.
- **Evidence:** `tracesSampleRate: 0.1` is a magic number. The backend reads a setting; the frontend doesn't.
- **Why it matters:** Cost control during a traffic burst is harder to dial down quickly without a redeploy.
- **Fix:** Read `process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` with a default; document in `.env.example` for the frontend (no example exists today — see M14).

### M14 — `frontend/.env.example` does not exist
- **Where:** `frontend/`.
- **Evidence:** `find frontend -name ".env.example"` returns nothing. The CLAUDE.md "Definition of done" requires a per-service `.env.example`.
- **Why it matters:** New contributors do not know which `NEXT_PUBLIC_*` vars are required (`NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SENTRY_*`, `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`).
- **Fix:** Add `frontend/.env.example` with every var the code references.

---

## Low / nits

### L1 — Authenticated rate limits key off `request.state.uid`, but `uid` is set inside `get_current_user` which runs as a dependency *after* the limiter on some routes
- **Where:** `backend/app/middleware/rate_limit.py:14-19`, decorated routes in `routers/uploads.py:75`, `routers/groups.py:141`, `routers/reports.py:33`.
- **Evidence:** slowapi uses the key returned by `_key_by_uid_or_ip(request)` per request. The current decorator runs the limit predicate before FastAPI dispatches to the function body where the dependency resolves — but `get_current_user` is a dependency, not body code, and FastAPI resolves dependencies before calling the route. Quick check: in practice this works because the middleware sequence sets `request.state.uid` from a previous request? No — it's set by `get_current_user`. Worth a real test that confirms post-auth UID is the limit key (existing `test_rate_limits.py` uses `get_remote_address` for the isolated app, not the production limiter).
- **Why it matters:** If the limiter ever falls back to client IP for authenticated requests (e.g. behind a proxy that hides the IP), you get a project-wide single-IP limit shared across all users.
- **Fix:** Add a test that two authenticated users with different UIDs each get their own bucket on the production limiter, and that the production limiter does not collapse to a single IP-based bucket when run behind `TestClient` (which does not set X-Forwarded-For).

### L2 — `fieldsLocked` helper is dead code
- **Where:** `firestore.rules:44-46`.
- **Evidence:** Defined but never invoked. Only `onlyChanges` is used.
- **Fix:** Delete or use it on the `users/{uid}` update predicate to be explicit about locked fields.

### L3 — `users/{uid}/private/{docId}` allows any subdoc id
- **Where:** `firestore.rules:76-79`, `docs/data-model.md` lists only `private/profile`.
- **Fix:** `match /users/{uid}/private/profile` (or `match /users/{uid}/private/{docId} { ... if docId == 'profile' }`).

### L4 — `default deny` `match /{document=**}` is harmless but is not a substitute for explicit positive rules
- **Where:** `firestore.rules:179-181`.
- **Fix:** Keep, document that any silently-denied path is a possible bug rather than a security guarantee.

### L5 — Backend `_finalize_at` tolerates a race where finalize is invoked exactly at the boundary
- **Where:** `backend/app/services/deletion.py:114-118`, `infra/scheduled/finalize_deletions.py`.
- **Evidence:** `cancel_deletion` returns False if `now > finalize_at`; the daily job uses `<= cutoff`. A user whose grace expires between cancel and finalize loses the cancel race.
- **Fix:** Use the same comparator on both sides; document the half-open interval.

### L6 — `infra/uptime-checks.tf` doesn't validate response content
- **Where:** `infra/uptime-checks.tf:80-122`.
- **Evidence:** No `content_matchers`. A misconfigured app returning a 200 "Welcome to nginx" still counts as "healthy."
- **Fix:** Add `content_matchers { content = "ok" matcher = "CONTAINS_STRING" }` against `/health` (returns `{"status": "ok"}`).

### L7 — No Terraform remote state / lockfile / provider pins
- **Where:** `infra/` (no `backend.tf`, `versions.tf`, `.terraform.lock.hcl`).
- **Fix:** Add `backend "gcs"` with bucket+prefix, commit `versions.tf` pinning `google` and `google-beta`, commit lockfile.

### L8 — `firebase.json` has no Storage rules block (Firebase Storage rules are not used; uploads go through the backend → GCS pipeline). Worth a one-line comment in `firebase.json` so future contributors don't add a `storage.rules` file thinking it controls the public/quarantine buckets (it would not — those are Cloud Storage buckets, not Firebase Storage).
- **Fix:** Add an `// uploads use Cloud Storage directly via signed URLs; see infra/buckets.tf` doc comment in the README.

### L9 — `MessageItem.tsx` renders user-supplied `mediaRefs` URLs into `<img src>` without any URL allowlist
- **Where:** `frontend/components/chat/MessageItem.tsx:151`.
- **Evidence:** `<img src={url} alt="" />` where `url` comes from `message.mediaRefs` (Firestore field; no rule shape check, see H3).
- **Why it matters:** Today only the moderation pipeline produces `https://storage.googleapis.com/jacob-media-public-*/...` URLs, but rules don't enforce that. A leader (per H3) or an attacker who exploits a future bug could write `data:` or `javascript:` (browsers ignore the latter on `src` but `data:image/svg+xml` can carry XSS) URIs.
- **Fix:** Either harden the rule to require `mediaRefs[i].startswith('https://storage.googleapis.com/jacob-media-public-')`, or sanitise client-side before rendering.

### L10 — Sentry server-side `before_send` typing leans on `cast(dict, event)` which silences the `TypedDict` guard
- **Where:** `backend/app/services/sentry.py:27-44`.
- **Fix:** Use the `Event` `TypedDict` keys directly; `cast(dict, ...)` defeats mypy's protection if the SDK schema changes.

### L11 — `useUser.ts` writes a cookie from a snapshot listener; SSR hydration mismatch risk
- **Where:** `frontend/lib/hooks/useUser.ts:46-54`.
- **Evidence:** `document.cookie = "jacob-has-profile=1"` set inside `onSnapshot`. The middleware reads the cookie to redirect. Race: first SSR pass has no cookie, redirect fires, then the cookie lands milliseconds later.
- **Fix:** Either move cookie-setting to a server-side route (e.g. a small `/api/session` route that the AuthProvider hits with the ID token), or accept the redirect race and document it.

---

## Phase-2 blockers vs. trackable

**Must land before opening to real users (Phase 2 prerequisite):**

- C1 — author identity in chat
- C2 — CSAM fail-closed
- C3 — frontend Sentry init
- C4 — real Google Form
- C5 — Workload Identity Federation for deploys
- H1 — Cloud Function idempotency (counter drift in prod is silent and unrecoverable without backfill)
- H2 — group create/join rate limits
- H3 — Firestore rules schema validation pass
- H4 — `deletedAt` pinning
- H5 — public bucket listability
- H6 — admin search prefix bug
- H7 — admin browse `createdAt DESC` indexes
- H8 — quarantine lifecycle prefix
- H10 — production deploy branch restriction
- M8 — restore drill
- M14 — `frontend/.env.example`

**Trackable as Phase 2 tasks (don't block, but should be on the board):**

- H9 — ban-overwrite audit nuance
- H11 — dependency / SAST scanning
- H12 — `groupIds` on user doc cleanup (refactor to a backend-only doc or to CG queries)
- M1, M2, M3, M4, M5, M6, M7, M9, M10, M11, M12, M13
- All Low items

**Severity totals:** Critical 5 · High 12 · Medium 14 · Low 11 = **42 findings**.

---

## Files reviewed

Backend: `backend/app/main.py`, `app/deps.py`, `app/errors.py`, `app/limits.py`, `app/middleware/{logging,rate_limit}.py`, `app/routers/{account,admin,groups,reports,uploads,debug}.py`, `app/services/{audit,deletion,firebase,moderation,sentry,storage}.py`, `app/models/*`, `app/config.py`, `Dockerfile`, `pyproject.toml`, `.env.example`, `scripts/grant_admin.py`, `tests/*`.

Frontend: `frontend/app/layout.tsx`, `app/(authed)/layout.tsx`, `app/admin/{layout,queue/page}.tsx`, `lib/{auth-context,firebase,sentry,report-url}.ts(x)`, `lib/hooks/{useUser,useGroups,useGroupMessages,useRecentMessages,useUploadPhoto}.ts`, `components/auth/SignInForm.tsx`, `components/chat/{MessageInput,MessageItem}.tsx`, `components/onboarding/PhotoUpload.tsx`, `components/moderation/ReportLink.tsx`, `middleware.ts`.

Firestore: `firestore.rules`, `firestore.indexes.json`, all seven `firestore/tests/*.rules.test.ts`.

Functions: `functions/src/{index,onMessageWrite}.ts`, `package.json`.

Infra: `infra/buckets.tf`, `infra/uptime-checks.tf`, `infra/scheduled/{finalize_deletions,firestore_export}.py`.

CI/CD: `.github/workflows/{ci,deploy}.yml`, `firebase.json`, `.firebaserc`, `frontend/apphosting.yaml`.

Docs: `README.md`, `CLAUDE.md`, `docs/{oncall,gdpr,moderation-pipeline,moderation-runbook,data-model}.md`, `docs/adr/0001-rate-limit-strategy.md`, `docs/runbooks/restore.md`.
