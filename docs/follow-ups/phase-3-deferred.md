# Phase 3 — Deferred findings

Items from the May 2026 Phase 3 codebase review (the C-/H-/M-/L- cluster
PRs landed in PRs #200–#207) that were too large for their cluster PR
or are blocked on something outside the repo. Each entry records what
work is needed so these can be picked up as discrete follow-ups.

For items deferred for **product or cost** reasons (rather than scope),
see `phase-3-parked.md`.

---

## H1 (partial) — Branch protection on `main` is not enabled

**Where:** GitHub repo settings, not the codebase.
**Status:** `.github/CODEOWNERS` landed in #185; branch protection
itself did not. The CODEOWNERS file is therefore informational only
until protection is enabled.

**What is required:**
Enable branch protection on `main` with:
- Require a pull request before merging.
- Require **1 approval** from someone other than the author.
- Require review from **Code Owners** (this is what makes
  `.github/CODEOWNERS` load-bearing).
- Require status checks to pass (`ci`).

Either grant the existing JACOB PAT the `Administration: Read and
write` permission and re-run the `gh api -X PUT
/repos/critterwilson/jacob/branches/main/protection ...` call, or
configure the rule directly in GitHub's web UI (Settings → Branches →
Add rule for `main`).

**Complexity:** Trivial — one config change, no code.

---

## C1 follow-up — Reaction-doc cleanup on account deletion

**Where:** `backend/app/services/deletion.py:_delete_reactions_by_user`
is still a no-op that returns 0 (PR #199 closed every other uid-bound
surface but explicitly skipped this one).

**Why deferred:** Reaction docs live at
`groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`. The leaf
collection name `users` collides with the top-level `users`
collection at the collection-group level, and the Python Admin SDK
does not expose a clean by-document-id filter for collection-group
queries.

**What is required (two viable fixes):**

1. Denormalise a `userUid` field onto every reaction doc and CG-query
   by that field on delete. Update the reaction toggle endpoint
   (`POST /api/groups/{gid}/messages/{mid}/reactions/{slug}` in
   `backend/app/routers/messages.py`) to write the field; backfill
   via a one-shot script.
2. Maintain a `users/{uid}/reactions/{gid}_{mid}_{slug}` index doc on
   every reaction write. One extra Firestore write per reaction;
   cheap delete on account finalize.

**Impact today:** stale reaction docs contain only `reactedAt` (no
PII beyond a timestamp). The `reactionCounts` map on the parent
message stays slightly inflated until a re-index. Cosmetic UI
inconsistency only — no GDPR violation.

**Complexity:** Low (option 2) / Low-medium (option 1 + backfill).

---

## C1 follow-up — End-to-end emulator deletion test

**Where:** No `test_emulator_smoke.py` integration test for
account-finalize end-to-end.

**Why deferred:** The unit test added in #199
(`test_finalize_calls_every_cleanup_helper`) pins the **structure**
of the fanout (every helper invoked exactly once with the right
return shape). It does not pin the **semantics** end-to-end. The
emulator harness (`@pytest.mark.emulator`) only landed in #198, after
#199 was already in flight.

**What is required:**
Add a `test_emulator_finalize_smoke` test under
`backend/tests/test_emulator_smoke.py` that:
1. Seeds a fake user with rows in every uid-bound surface
   (notifications, devices, mutes, blocks, exports, plan_progress,
   notificationPrefs, group/org memberships, board posts/replies,
   RSVPs, reports).
2. Calls `finalize_account(uid, keepBody=False)`.
3. Asserts that every collection-group query for the uid returns
   empty.

**Complexity:** Low — harness exists, just needs the seed + assert.

---

## M9 follow-up — Missing user-initiated lifecycle endpoints

**Where:** No backend routes exist for any of these:
- `POST /api/groups/{gid}/leave` — user-initiated group leave.
- `POST /api/groups/{gid}/members/{uid}/kick` — leader-initiated
  member removal (currently the only path is admin SDK).
- `POST /api/orgs/{orgId}/leave` — user-initiated org leave (org
  members are derived from group memberships via `onMemberWrite`
  mirror; there is no direct user-initiated org-leave).
- `DELETE /api/orgs/{orgId}` — org delete cascade.

**Why deferred:** The M9 spec asked for tests covering these flows;
the audit in #196 confirmed the endpoints don't exist. These are real
product gaps, not test gaps — implementing them is a feature task,
not a cleanup.

**What is required:**
File on `DEV_PLAN.md` backlog as a Phase 3.5 / Phase 4 task. Each
endpoint needs:
- The route + auth dep (`require_member` for self-leave;
  `require_leader` for kick; `require_org_admin` for org delete).
- A leaderless-group / lastadmin-org guard (mirrors
  `routers/groups.py:303-315` transactional pattern).
- An audit-log row.
- 403-when-banned coverage (lint at
  `backend/scripts/lint_writes_have_not_banned.py` enforces it).
- Destructive-path tests (the M9 ask).

**Complexity:** Medium — four new endpoints with shared safety
guards.

---

## M9 follow-up — Cloud Function trigger entry-point tests

**Where:** `functions/src/onBoardPostCreate.ts`,
`onBoardReplyWrite.ts`, `onBoardReactionWrite.ts` trigger entry
points have no direct tests. Their **helpers** are well-covered
(`runTextModeration`, `fanOutMentions`, `classifyPostChange`,
`reactionDelta`, `runReactionTxn`), but the trigger orchestration
itself can only be exercised against the Firestore emulator.

**Why deferred:** Unblocked by #198 (`@pytest.mark.emulator` harness +
CI job). Add the trigger tests now that the harness exists.

**Complexity:** Low — pattern exists, harness exists, tests need
seeding + invoke + assert.

---

## DEV_PLAN.md (Phase 1 specs) is stale post-M6

**Where:** `DEV_PLAN.md` task specs T07, T08, T09, T10, T14, etc.
still describe direct Firestore client SDK writes and `onSnapshot`
realtime. M1–M6 (PRs #115–#135) rewired all of these through
`/api/*` and replaced realtime with HTTP polling.

**Status:** This PR adds a top-of-file "Status" banner pointing
readers at `docs/data-layer-migration-plan.md` for the current
boundary. A line-by-line rewrite of every task is **not** in scope
— these specs are useful as historical context (how the surface
was originally designed) and do not block any current work. Rewrite
opportunistically when a related task is touched.

**What is required (if a full sweep is desired):**
- For each Phase 1 task spec, replace direct-Firestore-write
  language with the corresponding `/api/*` endpoint shape.
- Replace `onSnapshot` references with `apiGetConditional` /
  `useGroupMessages`-style polling.
- Remove client-side rule explanations (rules are default-deny;
  the access-control surface is now `require_member` /
  `require_leader` server-side).

**Complexity:** Medium-high (touches 19 task specs). Low value vs.
opportunistic touch-ups.

---

## ADR sweep for pre-M6 staleness — CLOSED in docs/full-cleanup-sweep

**Where:** `docs/adr/0001-rate-limit-strategy.md` and possibly
0003/0004 reference client-side Firestore rule paths or direct
client writes that no longer apply post-M6.

**Status:** ADR 0001 received a Superseded-by note in PR #216.
ADR 0003 received an "Implementation note" block (client-side CG
query moved server-side with M6) and ADR 0004 received a note that
the `inviteCode` field migration was never fully completed. Both
audited in the `docs/full-cleanup-sweep` PR.

---

## `.env.example` ↔ README sync check

**Where:** No CI check enforces that every key in each service's
`.env.example` is documented in the corresponding service `README.md`
(and vice versa). CLAUDE.md previously claimed such a check existed;
PR #201 corrected that.

**What is required:**
Add a small script (Python or Node) that diffs the keys in each
service's `.env.example` against a list extracted from its
`README.md`. Run it from `.github/workflows/ci.yml` per service
(`backend/`, `frontend/`, `functions/`, `infra/scheduled/`). Fail
the build on divergence with a message that names the missing key.

**Complexity:** Low — single-file tool plus three CI invocations.

---

## L9 — Sentry does not capture server-side (SSR) exceptions

**Where:** `frontend/components/SentryInit.tsx` —
`initSentry()` only runs inside `useEffect`, so server-render
errors are never captured.

**Status:** Originally listed in
`phase-2-deferred.md` and re-mapped onto T59 (on-call) for
absorption per `docs/phase-3-impl-spec.md` §3. T59 shipped in
#153 but did not include the `instrumentation.ts` change. Still
open.

**What is required:** Add `instrumentation.ts` (Next.js 14 App
Router) following `@sentry/nextjs` guidance to initialise Sentry
for the Node.js runtime. Verify a server component `throw` is
captured in Sentry dev mode.

**Complexity:** Low — one new file, one config block.

---

## L14 — `_held/` quarantine GCS prefix has no terminal Delete lifecycle

**Where:** `infra/buckets.tf` — only a `SetStorageClass`-to-COLDLINE
rule at age 365 days; no Delete rule.

**Status:** Originally listed in `phase-2-deferred.md` and re-mapped
onto T63 (NCMEC retention work) for absorption per
`docs/phase-3-impl-spec.md` §3. T63 shipped in #163 but did not
add the lifecycle rule. Still open.

**What is required:** Add a Delete lifecycle rule at age 2,557 days
(≈7 years) and document the retention policy in the moderation
runbook. Requires legal/counsel sign-off per existing comment in
`buckets.tf` — file a ticket before implementing.

**Complexity:** Low (config) + external (legal sign-off).

---

## `leaderUids` backfill — operator task, no longer urgent

**Where:** `infra/scripts/backfill_group_leaders.py` (H5 follow-up). The
script reconciles `groups/{gid}.leaderUids` from the `members`
subcollection so the discover endpoint stops falling back to the
per-group N+1 scan for pre-`onMemberWrite` groups. Running it requires
`firebase-admin` installed locally and a service-account credential.

**Status:** Parked as an operator task. PR #233 (deletion-cascade —
H3) made the founder-fallback in `finalize_account` resilient to a
stale or missing `leaderUids` denorm: the founder-handoff path reads
the `members` subcollection directly when the array is empty, so a
stale denorm no longer blocks account deletion. The backfill is still
worth running once for the discover-endpoint perf win, but it is no
longer urgent.

**Complexity:** Trivial — one script, one credential.

---

## data-model.md — expand document-shape sections for Phase 2/3 collections

PR #241 added ~30 missing entries to the collection map but did not add the
corresponding document-shape sections (field list + example JSON) for the new
entries. The existing sections cover Phase 1 collections well; Phase 2/3
collections (devices, notifications, notificationPrefs, exports, plan_progress,
invites, events, rsvps, joinRequests, sermons, daily_verse, devotionals,
reading_plans, active_incidents, appeals, ncmec_cases, transparency_reports,
uploads, watch_sessions, domain_claims) still lack documented shapes.

**Complexity:** Low-medium — read each router for the field names, copy example
payloads from the existing section style.

---

## M4 — `announce_message` fan-out blocks the request thread

**Where:** `backend/app/routers/groups.py` — `announce_message`
endpoint runs `members.stream()` + `bulk_write_notifications`
synchronously on the request, risking Cloud Run timeout for
groups with 1000+ members.

**Status:** Phase 3 spec §3 said to land this as a small prep PR
before T49. T49 (scheduled events) shipped in #157 with its own
fan-out trigger pattern (`onEventReminderWrite.ts`-style) but did
not back-port the same shape onto the `announce_message` path.

**What is required:** Move fan-out to a Cloud Function trigger on
`messages.announcedAt` field write. The endpoint sets
`announcedAt = SERVER_TIMESTAMP` and returns immediately; the
trigger fans out notifications and writes the audit row. New
trigger file (`functions/src/onAnnouncementWrite.ts`), new
Firestore field, updated rules + emulator test.

**Complexity:** Medium — architectural pattern matches T49, so the
shape is known.
