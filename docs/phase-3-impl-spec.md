# JACOB — Phase 3 implementation spec (T40–T65)

> Working specification for the **platform** phase of JACOB. T19–T39 have
> shipped; the C1–C5 / H1–H15 / M1–M17 / L1–L17 review fixes from
> `docs/reviews/codebase-review-phase-2-2026-05.md` have been merged.
> This document resolves ambiguity in `docs/phase-3-dev-plan.md` and
> pre-decides architectural choices so a Sonnet session can read one
> task section and start coding without a planning round-trip.
>
> **Authoritative sources, in priority order:** (1) `CLAUDE.md` for
> project conventions, (2) `firestore/firestore.rules` for who-can-do-
> what, (3) this document for per-task scope, (4)
> `docs/phase-3-dev-plan.md` for the originating goal statement,
> (5) `docs/phase-2-impl-spec.md` for patterns Phase 3 inherits.
>
> If something here disagrees with `CLAUDE.md`, `CLAUDE.md` wins and
> this file is wrong — open a PR to fix it.

---

## 0. How to read this document

### 0.1 Scope

Phase 3 is the *platform* phase. The 26 tasks (T40–T65) cluster into
seven themes; reviewers should hold the cluster in mind because tasks
within a cluster share data shapes and rule edits:

| Theme                 | Tasks                       | Headline shift                                                |
|-----------------------|-----------------------------|---------------------------------------------------------------|
| Native mobile         | T40, T41                    | A second client surface; `mobile/` workspace; APNs/FCM unification. |
| Identity              | T42                         | Passkeys / Apple / magic links — three new sign-in paths.     |
| AI                    | T43, T44, T45, T46, T47     | Always leader-or-operator-gated; Anthropic Claude + Vertex embeddings; never auto-publish. |
| Live & realtime       | T48, T49, T50, T57          | Realtime DB enters the stack; LiveKit for voice.              |
| Christian content     | T51, T52, T53               | New top-level `devotionals` / `reading_plans` / `sermons`; markdown + unfurls. |
| Multi-tenancy         | T54, T55, T56               | New top-level `orgs/{orgId}` resource; `groups/{gid}.orgId` nullable; custom domains. |
| Reliability + T&S     | T58, T59, T60, T61, T62, T63, T64, T65 | Feature flags, on-call, dashboards, i18n, a11y, NCMEC, appeals, transparency. |

Phase 3 does **not** ship paid tiers, public APIs, federated moderation,
self-hosted video, translation memory, cross-group DMs, E2EE,
multi-region, on-chain anything, predictive per-member analytics, or
auto-published AI text. Each task spec restates its own non-goals;
when a Sonnet plan begins reaching outside, stop the session.

### 0.2 Per-task structure

Every task section follows the same template:

1. **Goal** — 1–2 sentences, the *why*.
2. **Acceptance criteria** — refined from the plan.
3. **Files to create / modify** — line-anchored hints when non-obvious.
4. **Data model changes** — new docs, fields, type shapes,
   back-fill plan.
5. **Firestore rule deltas** — concrete predicate snippets.
6. **Backend interface** — endpoints with method, path, pydantic
   shape, rate-limit decorator, audit-log entries.
7. **Frontend interface** — components, hooks, routes, ownership.
8. **Cloud Functions** — triggers, idempotency, retry/error policy.
9. **Test plan** — specific test names + assertions.
10. **Edge cases / gotchas** — pre-decided traps.
11. **Migration / rollout** — flags, back-fills, env vars.
12. **Dependencies** — upstream tasks, including cross-phase.
13. **Estimated complexity** — matches the plan's sizing.
14. *(Opus-flagged tasks only)* **Why Opus** — judgment calls / novel
    patterns / safety-sensitive logic that justifies the model choice.

### 0.3 How to start a Sonnet session against a task here

```
Implement task T<NN> from docs/phase-3-impl-spec.md. Read the task
section fully, then propose a 5-bullet plan before writing code. Stop
and ask if any acceptance criterion is ambiguous, any pre-decision in
the spec disagrees with the existing codebase, or the plan needs to
touch anything outside the listed files.
```

Then approve, let Sonnet implement, and review against acceptance
criteria. The "Edge cases / gotchas" subsection is the single most
useful review checklist — every bullet there is a known foot-gun.

For Opus-flagged tasks (T43, T44, T46, T47, T54, T55, T57, T63, T64),
read the **Why Opus** subsection first and do not let Sonnet take the
session.

### 0.4 Pre-decided defaults (apply unless the task says otherwise)

These are decided once here so each task spec doesn't repeat them.
Phase 3 inherits Phase 2's defaults verbatim and adds a few:

- **Real-time vs polling:** `onSnapshot` for collections under active
  view (chat, presence, typing, voice participants, watch-together
  state); a one-shot fetch for everything else (settings, analytics,
  admin queues older than the visible page, transparency-report list).
  Listeners are torn down on unmount.
- **Validation:** **Both ends.** Zod on the frontend (mirrors the
  Pydantic v2 shape one-to-one — copy field constraints by hand),
  Pydantic on the backend, Firestore rules pin types/lengths
  separately. The rules are the load-bearing layer; the others are UX.
- **SSR vs CSR:** Anything reading Firestore in real time is a
  `"use client"` component. Pages that render purely from props or
  static content stay server components. Settings, member list,
  chat, queue, analytics, search results, presence, voice room,
  watch-together, devotionals reader, sermon list, appeal page —
  **all client**. Public marketing pages, transparency report,
  org landing pages — server.
- **Indexes:** Add new composite indexes to
  `firestore/firestore.indexes.json`, not the console. Each task spec
  enumerates the new entries. **Phase 2 review C2 surfaced five
  missing indexes — Phase 3 tasks must commit indexes alongside
  code.** A Sonnet plan that introduces a new compound query without
  adding an index entry is wrong; reject it.
- **Transactions vs batched writes:** Use a transaction whenever a
  read participates in the write decision (counter increment with cap,
  atomic cluster assignment, voice-token issuance with cap, appeal
  decision with reversal, NCMEC case state machine). Use a batched
  write for two-or-more writes that are conceptually one operation
  but don't read the data they modify. When in doubt, transaction.
- **Realtime Database vs Firestore:** Phase 3 introduces RTDB for
  presence (T48), watch-together sync (T50), and (optionally) voice
  participant lists (T57). RTDB is for *ephemeral* state with
  millisecond updates and `onDisconnect` cleanup. **Anything that
  needs to be queried later or audited goes in Firestore.** Voice
  *session metadata* (start/end/attendees) is Firestore; *live
  participant list* is RTDB. Watch *session metadata* (videoId,
  attendees, duration) is Firestore; *play/pause/position* is RTDB.
  Document the split in each task spec.
- **Audit log:** Every mutating admin/leader action goes through
  `app/services/audit.py:write_audit_log(actor_uid, action, target_ref, payload)`.
  Don't write audit rows directly. The `action` string is
  snake_case, namespaced when useful (`org_create`, `flag_update`,
  `voice_kick`, `event_create`, `ncmec_submit`, `appeal_decide`).
- **Logging:** Every backend log line includes `request_id` (set by
  `StructuredLoggingMiddleware`); functions logs include `eventId`
  and the relevant doc path params. Never log message bodies, ID
  tokens, full image bytes, voice/audio payloads, embedding vectors,
  or LLM prompt contents containing user data (log shape, length,
  category — never the body).
- **Errors:** `APIError(status_code, code, message, details)` from
  `app/errors.py`. The `code` is a snake_case string constant the
  frontend can switch on. New Phase 3 codes (introduce in the task
  that needs them; share where reused): `flag_disabled`, `room_full`,
  `voice_quota_exceeded`, `embedding_quota_exceeded`,
  `llm_quota_exceeded`, `summary_quota_exceeded`, `domain_taken`,
  `domain_unverified`, `domain_reserved`, `org_not_found`,
  `not_org_admin`, `consent_required`, `appeal_already_decided`,
  `appeal_self_review`, `appeal_expired`, `ncmec_already_submitted`,
  `ncmec_unreachable`, `event_window_closed`, `not_in_room`,
  `unsupported_provider`, `passkey_invalid`, `passkey_already_registered`.
- **Soft delete vs hard delete:** Always soft-delete user content
  (`deletedAt = serverTimestamp()`). Hard-delete only structural
  records (challenges, voice sessions after ended, watch sessions
  after ended, RTDB ephemeral nodes via `onDisconnect`).
- **Time:** Server timestamps. Comparisons against "now" use
  `datetime.now(UTC)` in Python, `Timestamp.now()` in TypeScript;
  rule predicates use `request.time`.
- **Rate-limit keys:** Every authenticated mutating endpoint needs an
  `@limiter.limit(...)` decorator. New Phase 3 surfaces add constants
  to `backend/app/limits.py`. New limits introduced by Phase 3:
  - `MOBILE_DEVICE_REGISTER: "20/hour"` (T41 — token refresh per device)
  - `PASSKEY_REGISTER: "5/hour"` (T42 — abuse cap)
  - `PASSKEY_SIGN_IN: "30/minute"` (T42 — paired with Firebase ID-token throttling)
  - `MAGIC_LINK_REQUEST: "5/hour"` (T42)
  - `ADMIN_LLM_POLICY: "10/minute"` (T43 — admin-only)
  - `THREAD_SUMMARY_DRAFT: "5/hour"` (T44 — leader-only; per the plan)
  - `EMBEDDINGS_REINDEX: "2/day"` (T45 — admin)
  - `SEARCH_QUERY_SEMANTIC: "20/minute"` (T46)
  - `EVENT_RSVP: "60/hour"` (T49)
  - `EVENT_CREATE: "20/hour"` (T49)
  - `WATCH_SESSION_START: "10/hour"` (T50)
  - `UNFURL_FETCH: "30/minute"` (T53 — backend service-side)
  - `ORG_CREATE: "5/day"` (T54 — platform-admin only; tighter than groups)
  - `ORG_ADMIN_MUTATION: "20/minute"` (T54)
  - `DOMAIN_VERIFY: "10/hour"` (T55)
  - `VOICE_TOKEN: "20/minute"` (T57 — per user)
  - `VOICE_START: "10/hour"` (T57)
  - `FLAG_MUTATION: "30/minute"` (T58 — platform-admin only)
  - `APPEAL_SUBMIT: "3/day"` (T64)
  - `NCMEC_SUBMIT: "10/hour"` (T63)
  - `TRANSPARENCY_PUBLISH: "5/day"` (T65)

### 0.5 Cross-task dependencies surfaced here

| Task | Depends on (Phase 1/2) | Depends on (Phase 3) | Note |
|------|------------------------|-----------------------|------|
| T40  | T04, T08, T09, T36     | —                     | Mobile shell — must NOT regress web; feature flag `mobile_native_enabled` (T58 if available, else env var). |
| T41  | T34                    | T40                   | Extends `users/{uid}/devices/{deviceId}` schema; reuses notification fan-out. |
| T42  | T04                    | —                     | New auth methods all return Firebase ID tokens; `get_current_user` unchanged. |
| T43  | T20, T39               | —                     | Extends `onMessageCreate` text-mod; **never auto-hides**. |
| T44  | T09, T22               | —                     | Leader-canonical override pattern (P10). Phase 3 baseline AI pattern. |
| T45  | T20, T28               | —                     | Embedding pipeline; T46 + T47 consume vectors. |
| T46  | T28                    | T45                   | Same Typesense, new vector field; permission boundary re-verified. |
| T47  | T06, T08, T35          | T45, T54              | Cross-group within-org clustering; opt-in stance. |
| T48  | T07, T08               | —                     | Introduces RTDB; presence + typing only. |
| T49  | T07, T22               | T34/T41               | Calendar events; reminders use notification fan-out. |
| T50  | T07                    | T48                   | RTDB sync; relies on RTDB rules already established by T48. |
| T51  | T33                    | T53                   | Devotional body uses Phase-3 markdown subset (T53); back-compat: plain text still renders. |
| T52  | T07, T22               | T50                   | Sermon → Watch Together launch button. |
| T53  | T08, T20, T28          | —                     | Markdown messages + unfurls; SSRF guard pattern (P11). |
| T54  | T07, T22, T29          | —                     | Org model; touches every existing rule (P12). |
| T55  | —                      | T54                   | Custom domains; cookie scope decisions. |
| T56  | T06, T30               | T54                   | BJJ vertical rides on org audience switch. |
| T57  | T07, T22               | T34/T41, T58          | Voice rooms; LiveKit; abuse mitigations gated by feature flag. |
| T58  | T13, T15               | —                     | Feature flags; required by T40, T57, several others (P13). |
| T59  | T15                    | T58                   | On-call rotation + status page; incident banner uses flags. |
| T60  | T22, T29               | T54                   | Per-org dashboards; aggregates over groups. |
| T61  | T11                    | —                     | i18n foundation; no per-language LLM yet. |
| T62  | T08, T26, T36          | T48                   | A11y deepens chat + reactions + offline + presence/typing reduced-motion. |
| T63  | T10, T13               | —                     | NCMEC reporting; legal compliance — operator-gated only. |
| T64  | T13, T14, T18, T19     | —                     | Appeals; "different admin" rule. |
| T65  | T13, T29, T38          | T54, T63, T64         | Transparency report; aggregates over the whole moderation surface. |

### 0.6 Definition-of-done reminder

Every task's PR is "done" only when all of the following pass:

1. Acceptance criteria checked off in PR body.
2. `pnpm --filter jacob-frontend lint && pnpm --filter jacob-frontend type-check && pnpm --filter jacob-frontend test`
3. `cd backend && uv run ruff check . && uv run mypy app && uv run pytest`
4. `firebase emulators:exec --only firestore "pnpm --filter jacob-firestore test"`
5. `cd functions && npm test && npm run build && npm run lint` (when functions changed)
6. *(Phase 3 addition)* `firebase emulators:exec --only firestore,database "pnpm --filter jacob-firestore test"` when RTDB rules change (T48, T50, T57).
7. *(Phase 3 addition)* `cd mobile && pnpm test && pnpm tsc --noEmit && pnpm lint` when `mobile/` changed.
8. `firestore.rules` and `firestore.indexes.json` updated together when the data model changes.
9. New env vars added to **both** the service `.env.example` and the service `README.md`.
10. PR description has a screenshot, curl trace, or recorded video for every user-visible change.
11. *(Phase 3 addition)* For every new feature flag introduced by the task, the flag key, default, and rollout plan are documented in the PR body.
12. *(Phase 3 addition)* For every paid external API call introduced (LLMs, embeddings, LiveKit, NCMEC), the daily cap, kill-switch env var, and prompt-cache strategy (where applicable) are documented in the runbook.

---

## 1. Glossary of repeated patterns

Phase 3 inherits Phase 2's P1–P9 verbatim — **read
`docs/phase-2-impl-spec.md` §0.4 first.** P10–P19 below extend the
library with patterns specific to Phase 3.

A short reminder of the Phase 2 patterns, named here so cross-references
in task sections resolve:

- **P1** *audit-log-write* — every admin/leader mutation ends with
  `write_audit_log(actor_uid, action, target_ref, payload)`.
- **P2** *leader-or-admin gate* — backend endpoints that accept the
  platform admin claim or a leader role on the target group.
- **P3** *idempotent Cloud Function trigger* — `_events/{eventId}`
  marker doc inside a transaction; pure helper for the change
  classification; lazy client init; explicit `throw` on failure.
- **P4** *paginated leader/admin list* — cursor-based; `limit + 1`
  fetch; `nextCursor = page[-1].id`.
- **P5** *moderated upload pipeline reuse* — extend `purpose` literal
  on `POST /api/uploads/photos`; never introduce a parallel upload.
- **P6** *zod-mirror-pydantic* — frontend zod schemas mirror backend
  pydantic models field-for-field, camelCase on both sides.
- **P7** *notification fan-out* — `users/{uid}/notifications/{nid}`
  collection; mute/block enforced producer-side.
- **P8** *circuit breaker around paid external API* — process-local
  breaker + daily quota + kill-switch env var + Sentry warning at 80%.
- **P9** *rule-shape-validate on every write* — `keys().hasOnly([...])`,
  `changedKeys().hasOnly([...])`, per-field type/size, server-time
  pinning, identity pinning, `notBanned()`.

### Pattern P10 — *AI safety guardrail*

Every AI surface in Phase 3 (T43 LLM moderation, T44 thread summary,
T46 semantic search, T47 prayer matching) is built from the same
five-piece guardrail. Each task spec calls out which pieces it uses;
unless the spec explicitly says otherwise, **all five apply**:

1. **Leader-or-operator gate.** No AI output reaches a member without
   a human (group leader, platform admin, or the user themselves)
   approving it. T43 surfaces in the moderation queue; T44 requires a
   leader save; T47 is leader-edited per cluster; T46 is user-initiated
   (the user typing a query is the human gate).

2. **No auto-publish, no auto-action.** Even when "flagged: true" is
   90%+ confident, the LLM tier never hides messages by itself (T43)
   and never sends summaries (T44). The model produces a *draft* or
   *suggestion*; a human commits.

3. **Forensic trail.** Every AI artifact records:
   - `model` (e.g. `claude-haiku-4-5-20251001`).
   - `promptVersion` (a SHA-256 of the system prompt at call time;
     committed in the repo).
   - `modelDraftHash` (SHA-256 of the model output) when a human
     edits the output before publish.
   - `inputDigest` for moderation/clustering (a one-way hash of the
     input shape — e.g. message length, language detection, category
     scores from T20). Never the body itself.

4. **Cost guardrail (P8 + a daily cap).** Process-local circuit
   breaker; `<service>_state/<scope>-{YYYY-MM-DD}` quota doc; kill
   switch env var; Sentry warning at 80%. Daily caps default to:
   - LLM moderation (T43): 2 000 calls/day.
   - Thread summary (T44): 200 calls/day.
   - Embeddings (T45): 50 000 calls/day.
   - Semantic search (T46): rate-limited per user; the embedding
     model is shared with T45's quota.
   - Prayer clustering (T47): one weekly job; capped at 10 000
     embeddings comparison ops.

5. **Per-org / per-group disable.** Every AI surface honors a
   per-scope disable field that defaults to "on" for unaffiliated
   groups and to "ask" for orgs (org admins opt in). The fields:
   - `groups/{gid}.embeddingsEnabled` (T45; default true).
   - `orgs/{orgId}.llmModerationPolicy` (T43; `off | advisory | aggressive`).
   - `orgs/{orgId}.threadSummaryEnabled` (T44; default true for new
     orgs; for unaffiliated groups, `users/{uid}.threadSummaryEnabled`
     is irrelevant — leaders gate per-thread).
   - `orgs/{orgId}.prayerClusteringEnabled` (T47; default false —
     opt-in only).
   - `orgs/{orgId}.semanticSearchEnabled` (T46; default true).

The kill switch env vars use the same prefix:
`LLM_MODERATION_DISABLED`, `THREAD_SUMMARY_DISABLED`,
`EMBEDDINGS_DISABLED`, `SEMANTIC_SEARCH_DISABLED`,
`PRAYER_CLUSTERING_DISABLED`. The `Settings` class in
`backend/app/config.py` exposes one bool per switch (do **not** read
`os.environ.get()` directly anywhere; the Phase 2 review H9 finding
made this a hard rule).

**Prompt files live in the repo.** Every AI surface has a
`backend/app/services/prompts/<surface>.py` module that exports:

```python
SYSTEM_PROMPT: str = "..."
PROMPT_VERSION: str  # SHA-256 hex of SYSTEM_PROMPT, computed at import
PROMPT_VERSION_LABEL: str = "v1"  # human-readable label, bumped on edit
```

Compute `PROMPT_VERSION` at module load time so a deployed binary
records exactly the prompt that was active. Never assemble the
system prompt from environment variables.

### Pattern P11 — *server-side fetcher with SSRF guard*

Phase 3 introduces three places where the backend follows a
user-supplied URL: T52 sermon oEmbed, T53 link unfurl, T55 DNS TXT
verification. Each one uses the same fetch helper —
`backend/app/services/safe_fetch.py` — created in T53 and reused.

The fetcher MUST:

1. **Allowlist schemes.** `https` only. `http` rejected (no
   downgrade). `data:`, `javascript:`, `file:`, `ftp:`, anything
   with `@` in the host — rejected.
2. **Resolve the host before fetch.** Use `socket.getaddrinfo` and
   reject if any resolved address falls in:
   - RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - Loopback (`127.0.0.0/8`, `::1/128`).
   - Link-local (`169.254.0.0/16`, `fe80::/10`) — also catches
     cloud-metadata `169.254.169.254`.
   - IPv6 ULA (`fc00::/7`).
   - Carrier-grade NAT (`100.64.0.0/10`).
   - The reserved/multicast/broadcast spaces.
3. **Cap response.** Hard 5 MB per response; abort the stream past
   that. Hard 10 s total timeout.
4. **Cap redirects.** Max 3 redirects; each redirect is re-checked
   through the host allowlist (the redirect target may resolve to a
   private IP even if the original didn't).
5. **Per-host rate limit.** A token-bucket keyed by `host` — 30
   requests/min/host process-local. Across instances acceptable to
   over-fire by a factor of N (the cap is courtesy, not security).
6. **No request body forwarding.** GET only. No body. No cookies.
   No custom headers other than `User-Agent: jacob-bot/1.0
   (+https://jacob.app)`.
7. **Sentry breadcrumb on every fetch.** Record host, status,
   bytes; never the body.

Backend tests assert that a fetch to `http://169.254.169.254/...`
(GCP metadata service), `http://localhost/...`, and `http://10.0.0.1`
all reject before hitting the network. Pin this with mocked DNS so
the test is deterministic.

### Pattern P12 — *org-scoped permission boundary*

T54 introduces `orgs/{orgId}` as a parent of `groups/{gid}`. Every
existing rule that gates on `isGroupLeader(gid)` must continue to
work; in addition, an *org admin* of the parent org must be allowed
to perform every leader action against the group, plus a few
org-only actions. The pattern:

1. Add `isOrgAdmin(orgId)` helper to `firestore.rules`:

   ```
   function isOrgAdmin(orgId) {
     return isSignedIn()
       && exists(/databases/$(database)/documents/orgs/$(orgId)/admins/$(request.auth.uid));
   }
   ```

2. Define `groupOrgAdmin(gid)` that resolves the parent org id and
   delegates:

   ```
   function groupOrgAdmin(gid) {
     let group = get(/databases/$(database)/documents/groups/$(gid)).data;
     return group.get('orgId', null) != null
       && isOrgAdmin(group.orgId);
   }
   ```

3. Every existing leader-only predicate becomes
   `(isGroupLeader(gid) || groupOrgAdmin(gid))`. **Do not remove the
   leader gate** — org admins are *additive* trust, not replacement.

4. The `groupOrgAdmin(gid)` lookup costs one extra `get` per write.
   For chat hot paths (`messages` create), this is too expensive —
   the message-create rule does NOT widen to org admin. Org admins
   post messages by being an explicit member (org admins join groups
   normally). The widening applies to *leader actions* (settings,
   archive, announce, pin, sermon add, event create), not member
   actions.

5. Org admins are stored in `orgs/{orgId}/admins/{uid}` —
   subcollection of the org doc. Org *members* (any user in any
   group of the org) live in `orgs/{orgId}/members/{uid}` (a
   denormalized index maintained by `onMemberWrite`'s extension —
   see T54). Reading the org doc itself requires only signed-in
   for public orgs.

6. Cross-task gotcha: every Phase 2 rule that currently widens to
   `request.auth.token.admin == true` (platform admin) gets the
   *additional* widening to `groupOrgAdmin(gid)`, in this exact
   priority: leader > org admin > platform admin. Document the
   priority in the rule comment.

Tests live in `firestore/tests/orgs.rules.test.ts` (new) and
`firestore/tests/cross-org.rules.test.ts` (new) — the second file
asserts that org admins of org A cannot perform leader actions in
org B's groups, and that unaffiliated groups (`orgId == null`)
behave exactly as in Phase 2.

### Pattern P13 — *feature-flag gate*

T58 introduces feature flags. Every Phase 3 task that lands a
user-visible surface (T40, T41, T43–T57, T63–T65) ships behind a
flag. The pattern:

1. **Naming.** `<area>_<surface>_enabled`, snake_case. Examples:
   `mobile_native_enabled`, `voice_rooms_enabled`,
   `semantic_search_enabled`, `prayer_clustering_enabled`.

2. **Default state.** New flags default to `enabled: false`,
   `rolloutPercentage: 0`. Cohort `uids` includes the platform-admin
   uid so internal staff see the surface immediately.

3. **Server evaluation parity.** The server-side evaluator
   (`backend/app/services/flags.py`) and the client evaluator
   (`frontend/lib/flags.ts`, `mobile/lib/flags.ts`) implement the
   same hash function:
   ```python
   def evaluate(uid: str, flag_key: str, percentage: int) -> bool:
       digest = hashlib.sha256(f"{uid}:{flag_key}".encode()).hexdigest()
       bucket = int(digest[:8], 16) % 100
       return bucket < percentage
   ```
   TypeScript implementation mirrors this with `crypto.subtle.digest`
   on the client and node `crypto` server-side. Cohort overrides
   (`uids`, `orgIds`, `roles`) win over the percentage check.

4. **Cleanup discipline.** A flag at 100% for >30 days surfaces in
   the admin UI as "Candidate for cleanup" (T58 acceptance criterion).
   When a Phase 3 task is fully ramped, the **next** PR removes the
   flag from the code (gate becomes always-on; flag doc deleted).

5. **Critical-path flags get a kill-switch env var.** For any AI or
   external-API task (T43–T47, T57, T63), the env var
   (`<SERVICE>_DISABLED`) is the *override* — when set true, the
   gate evaluates false regardless of the flag doc. This is the
   incident-response shortcut.

### Pattern P14 — *RTDB ephemeral state*

Phase 3 uses Firebase Realtime Database for three surfaces:

| Surface              | RTDB path                          | Listener      | onDisconnect cleanup     |
|----------------------|------------------------------------|---------------|--------------------------|
| Presence (T48)       | `/presence/{gid}/{uid}`            | per-group     | set status: offline      |
| Typing (T48)         | `/typing/{gid}/{uid}`              | per-group     | remove                   |
| Watch sync (T50)     | `/watch/{gid}/{sessionId}`         | per-session   | remove if leader         |

RTDB rules live in `infra/firebase-rtdb-rules.json` (new file in T48)
and are deployed via `firebase deploy --only database`. The shape of
each rule:

```json
{
  "rules": {
    "presence": {
      "$gid": {
        ".read": "auth != null && root.child('memberships').child(auth.uid).child($gid).exists()",
        "$uid": {
          ".write": "auth != null && auth.uid == $uid"
        }
      }
    }
  }
}
```

RTDB does not have native "is member of group" — we maintain a thin
mirror at `/memberships/{uid}/{gid}: true` written by the
`onMemberWrite` Firestore trigger (extended in T48). This is the
single denormalization across the two databases; document it in
`docs/data-model.md` and the T48 spec.

Per-task rule predicates and exact paths are pinned in each task
section. **Never** trust client-supplied uids; always anchor on
`auth.uid == $uid` for writes.

### Pattern P15 — *content-source attribution*

T44 (summaries), T47 (prayer clusters), T51 (devotionals), T52
(sermon archives), T53 (link unfurls) all render text or media that
the user did not author. Each attribution surface uses the same
component shape, in `frontend/components/attribution/`:

- `<SourceTag source={SourceDescriptor} />` — small chip that says
  who/what produced the content. Variants: `ai-suggestion`,
  `leader-edit-from-ai`, `leader`, `external` (URL host),
  `devotional` (named author), `sermon` (preacher).
- Always renders **before** the content body, never inline.
- Always uses sufficient contrast (T62 requirement) and sufficient
  size (≥ 12px) to be perceivable.

Mobile mirrors this in `mobile/components/attribution/` with
React Native equivalents.

### Pattern P16 — *cohort retention math*

T60 group-health dashboard relies on cohort retention curves that
many tasks generate ad-hoc; standardize the math here so dashboards
agree.

- **Cohort N** = the set of users who joined a group in ISO week N.
- **Active in week N+k** = the user posted, replied, reacted, or
  RSVP'd-going inside the same group in ISO week N+k.
- **Retention curve** = for each k ∈ {0, 1, 2, 4, 8, 12}, percent of
  cohort N who were active in week N+k. (We do NOT compute every
  intermediate week — sparse points keep the chart readable and the
  BigQuery view cheap.)
- **Aggregation:** Per-org dashboards average retention curves
  across groups, weighted by cohort size.

Implemented as a BigQuery view (`engagement_weekly` extended +
`member_retention_cohort` new — T60 spec). Do not recompute in
Python loops.

### Pattern P17 — *appeals-eligible action*

T64 introduces the appeal surface. Every moderator-initiated action
that affects a user (message hide, ban, group archive that takes
their content offline, board post hide, board ban) writes an
`appeal_eligible_actions/{actionId}` doc that the appeal flow reads.

The shape:

```ts
appeal_eligible_actions/{actionId}: {
  actorUid: string,           // moderator who took the action
  subjectUid: string,         // user whose content/account was affected
  type: "message_hide" | "ban" | "group_archive_member" | "board_post_hide" | "appeal_decision",
  ref: string,                // e.g. "groups/g1/messages/m1" or "users/u1"
  takenAt: Timestamp,
  reason: string,             // freeform, ≤ 500 chars
  emailSentAt: Timestamp | null,
  emailToken: string,         // 14-day-expiry JWT for the appeal page
  appealId: string | null,    // set when the user submits an appeal
}
```

Existing Phase 1/2 mod actions backfill into this collection in T64
(see migration plan). New Phase 3 tasks that introduce a new action
type (T63 NCMEC retention, T64 appeal decision itself) extend the
`type` enum and document the addition.

### Pattern P18 — *transparency-redacted aggregate*

T65 surfaces moderation stats publicly. Every aggregate function
defined in `backend/app/services/transparency.py` MUST:

1. Bucket by category (e.g. `harassment`, `csam`, `spam`) — never
   emit raw counts that could be cross-referenced with a single
   incident.
2. Round counts to nearest 5 when the bucket has fewer than 25
   events. (Avoids re-identification of a single event in a small
   org.)
3. Never emit identifiers (`uid`, `gid`, `mid`) — only aggregates.
4. Run the privacy-guard regex test that scans the rendered
   payload for any 28-char-base64 segment (Firebase doc ids) before
   publish. If the regex matches, refuse to publish; surface a
   `transparency_pii_leak` Sentry alert.

Phase 3 tasks that introduce a new bucket (T63 NCMEC, T64 appeals,
T57 voice abuse) extend this service and add a corresponding bucket
to the report shape.

### Pattern P19 — *mobile-web parity*

T40 introduces the `mobile/` workspace. Every subsequent Phase 3
task that touches a user-visible surface (T41, T42, T48, T49, T50,
T51, T52, T53, T54-via-org-context, T57, T61, T62) MUST:

1. List a "Mobile parity" subsection in *Frontend interface*
   describing the equivalent surface in `mobile/`.
2. Reuse the *same* Firestore data model and the *same* backend
   endpoints. Do not introduce a mobile-only Firestore field.
3. Reuse the *same* zod schemas (lift them into a shared
   `frontend/lib/schemas/` module the first time a mobile screen
   needs one — T42 is the natural extraction point).
4. State explicitly when something is web-only or mobile-only,
   with a feature-flag gate (`<surface>_mobile_enabled`,
   `<surface>_web_enabled`).

If a Sonnet plan creates a mobile-only data shape, reject the plan.

---

## 2. Per-task specifications

The 26 tasks below are ordered by ID. Reading order does not have to
be implementation order — see the Phase 3 dev plan for a sane
sequencing recommendation (T54 + T58 land early as they unlock
multiple downstream tasks).

## T40 — React Native (Expo) shell — auth, chat, threads parity — Sonnet

**Goal:** Stand up the `mobile/` workspace as a separate Expo
Router project with feature parity for sign-in, group list, group
chat (top-level + threads), stickers, and profile. The native build
is gated behind feature flag `mobile_native_enabled` so we can
dark-launch.

### Acceptance criteria

- An internal-distribution iOS build installs on a TestFlight tester
  device, signs in with Google, lists groups, sends a message, and
  the message appears on the web app within 2s.
- Same for Android via Play Console internal track.
- Firestore listeners are torn down on screen unmount (verified via
  a debug `__JACOB_LISTENER_COUNT__` overlay enabled by `JACOB_DEBUG_LISTENERS=1`).
- A non-member opening `jacob://groups/g1/chat` for a group they don't
  belong to is shown a "Request to join" screen, not a permission-
  denied stack trace.
- "Open in browser" appears for any unimplemented surface and opens
  the right deep link (`https://jacob.app/groups/{gid}/...`).
- EAS preview builds run in CI without paid Apple Developer secrets
  leaking into PR logs.
- Feature flag `mobile_native_enabled` (T58) gates the entire app —
  when off, the launch screen shows a "Coming soon" splash with a
  PWA download link.

### Files to create

- `mobile/` — new pnpm workspace; `pnpm create expo-app`, scaffolded
  with TypeScript template + Expo Router.
- `mobile/package.json` — declares `name: "jacob-mobile"`, depends on
  `@react-native-firebase/app`, `@react-native-firebase/auth`,
  `@react-native-firebase/firestore`, `expo`, `expo-router`,
  `expo-notifications`, `expo-application`, `react-native-mmkv` (for
  the offline cache mirror), `zustand` (small store for auth state),
  `zod`, `react-hook-form`. **Do NOT add `axios` or other HTTP
  clients** — the backend is reached via `fetch` with an
  `idTokenInterceptor` helper (mirror `frontend/lib/firebase.ts`).
- `mobile/app/` — Expo Router file-tree:
  - `_layout.tsx` — root layout; mounts the Firebase init, auth
    listener, error boundary, debug listener-count overlay.
  - `(auth)/sign-in.tsx` — email/password + Google. Apple/Passkey
    arrive in T42.
  - `(auth)/_layout.tsx` — guards: redirect to `/groups` if signed in.
  - `(authed)/_layout.tsx` — guards: redirect to `/sign-in` if signed
    out; renders the bottom tab bar (Groups, Discover, Profile).
  - `(authed)/groups/index.tsx` — group list (uses CG `members` query).
  - `(authed)/groups/[gid]/chat.tsx` — chat screen.
  - `(authed)/groups/[gid]/thread/[mid].tsx` — thread screen.
  - `(authed)/profile.tsx` — read-only-ish profile (display name +
    avatar; advanced settings open in browser via the fallback).
  - `(authed)/+not-found.tsx` — 404 fallback.
  - `(authed)/_open-in-browser.tsx` — generic "Open in browser"
    screen, deep-link aware.
- `mobile/lib/firebase.ts` — `@react-native-firebase/app` init.
  Reads config from `app.config.ts` `extra` (which reads from EAS
  secrets at build time). **Never hardcode the API key.**
- `mobile/lib/auth-context.tsx` — mirrors `frontend/lib/auth-context.tsx`,
  exposing `useAuth()`. Auth state listener is RN's `auth().onAuthStateChanged`.
- `mobile/lib/hooks/useGroups.ts` — copy + adapt from
  `frontend/lib/hooks/useGroups.ts`. Same CG `members` query
  (`firestore().collectionGroup('members').where('uid','==',uid)`).
- `mobile/lib/hooks/useGroup.ts`, `useGroupMessages.ts`,
  `useThreadMessages.ts` — mirror web hooks 1:1 in semantics,
  adapted for the RN Firestore API (`firestore().collection('groups').doc(gid)...`).
- `mobile/lib/hooks/useStickers.ts` — small in-memory cache; reuse
  the seed.
- `mobile/lib/flags.ts` — feature-flag client (P13). Lightweight
  one-listener subscription on `feature_flags` collection.
- `mobile/lib/deep-links.ts` — `parseDeepLink(url) -> Route` and
  `routeToDeepLink(route) -> string`. Used by sign-in flow + push
  receipt + "Open in browser" fallback.
- `mobile/components/chat/MessageList.tsx` — `FlatList`-backed,
  inverted, with `onEndReached` paginating older messages by 50.
- `mobile/components/chat/MessageItem.tsx` — author avatar (from
  `users/{uid}.photoURL`), display name, body, sticker emoji,
  timestamp, edited/deleted indicators. Hidden-state filter
  (`moderation.state == 'hidden'`) — same logic as web; mute/block
  also applies via `useMutes` / `useBlocks` mobile mirrors.
- `mobile/components/chat/MessageInput.tsx` — text input + send
  button + sticker picker (mobile bottom sheet).
- `mobile/components/chat/StickerPicker.tsx` — bottom sheet (Expo
  bottom-sheet lib), grid layout.
- `mobile/components/groups/GroupListItem.tsx`.
- `mobile/components/auth/SignInForm.tsx` — react-hook-form + zod;
  shares schemas with web (T42 lifts these to `frontend/lib/schemas/`).
- `mobile/components/util/ListenerCountOverlay.tsx` — debug overlay
  showing the active Firestore listener count; gated by env var.
- `mobile/components/util/ErrorBoundary.tsx` — wraps the layout;
  reports to Sentry (mobile uses `@sentry/react-native`).
- `mobile/eas.json` — build profiles `development`, `preview`,
  `production`. Production builds set `EXPO_PUBLIC_FIREBASE_*`
  via EAS secrets.
- `mobile/app.config.ts` — replaces `app.json`; reads env vars at
  build time and exposes them via `expo-constants`.
- `mobile/babel.config.js`, `mobile/metro.config.js`,
  `mobile/tsconfig.json`, `mobile/eslint.config.mjs` —
  match the web style.
- `.github/workflows/mobile-eas.yml` — on PRs touching `mobile/**`,
  build the iOS preview via `eas build --platform ios --profile preview --non-interactive`.
- `mobile/README.md` — `pnpm dev` (dev client), `eas build --profile preview`,
  TestFlight enrollment, Play Console enrollment, env var setup.
- `mobile/.env.example` — `EXPO_PUBLIC_FIREBASE_API_KEY`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`,
  `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
  `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`,
  `EXPO_PUBLIC_BACKEND_URL`, `JACOB_DEBUG_LISTENERS`.

### Files to modify

- `pnpm-workspace.yaml` — add `mobile`.
- `.github/workflows/ci.yml` — add `mobile` jobs (typecheck, lint,
  test) gated on `paths: mobile/**`.
- `frontend/lib/schemas/` — **create** this folder with the auth
  schemas extracted from `frontend/lib/auth-schemas.ts` so the
  mobile package can import them. Re-export from
  `frontend/lib/auth-schemas.ts` for back-compat.
- `firestore/firestore.rules` — no changes. The CG members query
  already exists; mobile reuses it.

### Data model changes

- **None.** Mobile reads/writes via the same Firestore SDK
  surface and same backend endpoints as web. (P19.)

### Firestore rule deltas

- **None.** Existing rules cover both clients. Confirm with a rules
  test that a CG members query works for an authenticated user.

### Backend interface

- **None new.** Mobile uses the existing endpoints. The backend's
  `get_current_user` accepts the Firebase ID token unchanged
  regardless of the client surface.

### Frontend interface

The web app is unchanged. The mobile app:

- **Sign-in:** `(auth)/sign-in.tsx`. Email/password + Google via
  `@react-native-google-signin/google-signin`. On success the auth
  listener navigates to `(authed)/groups`.
- **Group list:** `(authed)/groups/index.tsx`. Uses
  `mobile/lib/hooks/useGroups.ts` (CG `members` query). Renders a
  `FlatList` with pull-to-refresh. Empty state: "Find a group" CTA
  routing to `(authed)/discover` (which is a stub that opens in
  browser; full T30 parity is Phase 3.5).
- **Chat:** `(authed)/groups/[gid]/chat.tsx`. Uses
  `useGroupMessages` (mirrors web). Listener torn down on
  `useFocusEffect` cleanup AND on `Platform.AppState` background.
- **Thread:** `(authed)/groups/[gid]/thread/[mid].tsx`. Stack-pushed
  from chat.
- **Open-in-browser fallback:** `(authed)/_open-in-browser.tsx`
  receives the original deep-link URL, renders a card "This view
  isn't available in the app yet" with an "Open in browser" button
  that calls `Linking.openURL(deeplink)`.

**Mobile parity (P19):** N/A — this *is* the parity foundation.

**State ownership:**
- Auth state — `mobile/lib/auth-context.tsx` (root provider).
- Per-screen Firestore data — local hook (no global store).
- Listener accounting — `zustand` store under `mobile/lib/listener-store.ts`.

### Cloud Functions

- **None.**

### Test plan

**Mobile (`mobile/__tests__/`):**
- `signIn.test.tsx` — render `SignInForm`; fill email/password;
  assert `auth().signInWithEmailAndPassword` called.
- `useGroups.test.ts` — mock RN Firestore, assert the CG members
  query and that the hook returns sorted groups.
- `MessageItem.test.tsx` — hidden message renders moderation banner;
  muted-author message collapsed.
- `deepLinks.test.ts` — `parseDeepLink('jacob://groups/g1/chat')`
  returns `{ name: 'chat', params: { gid: 'g1' } }`.
- `listenerStore.test.ts` — increments and decrements; overlay
  reflects count.

**Frontend (`frontend/tests/`):**
- `auth-schemas.test.ts` — extracted schemas still parse the same
  inputs (regression test for the schema lift).

**Rules:** N/A.

**E2E (manual, captured in PR):**
- TestFlight install + sign-in + send-message round trip with web
  recipient verified visible within 2s.

### Edge cases / gotchas

- **Listener tear-down on background.** RN doesn't unmount screens
  when the app backgrounds; rely on `Platform.AppState` for
  background → close listeners. Resume on foreground.
- **Firebase Auth persistence.** RN Firebase persists by default; do
  NOT add a custom persistence layer (it interferes with the SDK's
  silent token refresh).
- **Deep link from a cold start.** The Expo Router initial URL
  (`Linking.getInitialURL()`) must be honored after auth. Stash the
  intended route in a one-shot ref while waiting for auth.
- **Firestore CG `members` query.** The web hook uses
  `where('uid','==',auth.uid)`. RN Firestore supports the same
  query; the CG index is already in `firestore.indexes.json`. Test
  on the emulator.
- **Apple build secrets in CI.** Use EAS Build's secret store; do
  NOT print `APPLE_API_KEY_*` in build logs. The workflow uses
  `--non-interactive` and the secret is referenced via
  `EAS_BUILD_PROFILE`. PR builds use the `preview` profile which
  builds for simulator (no signing required).
- **Push permission.** Don't request push permission on first launch
  — defer to T41. If a user signs in, lands on chat, and the device
  has no push token, the app behaves normally (no warnings).
- **Photo upload.** **Not implemented in T40.** The Send button
  shows text only; tapping the (currently absent) attach button is
  inert. Plan T40 acceptance: parity does not include photos. Photo
  upload joins in Phase 3.5 once the moderation pipeline has a
  validated mobile entry point. Document explicitly in
  `mobile/README.md`.
- **Reactions / mentions / search / admin.** Not implemented; tap
  → "Open in browser" fallback. Document each per the plan's
  parity scope.
- **Sticker set per group's `audience`.** The mobile sticker picker
  filters by `groups/{gid}.audience`. Mirror the web filter
  exactly.
- **Offline.** No offline writes (deferred from T36). If the
  network is down at send, surface "No connection — try again
  when online" and queue locally only as a single-shot retry that
  the user must trigger.
- **Linking on Android.** App link verification (`autoVerify`) for
  `jacob.app` requires a `assetlinks.json` on the host; document
  but defer the autoVerify until T55 lands custom domains.
- **Bundle size.** Don't add Lottie, MMKV-encrypted, or other
  heavy native modules just for parity. Target a < 25 MB IPA.

### Migration / rollout

- **Feature flag:** `mobile_native_enabled` (T58). When false, the
  launch screen shows "Coming soon" + PWA link. When true, app
  proceeds.
  - Default: `enabled: false`, `cohorts.uids` includes the platform
    admin.
  - Rollout: 0% → 10% (TestFlight only) → 50% (TF + Play internal)
    → 100% (public stores).
- **Env vars:** documented in `mobile/.env.example`.
- **Back-fill:** none.
- **Apple Developer enrollment:** required before the first
  TestFlight build. Document in `mobile/README.md`.

### Dependencies

- T04 (sign-in), T08 (chat), T09 (threads), T36 (PWA — provides the
  fallback URL pattern).
- Cross-task: T41 (native push — runs after T40 lands), T42
  (passkeys / Apple — adds native auth options).

### Estimated complexity

Large (new workspace, RN-specific quirks, EAS Build pipeline). One
to two Sonnet sessions, ~3–4 days.

---

## T41 — Native push notifications (APNs + FCM) — Sonnet

**Goal:** Native iOS and Android push delivery for the same
notification kinds T34 already serves on web (mentions, replies,
announcements) plus the Phase 3 kinds (event reminders T49,
voice-room invites T57). The notification doc shape stays
unchanged; the `onNotificationCreate` trigger fans to the right
platform per device.

### Acceptance criteria

- A mention in a group surfaces a native push on the mentioned user's
  iPhone within 10s in dev (cold-starts excepted).
- Tapping the push opens the right thread.
- Quiet-hours suppression: a non-announcement push fired during a
  configured quiet window is held and delivered after the window.
  Verified with a test that fakes "now" via the function's
  clock-injection helper.
- APNs certificate / FCM v1 service-account rotation runbook in
  `docs/runbooks/push.md` is exercised against staging.
- Sentry captures `push_send_failed` with platform + reason (no PII).
- Stale-token cleanup extended: `Unregistered` (iOS),
  `NotRegistered` (Android), `messaging/invalid-registration-token`
  (web) all delete the device doc.

### Files to create

- `mobile/lib/push.ts` — `expo-notifications` setup,
  `registerForPushAsync()` returning the APNs token (iOS) or FCM
  token (Android). Writes/refreshes
  `users/{uid}/devices/{deviceId}` with `platform`, `appVersion`,
  `lastSeenAt`.
- `mobile/lib/hooks/usePushSetup.ts` — wraps the registration call;
  invoked once per cold start after auth.
- `mobile/app/(authed)/settings/notifications.tsx` — per-kind opt-in
  toggles, mirrors `frontend/app/(authed)/settings/notifications/page.tsx`.
- `functions/src/services/quietHours.ts` — extract from the existing
  inline quiet-hours logic; clock-injectable for tests.

### Files to modify

- `firestore/firestore.rules` — extend
  `users/{uid}/devices/{deviceId}.platform` enum to allow
  `'web' | 'ios' | 'android'` (already present per Phase 2). Confirm
  via rules test that `platform: 'ios'` is accepted.
- `functions/src/onNotificationCreate.ts` — extend to dispatch APNs
  via FCM HTTP v1 API for iOS devices and FCM for Android. Web
  continues to use FCM (existing path). Add `collapse_key` (per
  Phase 2 review C5 fix verification): set
  `apns.headers["apns-collapse-id"] = ${kind}-${nid}` for iOS,
  `webpush.headers["Topic"] = ${kind}-${nid}` for web,
  `android.collapse_key = ${kind}-${nid}` for Android.
- `functions/src/services/fcm.ts` — extend `sendFcm` to set the
  per-platform headers; add per-platform error handling
  (`Unregistered` → delete device doc).
- `infra/secrets.tf` — APNs auth key in Secret Manager;
  `apns_key_id`, `apns_team_id`, `apns_bundle_id` env vars on the
  Cloud Function service account.
- `docs/runbooks/push.md` — rotation procedure (extend with native
  channels): APNs key rotation (Apple Developer Portal → Keys →
  generate p8 → upload to Secret Manager); FCM v1 service account
  rotation; how to verify token format per platform.
- `users/{uid}/devices/{deviceId}` — schema **append** of
  `appVersion: string | null`. Already-allowed by the rule
  (`'appVersion'` in `keys().hasOnly(...)`). No migration needed.

### Data model changes

- `users/{uid}/devices/{deviceId}`:
  - `appVersion: string` — e.g. `"jacob-mobile/1.0.3"`. Optional;
    rule already allows.
  - `platform: 'web' | 'ios' | 'android'` — already allowed.

### Firestore rule deltas

- **None.** Existing rule (`firestore.rules:140-152`) already
  permits the schema. Confirm via two new tests:
  - `device create with platform: 'ios' and appVersion is allowed`.
  - `device create with platform: 'unsupported' is rejected`.

### Backend interface

- **None new.** Token registration is direct Firestore write. The
  cleanup job (`infra/scheduled/cleanup_stale_devices.py`) already
  exists; extend it to delete devices whose `lastSeenAt` is older
  than 30 days regardless of platform.

### Frontend interface

- **Mobile (T41 owner):**
  - `(authed)/settings/notifications.tsx` — toggle preferences
    (`mentions`, `replies`, `announcements`, `digest`); writes to
    `users/{uid}/notificationPrefs/main`.
  - On first authed launch, `usePushSetup` requests permission via
    `Notifications.requestPermissionsAsync()`. If granted, fetches
    the platform token and writes the device doc.
  - On tap: notification payload includes
    `data.deepLink: "jacob://groups/g1/messages/m1"`. The mobile
    `Notifications.addNotificationResponseReceivedListener`
    handles the tap and routes via `Linking.openURL`.
- **Web (already shipped):** No changes other than the
  `collapse_key` field added to the FCM payload (server-side).

### Cloud Functions

`functions/src/onNotificationCreate.ts` — extended:

1. (P3) idempotency: existing `_events` marker stays; the fan-out
   to FCM is also keyed via `collapse_key` for platform-side
   dedup. (P14 from the Phase 2 review.)
2. Per-device dispatch: read all `users/{uid}/devices/*` for the
   recipient. For each:
   - `platform === 'ios'`: send via FCM HTTP v1 with
     `apns: { headers: { 'apns-collapse-id': `${kind}-${nid}`, 'apns-priority': '10' }, payload: { aps: { alert: { title, body }, sound: 'default', badge: <unread count> } } }`.
   - `platform === 'android'`: send via FCM with
     `android: { collapse_key: `${kind}-${nid}`, priority: 'high', notification: { ... } }`.
   - `platform === 'web'`: existing path, unchanged except for the
     `webpush.headers.Topic` set.
3. (Phase 2 review H5 fix) Quota reservation runs once per device
   inside the loop, not once per notification. Confirm.
4. (Phase 2 review H6 fix) Track success vs failure counts per
   notification:
   - `delivered: int` — number of devices that succeeded.
   - `failed: int` — number that failed.
   - `deliveredAt: serverTimestamp` if `delivered > 0`.
   - `failedAt: serverTimestamp` if `failed > 0 && delivered === 0`.
5. Quiet-hours: read `users/{uid}.notificationPrefs.quietHours`
   (new field — see below). If now is inside quiet hours AND
   `kind !== 'announcement'`, set
   `notif.heldUntil = nextQuietHoursEnd(now, prefs)` and skip
   dispatch. A scheduled job (`infra/scheduled/process_held_pushes.py`,
   new) runs every 15 min, finds notification docs with
   `heldUntil <= now && deliveredAt == null`, and re-triggers
   dispatch by clearing `heldUntil` and writing
   `processedAt: serverTimestamp` (which the Firestore trigger
   re-fires on — confirm by event-id idempotency).

### Schema additions for quiet hours

- `users/{uid}/notificationPrefs/main`:
  - `quietHours: { enabled: bool, startMinute: int (0..1439), endMinute: int (0..1439), timeZone: string }` — nullable; absent ≡ off.

Rule extension:

```
match /users/{uid}/notificationPrefs/{docId} {
  allow create, update: if isUser(uid)
    && docId == "main"
    && request.resource.data.keys().hasOnly([
         'mentions', 'replies', 'announcements', 'digest',
         'schemaVersion', 'quietHours'])
    && request.resource.data.mentions is bool
    && request.resource.data.replies is bool
    && request.resource.data.announcements is bool
    && request.resource.data.digest is bool
    && (!('quietHours' in request.resource.data)
        || (request.resource.data.quietHours.enabled is bool
            && request.resource.data.quietHours.startMinute is int
            && request.resource.data.quietHours.startMinute >= 0
            && request.resource.data.quietHours.startMinute <= 1439
            && request.resource.data.quietHours.endMinute is int
            && request.resource.data.quietHours.endMinute >= 0
            && request.resource.data.quietHours.endMinute <= 1439
            && request.resource.data.quietHours.timeZone is string
            && request.resource.data.quietHours.timeZone.size() <= 64));
}
```

### Test plan

**Functions (`functions/src/__tests__/onNotificationCreate.test.ts`, extend):**
- `dispatches APNs for an iOS device with collapse_id`.
- `dispatches Android FCM with collapse_key`.
- `holds a non-announcement push during quiet hours`.
- `delivers an announcement during quiet hours despite the prefs`.
- `Unregistered iOS error deletes the device doc`.
- `delivered: 1, failed: 0 written when one device succeeds`.
- `delivered: 0, failed: 1 written when only device fails (failedAt set)`.

**Backend (`backend/tests/test_quiet_hours.py`, new):**
- `nextQuietHoursEnd respects DST transition for a US/Eastern user`.

**Mobile (`mobile/__tests__/push.test.ts`):**
- `registerForPushAsync writes a device doc with platform and appVersion`.
- `tap on a deep-link payload routes to the right screen`.

**Rules (`firestore/tests/notification_prefs.rules.test.ts`):**
- `valid quietHours object accepted`.
- `quietHours with startMinute > 1439 rejected`.
- `quietHours.timeZone > 64 chars rejected`.

### Edge cases / gotchas

- **Quiet-hours window crosses midnight.** `startMinute=1320`,
  `endMinute=420` means 22:00–07:00. Helper handles wrap; document
  the test case.
- **DST transitions.** Use `zoneinfo.ZoneInfo(prefs.timeZone)` for
  the local-time conversion. Don't hand-roll offset math.
- **Held push dispatch must be idempotent.** The held-push job
  clears `heldUntil` and bumps `processedAt`. The Firestore trigger
  re-fires; `_events/{eventId}` dedups. Verify by triggering the
  same notification twice in tests.
- **APNs token format.** Expo returns the device token as a hex
  string when using `getDevicePushTokenAsync()`. FCM HTTP v1
  expects the same format wrapped in the `apns: { token }` field.
  Document.
- **Token rotation.** Apple rotates APNs tokens on app reinstall.
  `usePushSetup` MUST refresh on every cold start; the device doc
  ID is the token itself (so a new token writes a new doc, and the
  old one ages out via the cleanup job).
- **Privacy: no message bodies in payload preview.** Truncate to
  100 chars and strip newlines before placing in `body` field.
  (Already enforced by the producer; verify in dispatch.)
- **Mention in archived group.** The producer (T20 fan-out) already
  skips fanning to archived groups — confirm; T34 review fix added
  `archived` filter.

### Migration / rollout

- Feature flag: `native_push_enabled` (T58). Default: 0%; cohort
  uids include the platform admin.
- Env vars: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`,
  `FCM_V1_PROJECT_ID`. All in Secret Manager. Documented in
  `docs/runbooks/push.md` and `functions/.env.example`.

### Dependencies

- T34 (web push), T40 (mobile shell).
- Cross-task: T49 (event reminders use this), T57 (voice-room
  invites use this).

### Estimated complexity

Medium (extends existing trigger, native-side touchpoints, quiet
hours timezone math). One Sonnet session, ~1.5 days.

---

## T42 — Identity expansion — passkeys, Sign in with Apple, magic links — Sonnet

**Goal:** Three new sign-in paths alongside email/password and
Google: WebAuthn passkeys (web + iOS 16+ / Android 14+), Sign in with
Apple (App Store guideline 4.8 requirement given T40), email magic
links (Firebase built-in `sendSignInLinkToEmail`).

### Acceptance criteria

- A user can register a passkey on Chrome/Safari (web) and iOS 16+
  (mobile) and use it to sign in on a different device that supports
  cross-device passkeys.
- Sign in with Apple works in TestFlight build and meets App Store
  guideline 4.8.
- Magic link delivers in under 30s via SendGrid sandbox; expired
  link returns a clear error page; reused link returns
  "already used."
- All four new paths produce a valid Firebase ID token that the
  backend's `get_current_user` accepts unchanged.
- `docs/auth.md` covers recovery, the no-SMS rationale, and the
  cross-device passkey flow.

### Files to create

- `frontend/components/auth/PasskeyButton.tsx` — "Sign in with
  passkey" button that triggers `navigator.credentials.get` with
  `mediation: 'conditional'` for the autofill UX.
- `frontend/components/auth/PasskeyRegisterButton.tsx` — settings-
  page button for an authed user to add a passkey.
- `frontend/components/auth/AppleSignInButton.tsx` — Firebase
  `OAuthProvider("apple.com")`.
- `frontend/components/auth/MagicLinkForm.tsx` — email input;
  triggers `sendSignInLinkToEmail`.
- `frontend/lib/passkey.ts` — WebAuthn helpers
  (`encodeCredential`, `decodeCredential`, base64url helpers).
- `frontend/lib/schemas/auth.ts` — extracted zod schemas (created
  in T40); now extended with `MagicLinkRequestSchema`.
- `mobile/lib/auth/applesignin.ts` — `expo-apple-authentication`
  wrapper; returns identity token + nonce for Firebase exchange.
- `mobile/lib/auth/passkey.ts` — `react-native-passkey` wrapper.
- `mobile/components/auth/AppleButton.tsx`,
  `mobile/components/auth/PasskeyButton.tsx`.
- `backend/app/routers/auth.py` — new router. Endpoints:
  - `POST /api/auth/passkey/register/options` — returns
    `PublicKeyCredentialCreationOptions`.
  - `POST /api/auth/passkey/register/verify` — verifies the
    attestation, stores credential, returns `{ credentialId, name }`.
  - `POST /api/auth/passkey/sign-in/options` — returns
    `PublicKeyCredentialRequestOptions` (discoverable credentials,
    so `allowCredentials: []`).
  - `POST /api/auth/passkey/sign-in/verify` — verifies the
    assertion, mints a Firebase custom token via Admin SDK,
    returns it.
- `backend/app/services/passkeys.py` — uses `webauthn` library
  (Pythonic WebAuthn). Functions: `generate_registration_options`,
  `verify_registration`, `generate_authentication_options`,
  `verify_authentication`. Each takes the Firestore client + user
  context.
- `backend/app/models/auth.py` — pydantic shapes for the four
  endpoints.
- `users/{uid}/private/passkeys/{credentialId}` — credential public
  key, sign counter, friendly name, lastUsedAt.
- `users/{uid}/private/passkeyChallenges/{challengeId}` — short-
  lived (5-min TTL) challenge doc; deleted on verify.
- `firestore/firestore.rules` — passkey subcollections (read by
  owner; create / delete server-side only).
- `firestore.indexes.json` — `fieldOverrides`:
  `users/.../passkeys.lastUsedAt` DESC for the settings page list.
- `frontend/app/(authed)/settings/passkeys/page.tsx` — list +
  register + delete (delete via backend).
- `docs/auth.md` — new doc: which methods are supported on which
  platforms, recovery flows (passkey-only user → magic link to
  verified email is the canonical recovery path), account-takeover
  threat model, no-SMS rationale.
- `docs/adr/0011-identity-expansion.md` — passkey storage choice
  (Firestore vs. third-party), the Apple flow on web vs. native,
  the magic-link expiry policy.

### Files to modify

- `frontend/app/(auth)/sign-in/page.tsx` — add the three new
  buttons; preserve email/password + Google.
- `mobile/app/(auth)/sign-in.tsx` — same.
- `backend/app/limits.py` — add `PASSKEY_REGISTER`,
  `PASSKEY_SIGN_IN`, `MAGIC_LINK_REQUEST`.
- `backend/app/main.py` — mount the new auth router.
- `backend/.env.example` + `backend/README.md` — add
  `JACOB_PASSKEY_RP_ID` (e.g. `"jacob.app"`),
  `JACOB_PASSKEY_RP_NAME` (`"JACOB"`), `JACOB_PASSKEY_ORIGIN`
  (`"https://jacob.app"`; multiple origins comma-separated for
  vanity domains in T55), `MAGIC_LINK_HANDLER_URL`.
- `docs/email-templates.md` — magic link template.

### Data model changes

- `users/{uid}/private/passkeys/{credentialId}`:
  ```ts
  {
    credentialId: string,        // base64url, also the doc id
    publicKey: string,           // base64url COSE key
    signCount: number,           // monotonically increasing
    transports: string[],        // ['internal','hybrid','usb',...]
    aaguid: string,              // optional authenticator id
    name: string,                // user-supplied (e.g. "Chris's iPhone")
    createdAt: Timestamp,
    lastUsedAt: Timestamp | null,
  }
  ```
- `users/{uid}/private/passkeyChallenges/{challengeId}`:
  ```ts
  {
    challenge: string,           // base64url, 32 random bytes
    type: 'registration' | 'authentication',
    expiresAt: Timestamp,        // now + 5min
    rpId: string,
    consumed: boolean,           // set true on verify; doc deleted next sweep
  }
  ```

### Firestore rule deltas

```
match /users/{uid} {
  match /private/passkeys/{credentialId} {
    allow read: if isUser(uid);
    // Backend only — admin SDK bypasses rules.
    allow create, update, delete: if false;
  }
  match /private/passkeyChallenges/{challengeId} {
    // Owner can read for the JS-side flow (the backend issues the
    // challenge but the client must also see it for the WebAuthn
    // call). Writes are server-only.
    allow read: if isUser(uid);
    allow create, update, delete: if false;
  }
}
```

Add a Firestore TTL on `users/{uid}/private/passkeyChallenges` —
field `expiresAt`, configured via
`gcloud firestore fields ttls create --collection-group=passkeyChallenges --field=expiresAt`.
Document in `docs/data-model.md`.

### Backend interface

`backend/app/routers/auth.py`:

```python
class PasskeyRegisterOptionsRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)

class PasskeyRegisterOptionsResponse(BaseModel):
    options: dict  # WebAuthn JSON; opaque to the backend
    challengeId: str

class PasskeyRegisterVerifyRequest(BaseModel):
    challengeId: str
    attestationResponse: dict

class PasskeyRegisterVerifyResponse(BaseModel):
    credentialId: str
    name: str

class PasskeySignInOptionsResponse(BaseModel):
    options: dict
    challengeId: str

class PasskeySignInVerifyRequest(BaseModel):
    challengeId: str
    assertionResponse: dict

class PasskeySignInVerifyResponse(BaseModel):
    customToken: str
    uid: str
```

- `POST /api/auth/passkey/register/options`:
  - **Auth:** signed-in user (Firebase ID token).
  - **Rate limit:** `PASSKEY_REGISTER`.
  - Generate 32 random bytes; store in
    `users/{uid}/private/passkeyChallenges/{challengeId}` with
    `expiresAt = now + 5min`. Return `options` with the user's uid
    + display name + the challenge.
- `POST /api/auth/passkey/register/verify`:
  - **Auth:** signed-in.
  - **Rate limit:** `PASSKEY_REGISTER`.
  - Verify via `webauthn.verify_registration_response`. On success,
    write `users/{uid}/private/passkeys/{credentialId}` and delete
    the challenge doc. Audit log `passkey_register`.
- `POST /api/auth/passkey/sign-in/options`:
  - **Auth:** **anonymous OK** — no user yet. (Add the route as a
    public route; the rate limit + challenge id is the safety.)
  - **Rate limit:** `PASSKEY_SIGN_IN`.
  - The server doesn't know which user yet (discoverable
    credentials). Stash the challenge under
    `auth_pending_challenges/{challengeId}` with TTL.
- `POST /api/auth/passkey/sign-in/verify`:
  - **Auth:** anonymous.
  - **Rate limit:** `PASSKEY_SIGN_IN`.
  - From the assertion's credential id, look up the
    `users/{uid}/private/passkeys/{credentialId}` via a CG query
    (we don't know the uid yet). Verify; bump `signCount`; delete
    the challenge doc; mint a Firebase custom token via
    `firebase_admin.auth.create_custom_token(uid)`. Audit log
    `passkey_sign_in`.

`auth_pending_challenges/{challengeId}` — backend-only collection
for the pre-auth challenge.

### Frontend interface

- **Web sign-in (`(auth)/sign-in/page.tsx`):**
  - Email + password (existing).
  - "Continue with Google" (existing).
  - "Continue with Apple" — `signInWithPopup(auth, OAuthProvider('apple.com'))`.
  - "Sign in with passkey" — calls `/passkey/sign-in/options`,
    invokes `navigator.credentials.get`, posts the assertion to
    `/passkey/sign-in/verify`, calls `signInWithCustomToken`.
  - "Email me a sign-in link" — opens `MagicLinkForm`. Uses
    Firebase's `sendSignInLinkToEmail` directly (no backend hop).
- **Web settings (`(authed)/settings/passkeys`):**
  - List existing passkeys (read from
    `users/{uid}/private/passkeys`).
  - "Add a passkey" — calls register/options + register/verify.
  - "Remove" per row — calls `DELETE /api/auth/passkey/{credentialId}`
    (TODO: add this endpoint; trivial; uses Admin SDK).
- **Mobile sign-in:**
  - "Continue with Apple" via `expo-apple-authentication`. Returns
    `identityToken`; build a Firebase credential
    (`OAuthProvider.credential('apple.com', { idToken, rawNonce })`)
    and call `signInWithCredential`.
  - "Sign in with passkey" via `react-native-passkey`.
- **Magic link landing page:** `frontend/app/(auth)/magic/page.tsx`.
  Reads `oobCode` from query, calls `signInWithEmailLink(auth, email, url)`.

**Mobile parity (P19):** Apple is mobile-only on iOS (web Apple uses
the OAuth pop-up). Passkeys: web uses `navigator.credentials`,
mobile uses `react-native-passkey`. Magic link: opens in mobile
browser → universal link returns to app via Firebase's
`isSignInWithEmailLink`.

### Cloud Functions

- **None.** A scheduled cleanup job for stale
  `auth_pending_challenges` is unnecessary if Firestore TTL is
  enabled (configured per the rules section).

### Test plan

**Backend (`backend/tests/test_passkeys.py`, new):**
- `register options creates a challenge with TTL`.
- `register verify with a stale challenge returns 410 expired`.
- `register verify with a wrong origin returns 400 invalid_origin`.
- `sign-in verify mints a custom token for the right uid`.
- `sign-in verify with replayed signCount returns 400 stale_counter`.

**Frontend (`frontend/tests/passkey.test.tsx`):**
- `clicking Add a passkey calls register options then register verify`.
- `passkey button is hidden when navigator.credentials is missing`.

**Mobile (`mobile/__tests__/auth.test.ts`):**
- `Apple sign-in builds the right Firebase credential`.

**Rules (`firestore/tests/passkeys.rules.test.ts`):**
- `owner can read their passkeys`.
- `non-owner cannot read someone's passkeys`.
- `client cannot create or update a passkey doc`.

### Edge cases / gotchas

- **WebAuthn origin pinning.** `JACOB_PASSKEY_ORIGIN` is a
  comma-separated list. Vanity domains (T55) extend this list. A
  passkey registered on `jacob.app` is *not* usable on
  `our-church.jacob.app` unless both origins are in the RP's
  allowlist AND the RP id is set to a parent (`jacob.app`).
  Document in `docs/auth.md`.
- **Passkey-only user, lost device.** Recovery is magic link to
  the verified email. Not SMS (SIM-swap). If the user also lost
  email access — manual support path (T13 admin tool to add a
  recovery email via verified-identity proof — file as a Phase 4
  task in `docs/follow-ups/phase-3-deferred.md`).
- **Apple sign-in private email relay.** Apple gives a hashed
  relay email on first sign-in; subsequent sign-ins return the
  same relay. Don't try to "match" it back to a non-Apple
  account; create a new uid.
- **Magic link expiry.** Firebase action codes default to ~1h;
  set custom expiry to 15 min via the Identity Platform Admin
  SDK at provisioning time. **Single-use is enforced by Firebase
  natively** — verify via integration test.
- **Custom token issuance security.** The custom token is signed
  with the service-account private key. Never log it. Never store
  it. The frontend exchanges it immediately via
  `signInWithCustomToken` and discards.
- **WebAuthn UV (user verification).** Require `userVerification: 'preferred'`.
  Don't require `'required'` because some hardware tokens don't
  support PIN; preferred lets the browser choose.
- **Cross-device passkey on iOS.** Requires iCloud Keychain; if the
  user has it disabled, the passkey is device-bound. Document.
- **Sign counter monotonicity.** Some authenticators always return
  `signCount: 0`. Don't reject in that case — log a warning and
  accept. This is a known WebAuthn quirk.
- **Apple's Sign in with Apple revocation.** Apple may revoke a
  user's identity (e.g. the user disconnects). We do not currently
  handle the Apple revocation webhook in v1; document as a
  Phase 3.5 follow-up.
- **App Store rule 4.8.** If the app offers Google sign-in (it
  does), Apple sign-in must be offered. Both must be visually
  equivalent (size, position, copy). Document the layout
  requirement in the spec; design check in PR.

### Migration / rollout

- Feature flag: `passkeys_enabled` (T58). Default 0%. Internal
  cohort first.
- Env vars: `JACOB_PASSKEY_RP_ID`, `JACOB_PASSKEY_RP_NAME`,
  `JACOB_PASSKEY_ORIGIN`, `MAGIC_LINK_HANDLER_URL`.

### Dependencies

- T04 (sign-in flow), T18 (email — magic link uses SendGrid).
- Cross-task: T55 (custom domain origin list extension).

### Estimated complexity

Large (WebAuthn correctness is fiddly + three platforms). One to
two Sonnet sessions, ~3 days.

---

## T43 — LLM-assisted text moderation (pre-flag with reasoning) — **Opus**

**Goal:** A second moderation tier (after T20's Cloud NL classifier)
that uses an LLM to pre-flag uncertain messages and attaches a
one-sentence reason in the moderation queue. The LLM never auto-hides
on its own — it always raises a human-review event.

### Why Opus

The false-positive cost is silencing prayer or testimony. The system
prompt must distinguish "flag this harassment" from "don't flag this
earnest theological disagreement," reliably enough that at the
default uncertain band (NL scores 0.4–0.7) the LLM's contribution to
human reviewer accuracy is positive, not negative. Concretely: the
prompt design, the eval set, the per-org policy gradient, and the
reasoned-explanation field require theological + pastoral judgment
that does not fall out of pattern-matching prior tasks.

The architectural patterns (P3 trigger, P8 circuit breaker, P10
guardrail) are all known; the *content* is the Opus surface.

### Acceptance criteria

- A test message in the uncertain band produces a
  `moderation_queue` row with a one-sentence LLM explanation
  within 10s of post (cold-starts excepted).
- The message is NOT hidden by the LLM tier alone — verified by
  integration test that posts an uncertain-band message and asserts
  `groups/{gid}/messages/{mid}.moderation` is unset.
- Cost guardrail: unit test with the daily cap mocked at 1
  confirms the second uncertain message in a day skips the LLM
  tier and logs `llm_moderation_quota_exceeded`.
- ADR documents prompt, eval set, target precision/recall,
  monthly review process, owner.
- Prompt-cache hit rate over a 100-message synthetic eval ≥ 90%
  (verified in CI fixture).
- Reviewer-action feedback writes are visible in admin queue and
  aggregate into a count in the runbook.

### Files to create

- `functions/src/services/llmModeration.ts` — Anthropic Claude
  Haiku 4.5 client. Loads `ANTHROPIC_API_KEY` from env at lazy
  init. Per-call options:
  - `model: "claude-haiku-4-5-20251001"`.
  - `max_tokens: 256`.
  - `system`: pinned, prompt-cached
    (`cache_control: { type: 'ephemeral' }` per Anthropic SDK).
    Loaded from `functions/src/prompts/llmModeration.ts` (mirrors
    `backend/app/services/prompts/`).
  - `messages: [{ role: 'user', content: <message body, truncated to 4000 chars> }]`.
- `functions/src/prompts/llmModeration.ts` — exports
  `SYSTEM_PROMPT`, `PROMPT_VERSION` (SHA-256 hex computed at
  module load), `PROMPT_VERSION_LABEL`. The prompt is committed.
- `backend/app/routers/admin.py` — extend with
  `POST /api/admin/orgs/{orgId}/llm-policy` (or
  `/api/admin/groups/{gid}/llm-policy` for unaffiliated groups):
  set `policy: 'off' | 'advisory' | 'aggressive'`.
- `frontend/app/admin/queue/[itemId]/page.tsx` — extend to render
  `moderation_queue/{itemId}.llm` with an explicit
  "AI suggestion · not a decision" treatment + a "Model was wrong"
  feedback button.
- `frontend/components/admin/LlmReasonChip.tsx` — yellow banner
  with the one-sentence explanation; click → expands to show
  prompt version + model + severity.
- `llm_moderation_feedback/{eventId}` — new collection capturing
  reviewer action vs. LLM suggestion.
- `docs/runbooks/llm-moderation-tuning.md` — kill switch, cost
  ceiling, monthly review checklist.
- `docs/adr/0004-llm-moderation.md` — ADR.
- `functions/src/__tests__/llmModeration.test.ts`.

### Files to modify

- `functions/src/onMessageCreate.ts` — extend `runTextModeration`
  (already extracted per Phase 2 deferred M7) with the LLM tier:
  after the NL classifier runs, if any category falls in
  `[lowerBand, upperBand]` (default `[0.4, 0.7]`,
  band-tightened by `aggressive`), call the LLM tier.
- `functions/src/services/textModeration.ts` — accept
  `llmTier: { run, lowerBand, upperBand }` option; if `llmTier.run`
  is true and any score is in band, call `llmTier.run(body)`. The
  trigger wires the actual function in.
- `firestore.rules` — `moderation_queue/{itemId}.llm` is system-
  only (existing rule already denies all client writes — confirm).
- `firestore.rules` — new `llm_moderation_feedback/{eventId}`:
  ```
  match /llm_moderation_feedback/{eventId} {
    allow read, write: if false;
  }
  ```
- `backend/app/config.py` — add `llm_moderation_disabled: bool = False`,
  `llm_moderation_daily_cap: int = 2000`,
  `llm_moderation_lower_band: float = 0.4`,
  `llm_moderation_upper_band: float = 0.7`.
- `functions/.env.example` + `functions/README.md` — add
  `ANTHROPIC_API_KEY`, `LLM_MODERATION_DISABLED`,
  `LLM_MODERATION_DAILY_CAP`.

### Data model changes

- `moderation_queue/{itemId}` extension:
  ```ts
  llm: {
    flagged: boolean,
    reasons: string[],            // ['harassment', 'self_harm', ...]
    severity: 1 | 2 | 3,
    explanation: string,          // ≤ 280 chars, model output
    model: string,                // 'claude-haiku-4-5-20251001'
    promptVersion: string,        // SHA-256 hex
    promptVersionLabel: string,   // 'v1'
    inputDigest: string,          // SHA-256 of the message body
    calledAt: Timestamp,
    cacheHit: boolean,            // from Anthropic response usage
  }
  auto: true                      // already present from T20
  ```
  Note: the message body is NOT stored on the queue row; the row
  references the message via `resourceRef`. The `inputDigest` is
  for deduplication and forensic comparison only.

- `llm_moderation_feedback/{eventId}`:
  ```ts
  {
    queueItemId: string,
    reviewerUid: string,
    reviewerAction: 'approved' | 'rejected',
    llmFlagged: boolean,
    llmReasons: string[],
    llmSeverity: number,
    promptVersion: string,
    decidedAt: Timestamp,
    agreedWithModel: boolean,    // true iff llmFlagged === (reviewerAction === 'rejected')
  }
  ```

- `orgs/{orgId}.llmModerationPolicy: 'off' | 'advisory' | 'aggressive'`
  — defaults to `'advisory'` for new orgs. For unaffiliated groups,
  read `groups/{gid}.moderationPolicy.llm: 'off' | 'advisory' | 'aggressive'`
  (already established by T20's per-group moderation policy
  surface; extend with the `llm` key).

### Firestore rule deltas

```
match /moderation_queue/{itemId} {
  // already: allow read, write: if false (server-only).
}

match /llm_moderation_feedback/{eventId} {
  allow read, write: if false;
}
```

For the `groups/{gid}.moderationPolicy` and
`orgs/{orgId}.llmModerationPolicy` field updates: extend the
relevant `onlyChanges` to include the policy fields. Backend
handles writes; rules deny client writes regardless.

### Backend interface

`POST /api/admin/orgs/{orgId}/llm-policy`:
```python
class LlmPolicyRequest(BaseModel):
    policy: Literal["off", "advisory", "aggressive"]
class LlmPolicyResponse(BaseModel):
    orgId: str
    policy: str
```
- **Auth:** platform admin OR org admin (P12 — `isOrgAdmin(orgId)`).
- **Rate limit:** `ADMIN_LLM_POLICY` (10/min).
- Updates `orgs/{orgId}.llmModerationPolicy`. Audit log
  `llm_policy_set` payload `{orgId, policy}`.

`POST /api/admin/queue/{itemId}/llm-feedback`:
```python
class LlmFeedbackRequest(BaseModel):
    agree: bool   # admin sets explicitly via UI
class LlmFeedbackResponse(BaseModel):
    feedbackId: str
```
- **Auth:** platform admin (existing pattern in `admin.py`).
- **Rate limit:** `ADMIN_MUTATION`.
- Reads the queue item, writes
  `llm_moderation_feedback/{eventId}` with the agreed flag set.
  Audit log `llm_feedback`.

### Frontend interface

- `frontend/app/admin/queue/[itemId]/page.tsx` — when
  `queueItem.llm` is present, render `<LlmReasonChip />` above the
  message preview. The chip text:
  > AI suggestion · not a decision: {explanation}
- "Model was wrong" button below the chip; click writes feedback
  via the backend.
- The reviewer's resolve/reject action also fires the agreement
  feedback automatically (the explicit button is for "I think the
  model is wrong even though I'm taking the same action" — i.e.,
  the model said "spam" but the reviewer is rejecting because of
  CSAM, not because the model was right about spam).
- `frontend/app/admin/orgs/[orgId]/moderation/page.tsx` — new page
  for org admins: select LLM policy (`off | advisory | aggressive`).

**Mobile parity (P19):** Admin queue is web-only — mobile has no
admin surface. Document explicitly.

### Cloud Functions

`onMessageCreate.ts` extended:

1. (P3) idempotency unchanged — same `_events` marker.
2. (P8) circuit breaker + daily quota: extends the existing
   `tryReserveQuota` with a new scope key `llm_moderation_quota`.
3. After NL classifier, evaluate band:
   ```typescript
   const inBand = Object.values(nlScores).some(s =>
     s >= LOWER_BAND && s <= UPPER_BAND
   );
   ```
4. If `llmModerationPolicy === 'off'` for the group's org (resolve
   via the parent group's `orgId`, then `orgs/{orgId}.llmModerationPolicy`,
   defaulting to `'advisory'` if `orgId` is null and
   `groups/{gid}.moderationPolicy.llm` is unset), skip.
5. If `inBand && policy !== 'off'`, call
   `llmModeration.classify(body)`. If `aggressive`, lower band to
   `[0.25, 0.7]`.
6. The classifier returns:
   ```ts
   { flagged: boolean; reasons: string[]; severity: 1|2|3; explanation: string }
   ```
7. On `flagged: true`, write a `moderation_queue` row keyed by the
   same idempotency event id (`event.id + ':llm'`). Include the
   `llm` field. **Do NOT update the message's
   `moderation` field** — the LLM tier is advisory, not deciding.
8. On error: P8 records failure; if circuit opens, log
   `llm_moderation_circuit_open`. The NL classifier's decision
   stands; LLM tier is best-effort.
9. Always log `llm_moderation_called`, `llm_moderation_skipped`,
   or `llm_moderation_quota_exceeded` per call site.

### Test plan

**Functions (`functions/src/__tests__/llmModeration.test.ts`):**
- `in-band score with policy advisory calls LLM and writes queue row`.
- `in-band score with policy off skips LLM`.
- `out-of-band score skips LLM regardless of policy`.
- `LLM error doesn't hide the message`.
- `daily cap exceeded logs llm_moderation_quota_exceeded and skips`.
- `aggressive policy lowers the band to 0.25`.
- `cache hit rate ≥ 90% over a 100-message synthetic eval` (CI
  fixture).
- `inputDigest matches sha256(body) and does NOT include the body`.

**Backend (`backend/tests/test_llm_policy.py`):**
- `org admin can set llm-policy for own org`.
- `non-admin returns 403`.
- `LLM feedback row written with agreedWithModel computed correctly`.

**Rules (`firestore/tests/llm.rules.test.ts`):**
- `client cannot read or write moderation_queue.llm field`.
- `client cannot read or write llm_moderation_feedback`.

### Edge cases / gotchas

- **Prompt cache hit rate.** The system prompt is large (full
  context about JACOB's mission, what to flag, what NOT to flag).
  Mark `cache_control: { type: 'ephemeral' }` on the system block.
  Across a day's traffic, the cache should hold. Verify in CI by
  parsing the Anthropic response `usage.cache_creation_input_tokens`
  and `cache_read_input_tokens` — at steady state, the second
  message's reads dominate.
- **Non-English content.** The prompt is English. For non-English
  messages, the model may misclassify. The runbook documents that
  non-English flagging precision is unmeasured; advise leaders to
  treat advisory flags more skeptically until T61 + a per-language
  prompt variant lands.
- **Earnest theological disagreement** (e.g. Reformed vs. Catholic
  doctrine). The system prompt explicitly instructs against
  flagging this; eval set includes 5 such cases. If reviewer
  feedback shows the model misclassifies these in production, the
  prompt iterates monthly.
- **Prayer / testimony false positives.** The single most damaging
  failure mode. The eval set includes 10 prayer/testimony
  examples; the model must NOT flag any. CI fails if the eval
  shows any flag on these.
- **Body truncation.** Cap input at 4000 chars (matches Firestore
  rule `body.size() <= 4000`). Avoid mid-multi-byte truncation
  (use `Array.from(s).slice(0, 4000).join('')` for safety).
- **PII in prompt cache.** The user's body is in the
  `messages` array, not the cached system prompt. The cache
  contains only the system prompt. Verify no body fragments leak
  into the cached portion.
- **Reviewer-action feedback double-fire.** If a reviewer changes
  their mind (approve → reject), write a second feedback row,
  not overwrite. The aggregate query in the runbook handles
  duplicates by `eventId` semantics (`eventId = queueItemId + ':' + reviewerAction + ':' + decidedAt`).
- **Forensic chain.** `inputDigest` lets a future audit confirm
  which exact body the model was shown — useful when the message
  is later edited (T20 already pins messages to their original
  body for queue purposes; confirm).
- **Cost ceiling per org.** v1 tracks org-level via the daily cap
  shared across all orgs. v1.1 extension: per-org daily cap. File
  as Phase 3.5 follow-up.

### Migration / rollout

- Feature flag: `llm_moderation_enabled` (T58). Default 0% → 10% →
  100% across the org base.
- Env vars: `ANTHROPIC_API_KEY`, `LLM_MODERATION_DISABLED`,
  `LLM_MODERATION_DAILY_CAP`, `LLM_MODERATION_LOWER_BAND`,
  `LLM_MODERATION_UPPER_BAND`.
- Back-fill: none.

### Dependencies

- T20 (text moderation), T39 (cleanup PR — runtime helpers
  consolidated).
- Cross-task: T54 (org policy), T64 (appeals — every LLM-flagged
  message that reaches a hide gets the standard appeal path).

### Estimated complexity

Medium (extends existing trigger + new collection + small admin UI;
the *judgment* is the hard part). One Opus session, ~2 days.

---

## T44 — Thread summarization with leader-canonical override — **Opus**

**Goal:** A leader can request a one-paragraph summary of a long
thread (≥ 10 replies). The model's output is shown as
"Suggested summary — review before sharing." The leader edits to
taste and saves; the saved version becomes the canonical record and
the model's draft is discarded.

### Why Opus

The risk pattern is "AI-generated text becomes the canonical record
of a faith conversation." Leader-edit-always-wins is the
architectural answer; encoding that pattern correctly so that no
draft ever ships unedited (and yet the surface is genuinely useful
to leaders) is the judgment call. Sonnet would likely build a save
endpoint that accepts the model output verbatim — Opus must enforce
that *every* save records `modelDraftHash` (forensic trail) and that
the UI cannot ship a one-click "accept verbatim" without an explicit
human action.

### Acceptance criteria

- A leader requesting a summary on a 12-reply thread receives a
  draft within 8s; the draft is NOT persisted until the leader
  hits Save.
- The saved summary renders inline at the top of the thread,
  attributed to the leader, with the "edited from AI draft"
  indicator if `edited: true`.
- Members (non-leaders) cannot call the draft endpoint (403) and
  cannot write `messages/{mid}.summary` from the client (rules
  test).
- Forensic trail: a saved summary always includes `modelDraftHash`.
- Rate limit: 6th draft request from the same leader in an hour
  returns 429.
- Eval: a fixture of 10 sample threads produces summaries that
  pass the manual-review checklist in the runbook (no fabricated
  scripture, no editorializing).

### Files to create

- `backend/app/routers/threads.py` — new router. Endpoints:
  - `POST /api/groups/{gid}/threads/{mid}/summary/draft`.
  - `POST /api/groups/{gid}/threads/{mid}/summary` (save).
  - `DELETE /api/groups/{gid}/threads/{mid}/summary` (remove).
- `backend/app/services/thread_summary.py` — Anthropic Claude
  Sonnet 4.6 client. Quality matters more than cost here.
  Per-call options:
  - `model: "claude-sonnet-4-6"`.
  - `max_tokens: 512`.
  - `system`: pinned, prompt-cached.
  - `messages`: ordered list of recent thread messages
    (up to 100 most recent), each prepended with the author's
    display name and timestamp.
- `backend/app/services/prompts/thread_summary.py` — same
  three-export shape as P10 prompt files.
- `frontend/components/chat/ThreadSummaryPanel.tsx` — leader-only
  UI: "Generate summary" button → loading → draft textarea → Save
  / Discard.
- `frontend/components/chat/ThreadSummaryView.tsx` — read-only
  view of the saved summary at the top of a thread, with the
  attribution from P15.
- `docs/runbooks/thread-summary.md` — prompt, eval set, leader
  guidance ("edit, don't accept verbatim").

### Files to modify

- `frontend/components/chat/MessageItem.tsx` — when this is the
  parent of a thread that has `summary`, render
  `<ThreadSummaryView />` above the thread reply list. Leader
  also sees a "Edit summary" button → opens
  `<ThreadSummaryPanel />`.
- `firestore.rules` — `groups/{gid}/messages/{mid}.summary` is
  system-only write; client read OK. Add the field to the
  `keys().hasOnly([...])` allowlist on create (server writes
  via Admin SDK, but the rule's allowlist exists for documentation
  and future client paths).
- `backend/app/limits.py` — `THREAD_SUMMARY_DRAFT: "5/hour"`,
  `THREAD_SUMMARY_SAVE: "10/hour"`.
- `backend/app/config.py` — `thread_summary_disabled: bool = False`,
  `thread_summary_daily_cap: int = 200`.
- `backend/.env.example` + `backend/README.md` —
  `THREAD_SUMMARY_DISABLED`, `THREAD_SUMMARY_DAILY_CAP`.

### Data model changes

- `groups/{gid}/messages/{mid}.summary`:
  ```ts
  {
    text: string,                 // ≤ 1000 chars (rule pin)
    savedBy: string,              // leader uid
    savedAt: Timestamp,
    modelDraftHash: string,       // SHA-256 of the model draft
    edited: boolean,              // true iff savedText !== modelDraft
    promptVersion: string,
    promptVersionLabel: string,
    model: string,
  }
  ```
  Field is absent when no summary exists. Removing the field is the
  delete path.

### Firestore rule deltas

`groups/{gid}/messages/{mid}` update branches — extend with a
*system-only* rule that lets the Admin SDK write `summary` (admin
SDK bypasses rules; the rule documents the contract):

```
// Existing branches: author edit, soft delete, leader announce.
// T44: NO new client branch — summary writes go through the
// backend (Admin SDK). The rule continues to deny client writes
// to `summary` because the field is not in onlyChanges of any
// branch. Document this; do not add summary to onlyChanges.
```

The read path is the existing
`isGroupMember(gid)` (public groups already gate on hidden/
deleted); a member sees the summary alongside the message.

### Backend interface

`POST /api/groups/{gid}/threads/{mid}/summary/draft`:
```python
class ThreadSummaryDraftResponse(BaseModel):
    draft: str
    modelDraftHash: str
    promptVersion: str
    promptVersionLabel: str
    model: str
```
- **Auth:** group leader (P2 helper).
- **Rate limit:** `THREAD_SUMMARY_DRAFT` (5/hour).
- **Behavior:**
  1. Verify the message exists and is a top-level message
     (`parentMessageId == null`) and `threadReplyCount >= 10`.
     Else 400 `not_eligible`.
  2. Fetch up to 100 most recent thread replies
     (`messages.where('parentMessageId','==',mid).order_by('createdAt').limit(100)`),
     plus the parent message.
  3. Compose the user-message content as a list:
     `<author display name> [<HH:MM>]: <body>` (newline-separated).
     Cap total input at 30 000 chars (truncate oldest replies first).
  4. Call Anthropic with the system prompt cached. Compute
     `modelDraftHash = sha256(draft)`. Return.
  5. Don't persist the draft anywhere.
  6. Quota: P8 + daily cap. Circuit breaker.
- **Error codes:** `forbidden`, `not_eligible`, `summary_quota_exceeded`,
  `summary_disabled`.

`POST /api/groups/{gid}/threads/{mid}/summary`:
```python
class SaveSummaryRequest(BaseModel):
    text: str = Field(min_length=20, max_length=1000)
    modelDraftHash: str
    promptVersion: str
    promptVersionLabel: str
    model: str
class SaveSummaryResponse(BaseModel):
    gid: str
    mid: str
    savedAt: str
    edited: bool
```
- **Auth:** group leader.
- **Rate limit:** `THREAD_SUMMARY_SAVE` (10/hour).
- **Behavior:**
  1. Verify message and leader status.
  2. `edited = sha256(text) != modelDraftHash`.
  3. Write `summary` field via Admin SDK with all fields. Audit log
     `thread_summary_save` payload `{messageRef, edited, promptVersion}`.

`DELETE /api/groups/{gid}/threads/{mid}/summary`:
- **Auth:** group leader.
- Removes the field. Audit log `thread_summary_remove`.

### Frontend interface

- **Eligibility surface:** `MessageItem.tsx` — when the message is a
  thread parent and `threadReplyCount >= 10` and the user is a
  leader, render a "Summarize thread" overflow item.
- **Draft flow:** `<ThreadSummaryPanel>` —
  1. State: `idle | loading | draft | saving | error`.
  2. On "Generate summary": POST draft endpoint; show spinner.
  3. On 200: render the draft in a textarea (editable), with a
     warning banner: "AI draft — review and edit before saving.
     Once saved, your edited version becomes the canonical
     summary." plus "Discard" and "Save" buttons.
  4. "Save" disabled until the textarea has been focused for
     ≥ 1.5s (prevents one-click save). The button copy is
     "Save my edited summary" — never "Accept" or "Use as-is".
- **Saved view:** `<ThreadSummaryView>` — shows the summary at the
  top of the thread when expanded, with attribution
  (P15 `<SourceTag source={leader-edit-from-ai} />`).
- **Member view:** Reads the saved summary; no edit affordance.
  Tap to dismiss for the session (not stored).

**Mobile parity (P19):** Same flow on mobile; the panel is a
bottom sheet on RN.

### Cloud Functions

- **None.** All work is in the backend endpoint.

### Test plan

**Backend (`backend/tests/test_thread_summary.py`):**
- `draft on a 12-reply thread returns model output and hash`.
- `draft on a 5-reply thread returns 400 not_eligible`.
- `non-leader returns 403`.
- `save with edited text records edited: true and modelDraftHash`.
- `save with verbatim text records edited: false (hash matches)`.
- `delete removes the summary field`.
- `daily cap enforced`.
- `circuit-breaker open returns 503 summary_disabled`.
- `eval fixture: 10 sample threads, manual checklist passes` (CI gate).

**Frontend (`frontend/tests/thread-summary.test.tsx`):**
- `non-leader does not see the Summarize button`.
- `leader sees Summarize when threadReplyCount >= 10`.
- `Save button is disabled for the first 1.5s after the textarea has focus`.
- `Saved summary attributes to the leader and shows edited indicator`.

**Rules (`firestore/tests/threads.rules.test.ts`):**
- `client cannot write summary field directly`.
- `member can read a saved summary`.

### Edge cases / gotchas

- **Save button delay.** The 1.5s focus delay is a soft enforcement
  of "actually edit." Sonnet often optimizes this out; **do not
  remove**. The whole point of leader-canonical-override is that
  the leader's hand is on the keyboard.
- **Verbatim accept.** Acceptable but flagged: if the leader hits
  Save with the unmodified draft, `edited: false` is recorded; the
  forensic trail still shows the model's exact output via the
  hash. The runbook flags `edited: false` rates > 50% as a
  prompt-quality signal.
- **Long thread truncation.** With 100 replies and 30 000 char cap,
  the oldest replies drop out of the input. Document; the
  summary may bias to recent activity. Acceptable — leaders can
  hand-edit the summary to add "earlier in the thread, X was
  discussed."
- **Concurrent leader edits.** Two leaders both POST save; last
  write wins. Document; acceptable.
- **Member clicking "Edit summary" hidden by accident** — defense:
  the button is only rendered for leaders; backend re-checks.
- **Soft-deleted thread parent.** Reject draft (400 `not_eligible`).
- **Archived group.** Reject draft (400 `archived`).
- **Body PII.** Don't log the draft. Log `len(draft)`,
  `promptVersion`, `model`, `modelDraftHash`.
- **Anthropic outage.** Circuit breaker opens; surface 503 with
  user-friendly copy "Try again in a few minutes."
- **Leader edits an existing summary.** Fine — same endpoint, same
  semantics. The new `modelDraftHash` is the *original* model
  draft; the edited indicator stays true.
- **Removing a summary doesn't delete the thread.** Document; only
  the `summary` field is cleared.

### Migration / rollout

- Feature flag: `thread_summary_enabled` (T58).
- Env vars: `THREAD_SUMMARY_DISABLED`, `THREAD_SUMMARY_DAILY_CAP`.

### Dependencies

- T09 (threads), T22 (leader role).
- Cross-task: T54 (org-level disable for `threadSummaryEnabled`).

### Estimated complexity

Medium (one external service, one new endpoint pair, careful UI
copy / behavior). One Opus session, ~1.5 days.

---

## T45 — Embeddings export pipeline + admin tuning surface — Sonnet

**Goal:** Build the embedding-generation pipeline that T46 (semantic
search) and T47 (prayer matching) both consume. Embeddings are
computed on message create, stored in the Typesense sidecar (T28) as
a vector field, and an admin tuning page lets us inspect cost and
recompute for a date range.

### Acceptance criteria

- A new message gets an embedding in Typesense within 10s in dev.
- Disabling embeddings for a group via
  `groups/{gid}.embeddingsEnabled = false` stops the trigger from
  calling the model on subsequent messages.
- The reindex job completes a 1-day range against a fixture of 1000
  messages in under 10 minutes; rerunning the same range produces
  the same vectors (idempotent).
- Daily cap: a unit test with the cap mocked at 1 confirms
  message #2 of the day is skipped with `embedding_quota_exceeded`.
- Admin page shows daily count and cost; kill-switch flips the env
  var via Secret Manager and is reflected in the next trigger
  invocation.
- ADR documents Vertex `text-embedding-004` choice and upgrade path.

### Files to create

- `functions/src/onMessageEmbed.ts` — Firestore trigger; on message
  create, calls the embeddings model and upserts the vector to
  Typesense alongside the existing T28 message index. Idempotent
  per P3 (`messages/{mid}/_embedding_events/{eventId}`).
- `functions/src/services/embeddings.ts` — Vertex AI client.
  `text-embedding-004` model, dimension 768, region `us-central1`.
  Auth via the function's default service account (granted
  `roles/aiplatform.user`).
- `infra/scheduled/reembed_messages.py` — Cloud Run job for date-
  range reembedding. Idempotent. Resumable via a checkpoint doc
  `embedding_jobs/{jobId}.checkpoint`.
- `frontend/app/admin/embeddings/page.tsx` — admin-only page;
  daily counts, cost projection, last full-reindex date,
  "Recompute date range" form.
- `backend/app/routers/admin.py` — extend with
  `POST /api/admin/embeddings/reindex` (range-bounded, rate-
  limited).
- `docs/adr/0005-embeddings-pipeline.md` — vendor choice, model
  version, cost projection, kill switch.
- `docs/runbooks/embeddings.md` — operations: model version
  upgrade, reindex procedure, cost monitoring.
- `infra/service_accounts.tf` — extend the function SA with
  `roles/aiplatform.user` for the embeddings model invocation.

### Files to modify

- `functions/src/services/typesense.ts` — extend the upsert to
  include a `vector` field of length 768. Schema migration
  required (Typesense supports adding a vector field; document
  the migration step in the runbook).
- `functions/src/onMessageIndex.ts` — chain after embedding writes.
  Decision: the embedding trigger AND the index trigger both
  observe the same Firestore event. The embedding writes a
  separate trigger so cold-start cost doesn't compound. **The
  text and vector fields are upserted into Typesense by separate
  function invocations — Typesense supports partial document
  upsert (`upsert: 'update'`).** Document the contract: never
  overwrite the text by writing a vector; never overwrite the
  vector by writing the text. Use Typesense's `update_document`
  with the explicit field set.
- `infra/typesense.tf` — extend the schema initialization to
  include the `vector` field (defined in the schema doc).
- `groups/{gid}` — add `embeddingsEnabled: bool` (default true,
  treated as true if absent).
- `backend/app/limits.py` — `EMBEDDINGS_REINDEX: "2/day"`.
- `backend/app/config.py` — `embeddings_disabled: bool = False`,
  `embeddings_daily_cap: int = 50000`,
  `embeddings_model: str = "text-embedding-004"`,
  `embeddings_dimension: int = 768`.

### Data model changes

- `groups/{gid}.embeddingsEnabled: bool` — leader-editable later
  via T54 org admin; for v1, system-set by org default. Rule
  extends `groups/{gid}` update `onlyChanges` to allow this field.
- Typesense schema (the message collection from T28) gains:
  ```json
  { "name": "vector", "type": "float[]", "num_dim": 768, "optional": true }
  ```
- `embedding_jobs/{jobId}` — backend-only:
  ```ts
  {
    requestedBy: string,
    startDate: string,    // ISO date
    endDate: string,
    modelVersion: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    checkpoint: { lastMessageId: string, lastTimestamp: Timestamp } | null,
    requestedAt: Timestamp,
    completedAt: Timestamp | null,
    countProcessed: int,
    countSkipped: int,
  }
  ```
- `embeddings_state/{YYYY-MM-DD}` — daily quota counter (P8 shape).

### Firestore rule deltas

```
match /embedding_jobs/{jobId} {
  allow read, write: if false;
}
match /embeddings_state/{day} {
  allow read, write: if false;
}
// groups/{gid} update — extend onlyChanges to include
// 'embeddingsEnabled' and pin type.
allow update: if isGroupLeader(gid) && notBanned()
  && onlyChanges([..., 'embeddingsEnabled'])
  && (!('embeddingsEnabled' in changedKeys())
      || request.resource.data.embeddingsEnabled is bool);
```

### Backend interface

`POST /api/admin/embeddings/reindex`:
```python
class ReindexRequest(BaseModel):
    startDate: date
    endDate: date
    modelVersion: str = "text-embedding-004"
class ReindexResponse(BaseModel):
    jobId: str
    estimatedCount: int
```
- **Auth:** platform admin.
- **Rate limit:** `EMBEDDINGS_REINDEX` (2/day).
- Validates range ≤ 30 days. Counts approximate message volume
  via BigQuery view (the same `engagement_weekly` covers it). Writes
  `embedding_jobs/{jobId}`. The Cloud Run job picks it up.
- Audit log `embeddings_reindex_request` with the range.

`GET /api/admin/embeddings/status`:
- Returns daily counts (from `embeddings_state` rollup +
  `engagement_weekly`), cost projection (count × $0.000025 per
  Vertex doc — confirm price at PR time), pending job list, last
  completed job.

### Frontend interface

- `/admin/embeddings` — server-rendered, fetches via the backend
  endpoint above. Shows:
  - Today's count + cost.
  - 30-day chart.
  - Recent jobs list with status.
  - "Recompute date range" form (date pickers, model version
    dropdown).
  - Kill switch banner ("Embeddings are disabled by env var" if
    `EMBEDDINGS_DISABLED=true`).

**Mobile parity (P19):** Web only — admin surface.

### Cloud Functions

`onMessageEmbed.ts`:
1. (P3) idempotency: `messages/{mid}/_embedding_events/{eventId}`.
2. Skip if message is soft-deleted (already filtered by T20's
   moderation pipeline; double-check).
3. Skip if `groups/{gid}.embeddingsEnabled === false`.
4. Skip if `EMBEDDINGS_DISABLED=true` (kill switch via Settings).
5. (P8) circuit breaker + daily cap. Cap key:
   `embeddings_state/<YYYY-MM-DD>`.
6. Call Vertex AI; receive 768-dim vector.
7. Typesense `update_document` with `{ vector: [...] }` keyed by
   message id. Don't overwrite the text.
8. On error: log + record P8 failure; the trigger retries are off
   (`retry: false`), so the embedding is missed. The reindex job
   recovers it.

### Test plan

**Functions (`functions/src/__tests__/onMessageEmbed.test.ts`):**
- `new message embeds and upserts to Typesense`.
- `archived group skips embedding`.
- `disabled group skips embedding`.
- `daily cap exceeded skips and logs embedding_quota_exceeded`.
- `idempotent: re-firing the trigger does not double-embed`.

**Backend (`backend/tests/test_admin_embeddings.py`):**
- `reindex with a 31-day range returns 400 invalid_range`.
- `reindex from non-admin returns 403`.
- `status endpoint reports daily count and projected cost`.

**Cloud Run job (`infra/scheduled/test_reembed_messages.py`):**
- `idempotent: rerun completes without re-embedding completed messages`.
- `checkpoint resume: SIGTERM mid-run, resume from checkpoint`.

**Rules (`firestore/tests/embeddings.rules.test.ts`):**
- `client cannot read or write embeddings_state`.
- `leader can toggle embeddingsEnabled`.

### Edge cases / gotchas

- **Vector dimension upgrade.** When Vertex releases a new model
  with 1024 dims, the entire Typesense vector field has to be
  reindexed. Document the upgrade procedure: (1) deploy new
  schema with `embedding_v2: float[768]` or `[1024]`; (2)
  reindex via the job; (3) cut over reads (T46) to the new
  field; (4) drop the old field. v1 keeps a single `vector` field.
- **Embedding for a deleted message.** The reindex job skips
  `deletedAt != null` rows. Live trigger also skips (T20 chain).
- **Embeddings for non-English messages.** Vertex
  `text-embedding-004` is multilingual; quality is best for
  English but acceptable for Spanish (relevant for T61). Document.
- **Cost spikes.** A typo in `embeddings_daily_cap=500000` could
  burn budget. Set the env var via Secret Manager only; require
  PR review to change the default in `config.py`.
- **Typesense partial upsert.** Confirm the Typesense version
  pinned in `infra/typesense.tf` supports
  `update_document`. The Phase 2 review L11 defers digest
  pinning; pin to a known version that supports
  `upsert: 'update'`.
- **Soft-deletion later.** When a message is soft-deleted, the
  `onMessageIndex.ts` trigger removes the doc from Typesense
  entirely. The vector goes with it. No special handling needed.
- **Reindex while live trigger fires.** Both write to the same
  Typesense doc. Last-write-wins; both write the same vector
  for the same message body — idempotent.
- **PII.** Never log the message body; log
  `vector.length`, `cacheable: false`, `messageId`.

### Migration / rollout

- Feature flag: `embeddings_enabled` (T58). Default 0% → 10% → 100%.
- Back-fill via the reindex job, in 1-day windows, after the
  flag reaches 100%.
- Env vars: `EMBEDDINGS_DISABLED`, `EMBEDDINGS_DAILY_CAP`,
  `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSION`.

### Dependencies

- T20 (moderation chain), T28 (Typesense sidecar).
- Consumed by T46, T47.

### Estimated complexity

Medium (new trigger, new Cloud Run job, admin UI, Typesense schema
migration). One Sonnet session, ~2 days.

---

## T46 — Semantic message search (vector sidecar) — **Opus**

**Goal:** Extend the T28 search bar with a "Search by meaning" toggle.
Backed by Typesense vector search using T45 embeddings, scoped to
the same per-group permission boundary T28 established. Hybrid
mode (keyword + semantic, reciprocal rank fusion) is the default.

### Why Opus

T28's ADR explicitly warned against shortcuts that cross the
per-group permission boundary. Vector search returns broader recall
than keyword search, so a permission bug here leaks more. The
per-query embedding-on-the-fly + the filter_by groupId clause are
both load-bearing — get either wrong and a non-member of group A
can retrieve a contextually-similar message from group A by
querying group B. Sonnet would likely build the query without re-
reading the T28 ADR.

### Acceptance criteria

- Searching "feeling overwhelmed at work" surfaces messages about
  stress / anxiety even when literal words don't match (verified
  against a 50-message hand-built fixture with a 10-query relevance
  test).
- A user not in group `g1` cannot retrieve a `g1` message via
  semantic or hybrid search (integration test mirroring T28's).
- Semantic mode latency p95 ≤ 800ms in dev with a 10k-message
  corpus.
- ADR addendum captures the recall-broadening risk and the
  permission re-verification.
- Telemetry: dashboards show keyword vs. semantic vs. hybrid
  usage split.

### Files to create

- `frontend/components/search/SearchModeToggle.tsx` — three-way
  segmented control: `Hybrid (default) | Words | Meaning`. Tooltip
  copy: "Searches by topic, not exact words."
- `backend/app/services/query_embedding_cache.py` — in-memory
  TTL cache (5 min) for the user's query string → embedding.
  Process-local; consistent reads aren't required.

### Files to modify

- `backend/app/routers/search.py` — extend with `mode` query
  param: `keyword (default current behavior) | semantic | hybrid`.
  When `mode != keyword`, embed the query, then call Typesense
  `multi_search` with `vector_query`. The `filter_by` clause stays
  identical to T28 (`groupId:[g1,g2,...]`).
- `backend/app/services/search.py`:
  - `embed_query(text)` calls Vertex `text-embedding-004` (same
    model as T45 — vector-space alignment is non-negotiable).
  - Typesense vector query: `vector_query: f"vector:({','.join(map(str, vec))}, k:20, distance_threshold:0.6)"`.
  - Hybrid: query both `q` and `vector_query`, merge with
    reciprocal rank fusion (RRF) — `score = sum(1 / (k + rank))`
    across the two result sets, k=60 (industry standard).
- `frontend/components/search/SearchBar.tsx` — render
  `<SearchModeToggle />`; pass `mode` to the hook.
- `frontend/lib/hooks/useSearch.ts` — extend with `mode` argument.
- `frontend/app/search/page.tsx` — render results with a
  "Why this match?" disclosure showing the matched message and
  relevance score (separately for keyword and semantic when
  hybrid).
- `backend/app/limits.py` — `SEARCH_QUERY_SEMANTIC: "20/minute"`.
- `docs/adr/0005-search-sidecar.md` — append the **vector mode
  addendum** (≥ 1 page): permission boundary re-verification,
  cost analysis, RRF explanation, when to ramp from hybrid
  default to pure-semantic, when to add a reranker.

### Data model changes

- **None.** Typesense schema already extended in T45.

### Firestore rule deltas

- **None.** Permission boundary stays in the backend (T28 pattern).

### Backend interface

`GET /api/search?q=...&mode=hybrid`:
```python
class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=200)
    mode: Literal["keyword", "semantic", "hybrid"] = "hybrid"
    cursor: str | None = None
    limit: int = 20
class SearchResult(BaseModel):
    messageRef: str
    groupId: str
    snippet: str
    score: float
    matchType: Literal["keyword", "semantic", "hybrid"]
class SearchResponse(BaseModel):
    results: list[SearchResult]
    nextCursor: str | None
```
- **Auth:** signed-in.
- **Rate limit:**
  - `SEARCH_QUERY` (30/min) for keyword.
  - `SEARCH_QUERY_SEMANTIC` (20/min) for semantic / hybrid.
  - **Apply the tighter limit** when `mode != keyword`.
- **Behavior:**
  1. Resolve user's group ids via the CG members query
     (mirrors T28 — re-use `_resolve_user_groups(uid)`).
  2. Build `filter_by: f"groupId:[{','.join(group_ids)}]"`.
  3. **Keyword:** existing path.
  4. **Semantic:** embed query (cache hit possible), then
     Typesense `multi_search` with `vector_query`. **Pass the
     same `filter_by`** — Typesense applies the filter before
     vector ranking.
  5. **Hybrid:** parallel Typesense calls (one keyword, one
     vector), merge by RRF.
  6. Truncate per `limit`. Return.
- **Telemetry:** log `mode`, `qLength`, `latencyMs`, `resultCount`,
  `nGroups`. **Never log query text.**

### Frontend interface

- **Search bar:** mode toggle defaults to `hybrid`. The user can
  switch to `Words` (keyword) or `Meaning` (semantic-only).
  Persist the user's choice in local storage.
- **Results page:** for hybrid results, show a small
  badge per result: "📝 word match" (keyword), "💡 topic match"
  (semantic), "✨ both" (intersection).
- **Why this match? disclosure:** click expands to show the
  message body and the relevance score. Scores are
  contextualized: `Score: 0.78 (high)` etc.

**Mobile parity (P19):** Mobile gets the same toggle once T46 is
fully ramped. Until then, mobile fallback to keyword only with a
"Open in browser for semantic" link.

### Cloud Functions

- **None.** Search runs entirely in the backend.

### Test plan

**Backend (`backend/tests/test_search_semantic.py`):**
- `semantic mode embeds and queries Typesense with filter_by`.
- `non-member cannot retrieve a g1 message via semantic search`.
- `non-member cannot retrieve via hybrid even if group is in their list of memberships from a different group`.
- `RRF merge produces the same ordering as a hand-computed example`.
- `query embedding cache hits the second time within 5 min`.

**Frontend (`frontend/tests/search.test.tsx`):**
- `mode toggle switches the request mode`.
- `result badge reflects matchType`.

**Relevance test (CI fixture, gated):**
- 50 hand-curated messages + 10 queries with expected top-3.
  Pass if mean reciprocal rank (MRR) ≥ 0.7.

### Edge cases / gotchas

- **Permission boundary.** The `filter_by` is the load-bearing
  guard. **Never relax to a less-strict filter to "improve recall."**
  ADR addendum makes this explicit.
- **Query embedding caching.** Process-local cache OK because
  staleness is fine (the same query string → same vector
  every time). 5-min TTL keeps memory bounded.
- **Empty query string.** Reject with 400 (already handled by
  zod min_length).
- **Special chars / SQL injection.** Typesense is an HTTP API;
  the body is JSON. The query string flows as a JSON value, not
  as a query language. No injection surface.
- **Score scale across keyword vs. semantic.** Keyword scores
  are BM25-ish (unbounded); semantic scores are cosine
  similarity in [0, 1]. Don't show raw scores; show buckets
  ("high / medium / low").
- **Dim mismatch.** If T45 ever rolls a new dimension, this
  endpoint must read the Typesense schema and fail with a
  clear error if the query embedding doesn't match. Add a
  startup self-test.
- **Cost.** Each semantic query embeds the user's query (one
  Vertex call). Daily cap shared with T45's quota. Track in
  the same `embeddings_state` doc.
- **Banned user.** Existing T28 path already short-circuits;
  confirm semantic respects it.

### Migration / rollout

- Feature flag: `semantic_search_enabled` (T58). Default 0% →
  10% → 100%. Hybrid is the default mode for users in the cohort.
- Env vars: `SEMANTIC_SEARCH_DISABLED` (kill switch override).

### Dependencies

- T28 (search sidecar), T45 (embeddings).
- Cross-task: T54 (per-org disable
  via `orgs/{orgId}.semanticSearchEnabled`).

### Estimated complexity

Medium (extends existing search, RRF math, ADR addendum,
relevance test). One Opus session, ~2 days.

---

## T47 — Prayer-request clustering and "praying for" matching — **Opus**

**Goal:** A weekly job clusters open prayer-tagged messages across
a leader's groups (within the same org) and surfaces a leader-only
digest. Inside a group, an opt-in "Praying for this" surface lets
members commit to a request and receive a quiet reminder.

### Why Opus

This is the most theologically sensitive surface in Phase 3. The
risk is non-cosmetic:

- **False matches** ("grief about a death" clustered with
  "joy at a birth") cause genuine harm.
- **Public counts on a prayer request** ("12 people are praying
  for this") create social pressure and hierarchy of "popular"
  requests.
- **Cross-org clustering** would expose private requests across
  org boundaries — a hard no.

The architectural patterns are known (P10 guardrail, P3 trigger,
P8 quota); the *opt-in stance, the no-counts-shown decision, and
the org-scoped boundary* are the judgment calls. Pair with a
real pilot leader review of the prompt + sample clusters before
the job goes live (acceptance criterion).

### Acceptance criteria

- The clustering job run against a fixture of 50 prayer messages
  across 2 groups produces clusters that pass the theological-
  soundness checklist (no inappropriate cross-categorization).
- A member committing to "praying for" a request creates the doc;
  weekly reminder fires (verified with clock injection); the
  committing user is NOT disclosed to the requester.
- Leader digest is visible only inside the org boundary; cross-org
  clustering is forbidden by query construction.
- Kill switch: `PRAYER_CLUSTERING_DISABLED=true` → job no-ops;
  per-org disable toggles work.
- ADR captures the theological framing.
- Runbook checklist signed off by a real pilot leader before
  flag-on in production (recorded in PR description).

### Files to create

- `infra/scheduled/prayer_clustering.py` — weekly Cloud Run job
  (Saturday 16:00 UTC).
- `backend/app/services/prayer_clustering.py` — embedding-based
  clustering logic. DBSCAN with `eps` tuned per the ADR (default
  cosine distance threshold 0.25; `min_samples=2`).
- `backend/app/services/prompts/prayer_summary.py` — prompt for
  the cluster-summary draft (model: Claude Sonnet 4.6).
- `backend/app/routers/prayer.py` — endpoints for the leader
  digest + per-cluster actions (dismiss, edit summary).
- `frontend/components/chat/PrayingForButton.tsx` — opt-in
  commit button on a `prayer`-tagged message.
- `frontend/app/groups/[gid]/prayer/page.tsx` — group prayer
  feed.
- `frontend/app/leaders/digest/page.tsx` — leader weekly
  cluster digest, scoped to the org.
- `docs/runbooks/prayer-clustering-tuning.md` — eval set,
  theological-soundness checklist (the *exact* checklist that
  the pilot leader signs).
- `docs/adr/0006-prayer-clustering.md` — why opt-in, why
  org-scoped, theological framing.

### Files to modify

- `groups/{gid}/messages/{mid}.prayerCluster: string | null` —
  cluster id (system-set). Rule: client cannot write.
- `firestore.rules` — extend the message update branches with a
  system-only branch that allows the Admin SDK to write
  `prayerCluster` (already implicit — Admin SDK bypasses; but
  document).
- `infra/scheduler.tf` — schedule the weekly job.
- `backend/app/limits.py` — `PRAYER_DIGEST_DISMISS: "30/hour"`.
- `backend/app/config.py` — `prayer_clustering_disabled: bool = False`,
  `prayer_clustering_eps: float = 0.25`.

### Data model changes

- `groups/{gid}/messages/{mid}.prayerCluster: string | null` —
  cluster id; nullable. System-set.
- `prayer_clusters/{clusterId}` (top-level):
  ```ts
  {
    orgId: string,                 // null for unaffiliated single-group clusters
    groupIds: string[],
    messageRefs: string[],
    summary: {
      text: string,
      savedBy: string | null,      // null until leader edits
      modelDraftHash: string,
      promptVersion: string,
      promptVersionLabel: string,
      model: string,
      edited: bool,
    },
    createdAt: Timestamp,
    weekIso: string,               // e.g. '2026-W18'
    dismissedBy: string[],         // per-leader dismissal
    closedAt: Timestamp | null,
  }
  ```
- `users/{uid}/prayingFor/{messageId}` — owner-only doc:
  ```ts
  { committedAt: Timestamp, lastReminderAt: Timestamp | null }
  ```
- `orgs/{orgId}.prayerClusteringEnabled: bool` — default false.
- `groups/{gid}.prayerClusteringEnabled: bool` — for unaffiliated
  groups. Default false.

### Firestore rule deltas

```
match /prayer_clusters/{clusterId} {
  // Read by leaders of any group in clusterId.groupIds, or by
  // org admins of clusterId.orgId. Backend-only writes.
  allow read: if isSignedIn() && (
    request.auth.token.admin == true
    || (resource.data.orgId != null
        && exists(/databases/$(database)/documents/orgs/$(resource.data.orgId)/admins/$(request.auth.uid)))
    // Per-group leader read: hard to express in CEL across an
    // unbounded array. Pragmatic: gate behind backend endpoint.
    // The rule allows org-admin reads only; member groups do
    // backend reads.
  );
  allow create, update, delete: if false;
}

match /users/{uid}/prayingFor/{messageId} {
  allow read: if isUser(uid);
  allow create: if isUser(uid) && notBanned()
    && request.resource.data.keys().hasOnly(['committedAt'])
    && request.resource.data.committedAt == request.time;
  allow update: if false;       // backend updates lastReminderAt
  allow delete: if isUser(uid);
}
```

### Backend interface

`GET /api/leaders/digest`:
```python
class DigestRequest(BaseModel):
    weekIso: str | None = None  # default: current week
class ClusterSummary(BaseModel):
    clusterId: str
    summary: str
    messageRefs: list[str]
    edited: bool
    dismissed: bool             # whether THIS leader has dismissed
class DigestResponse(BaseModel):
    weekIso: str
    clusters: list[ClusterSummary]
```
- **Auth:** group leader of any group, OR org admin.
- **Rate limit:** standard (60/min).
- Resolves the user's leader-of groups (CG members where role=leader).
  Resolves the org ids those groups belong to. Loads
  `prayer_clusters` filtered to those orgs/groups for the week.

`POST /api/clusters/{clusterId}/summary`:
- Save edited summary (mirrors T44 contract — leader-canonical override).

`POST /api/clusters/{clusterId}/dismiss`:
- Adds the calling leader uid to `dismissedBy`.

### Frontend interface

- **Group prayer feed (`/groups/[gid]/prayer`):**
  - Lists open prayer-tagged messages in the group.
  - "Praying for this" button on each message (writes
    `users/{uid}/prayingFor/{messageId}`).
  - The requester does NOT see a count of committers.
- **Leader digest (`/leaders/digest`):**
  - This-week's clusters with summary, member message refs.
  - Per-cluster "Edit summary" → `<ThreadSummaryPanel>` style
    flow (P10).
  - Per-cluster "Dismiss" (per-leader).

**Mobile parity (P19):** "Praying for" button mobile-parity. Leader
digest is web-only (deferred to Phase 3.5 for mobile).

### Cloud Functions

- **None.** The job is a Cloud Run scheduled job (heavier
  workload than a function).

### Test plan

**Backend (`backend/tests/test_prayer_clustering.py`):**
- `clustering on a 50-message fixture across 2 groups in same org produces 3 expected clusters`.
- `clustering across 2 groups in different orgs returns separate clusters per org`.
- `cluster summary draft endpoint works`.
- `dismiss adds caller uid to dismissedBy`.
- `theological-soundness checklist` (manual review fixture; CI
  surfaces a checklist for human sign-off in PR).
- `disabled at org level → no clusters created for that org`.

**Cloud Run job (`infra/scheduled/test_prayer_clustering.py`):**
- `idempotent: rerunning same week reuses existing clusters (does not double-create)`.
- `kill switch flips → job exits cleanly`.

**Rules (`firestore/tests/prayer.rules.test.ts`):**
- `member can read their own prayingFor`.
- `member cannot read another user's prayingFor`.
- `member cannot write to prayer_clusters`.
- `org admin can read prayer_clusters in their org`.

### Edge cases / gotchas

- **No public counts.** The requester never sees how many people
  committed to praying. The button shows "I'll pray for this"
  before commit and "Praying" after — no number.
- **Cross-org clustering forbidden by query.** The clustering
  query iterates orgs; each org's messages are clustered
  independently. Add an integration test that places two
  identical messages in two different orgs and asserts they end
  in separate clusters.
- **Unaffiliated single-group clusters.** Allowed within the
  group only. `orgId` is null; clusters never bridge groups
  without an org.
- **Reminder schedule.** Once a week per `prayingFor` doc, max.
  Use `lastReminderAt` to dedup. Reminders write `notification`
  rows with `kind: "praying_reminder"` (extend P7).
- **Closed / answered prayer.** The requester (only) can mark a
  prayer "closed" (`closedAt = serverTimestamp`). Reminders stop;
  the cluster might surface "X requests in this cluster have
  been closed" in a future digest (Phase 4).
- **Cluster size 1.** Drop. Single-message clusters aren't
  useful.
- **Cluster summary safety.** Same as T44: leader-canonical
  override, never auto-publish.
- **Leader who is also a member.** Their `prayingFor` is private
  to them; their leader powers don't expose committers.
- **Banned committer.** `prayingFor` writes are gated by
  `notBanned()`; reminders skip banned recipients.
- **Cluster eps tuning.** Document the trade-off:
  - Lower eps (e.g. 0.18): tighter clusters; fewer false
    matches; many singletons.
  - Higher eps (e.g. 0.35): looser; more matches; more risk of
    grief-and-joy collisions.
  Default 0.25; the runbook records the eval set's MRR / purity.
- **Audit.** Every cluster save / dismiss writes audit_log.

### Migration / rollout

- Feature flag: `prayer_clustering_enabled` (T58).
- Per-org enable: org admin opts in via the org settings page
  (T54), recorded in `orgs/{orgId}.prayerClusteringEnabled`.
- Pre-launch: pilot leader signs the runbook checklist (PR body).
- Env vars: `PRAYER_CLUSTERING_DISABLED`, `PRAYER_CLUSTERING_EPS`.

### Dependencies

- T06 (stickers — `prayer` slug), T08 (chat), T35 (digest /
  notification fan-out), T45 (embeddings).
- Cross-task: T54 (org), T44 (leader-canonical pattern).

### Estimated complexity

Large (clustering service, weekly job, theological eval). One to
two Opus sessions, ~3 days. The first day is the pilot review
loop, not coding.

---

## T48 — Presence + typing indicators (per-group, leader-toggleable) — Sonnet

**Goal:** "Online now" + Slack-style typing indicators inside a group
chat, leader-toggleable per group. Built on Realtime Database (RTDB)
for ephemeral state — Phase 2 deliberately deferred this; group
sizes now justify it.

### Acceptance criteria

- Opening the group chat in two tabs as different users shows both
  online within 3s.
- Closing the tab clears presence within 30s (RTDB `onDisconnect`).
- Typing in the input shows the indicator on the other tab within
  1s; stopping for 6s clears it.
- Disabling presence for the group as a leader hides the
  indicators and stops the writes.
- RTDB rules deny writes from a non-member of the group.

### Files to create

- `infra/firebase-rtdb-rules.json` — RTDB rules for
  `/presence`, `/typing`, `/memberships`.
- `frontend/lib/firebase.ts` — extend with RTDB init
  (`getDatabase(app)`).
- `frontend/lib/hooks/usePresence.ts` — subscribes to
  `/presence/{gid}/*`; writes own presence on mount and
  `onDisconnect` clears.
- `frontend/lib/hooks/useTyping.ts` — subscribes to
  `/typing/{gid}/*`; writes own typing on input change with
  debouncing.
- `frontend/components/chat/PresenceBar.tsx` — count + names on
  hover.
- `frontend/components/chat/TypingIndicator.tsx`.
- `mobile/lib/hooks/usePresence.ts`,
  `mobile/lib/hooks/useTyping.ts`,
  `mobile/components/chat/PresenceBar.tsx`,
  `mobile/components/chat/TypingIndicator.tsx`.
- `firestore/tests/rtdb.rules.test.ts` — new RTDB rules tests.
- `firebase.json` — add `database` config block.

### Files to modify

- `firestore.rules` — no changes here. Members live in Firestore
  but the RTDB needs the mirror.
- `functions/src/onMemberWrite.ts` — extend to write
  `/memberships/{uid}/{gid}: true` to RTDB on member create,
  remove on delete. Idempotent (per P3) — the RTDB write is a
  fixed value; second write is a no-op.
- `groups/{gid}.presenceEnabled: bool` — default true; rule
  extends `onlyChanges` to allow leader edits.
- `infra/firebase.json` — declare RTDB rules path.
- `docs/data-model.md` — document RTDB paths and
  `/memberships/` mirror.
- `docs/runbooks/realtime-database.md` — new runbook: when RTDB
  is used, how to deploy rules, monitoring.

### Data model changes

- **Firestore:**
  - `groups/{gid}.presenceEnabled: bool` (leader-editable).
- **RTDB:**
  - `/presence/{gid}/{uid}: { lastSeenAt: number, status: "online" | "offline" }`.
  - `/typing/{gid}/{uid}: { startedAt: number }` (deleted on stop).
  - `/memberships/{uid}/{gid}: true`.

### Firestore rule deltas

```
allow update: if isGroupLeader(gid) && notBanned()
  && onlyChanges([..., 'presenceEnabled'])
  && (!('presenceEnabled' in changedKeys())
      || request.resource.data.presenceEnabled is bool);
```

### RTDB rule deltas

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "memberships": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        "$gid": { ".write": "auth.token.admin == true" }
      }
    },
    "presence": {
      "$gid": {
        ".read": "auth != null && root.child('memberships').child(auth.uid).child($gid).exists()",
        "$uid": {
          ".write": "auth != null && auth.uid == $uid && root.child('memberships').child($uid).child($gid).exists()",
          ".validate": "newData.hasChildren(['lastSeenAt','status']) && newData.child('status').isString() && (newData.child('status').val() === 'online' || newData.child('status').val() === 'offline')"
        }
      }
    },
    "typing": {
      "$gid": {
        ".read": "auth != null && root.child('memberships').child(auth.uid).child($gid).exists()",
        "$uid": {
          ".write": "auth != null && auth.uid == $uid && root.child('memberships').child($uid).child($gid).exists()",
          ".validate": "newData.hasChildren(['startedAt'])"
        }
      }
    }
  }
}
```

### Backend interface

- **None new.** Presence + typing flow entirely client → RTDB.

### Frontend interface

- **`usePresence(gid)` hook:**
  1. On mount: write `/presence/{gid}/{uid}: { lastSeenAt: serverTimestamp, status: "online" }`.
  2. Set `onDisconnect()` to update to `offline`.
  3. Subscribe to `/presence/{gid}` for the count.
  4. Heartbeat every 60s (re-write `lastSeenAt`).
  5. On unmount: clear `onDisconnect` and write `offline`
     immediately.
- **`useTyping(gid)`:**
  1. On input change → debounced write
     `/typing/{gid}/{uid}: { startedAt: serverTimestamp }`.
  2. After 5s of no input → delete the entry.
  3. Subscribe to `/typing/{gid}`; readers drop entries older
     than 8s defensively.
- **`<PresenceBar>`:** count of online members; hover → list of
  display names.
- **`<TypingIndicator>`:** "Alice is typing..." up to 2 names,
  then "and N others".
- **Disabled state:** if `groups/{gid}.presenceEnabled === false`,
  the hooks no-op and the components render nothing.

**Mobile parity (P19):** Same hooks (different RN imports). The
`onDisconnect` setup uses `firebase().database()` from
`@react-native-firebase/database`.

### Cloud Functions

`onMemberWrite.ts` extension:
- On create: write `/memberships/{uid}/{gid}: true` to RTDB.
- On delete: `set null` on the same path.
- Idempotent: the value is a constant; same write twice is
  identical.

### Test plan

**Frontend (`frontend/tests/presence.test.tsx`):**
- `usePresence writes online on mount and offline on unmount`.
- `usePresence respects presenceEnabled === false`.
- `useTyping debounces and clears after 5s`.

**Mobile mirrors.**

**Functions:**
- `onMemberWrite writes RTDB membership mirror on create`.
- `onMemberWrite removes RTDB membership mirror on delete`.

**RTDB Rules (`firestore/tests/rtdb.rules.test.ts`):**
- `member of group can write own presence`.
- `non-member cannot write presence even if uid matches`.
- `member cannot write someone else's presence`.
- `non-member cannot read presence`.

### Edge cases / gotchas

- **RTDB region.** Pin to `us-central1` to match Firestore. RTDB
  uses different region semantics — document.
- **`onDisconnect` reliability.** On Wi-Fi drop, RTDB fires the
  on-disconnect within ~30s; on hard kill (force-quit), within
  ~60s. The 60s heartbeat catches stragglers (presence with
  `lastSeenAt > now - 90s` considered online; older = offline
  client-side filter).
- **Typing flicker.** A user typing "h" then deleting → write,
  then 5s later delete. Avoid spam-writes on every keystroke;
  the hook only writes if the previous typing record is > 2s
  old.
- **Leader toggle propagation.** Switching `presenceEnabled` to
  false: clients listening to `groups/{gid}` see the change,
  hooks no-op on next render, existing presence entries remain
  in RTDB until `onDisconnect` cleans them up. Hooks ALSO
  delete their own presence entry on the toggle (one-shot
  cleanup).
- **Cost.** RTDB pricing is per concurrent connection + transfer.
  Document expected scale (group size × active sessions); flag
  if scale changes.
- **A11y.** Typing indicators must be `aria-live="polite"` and
  not interrupt screen-reader users. Reduced-motion: hide the
  bouncing-dot animation. (T62 hook.)
- **Mute/block.** Don't show muted/blocked users in presence
  count or typing list. Filter client-side (Firestore mute/block
  is the source of truth; RTDB doesn't have the data).

### Migration / rollout

- Feature flag: `presence_enabled` (T58). Default 0% → 50% → 100%.
- Existing groups don't have `presenceEnabled` field — treat
  absent as `true`. Backend can backfill, but rules treat
  `null/absent` as `true`.

### Dependencies

- T07 (groups), T08 (chat).
- Cross-task: T50 (RTDB infra), T57 (RTDB infra), T62 (a11y).

### Estimated complexity

Medium (RTDB introduction is non-trivial; rules new; mobile
parity; member mirror trigger). One Sonnet session, ~1.5 days.

---

## T49 — Scheduled events — prayer times, attendance, RSVPs — Sonnet

**Goal:** A leader schedules an event (prayer time, study, gathering).
Members RSVP, get a reminder push (T41), check in at event time.
Attendance feeds the leader analytics (T60).

### Acceptance criteria

- Leader creates a recurring weekly prayer time; the next 4
  occurrences are visible.
- A member RSVPing "going" receives a push reminder 60 min before
  in dev (verified by clock injection).
- Check-in flow accepts taps within the window and rejects
  outside; check-in writes `attended: true` and feeds T60.
- Non-leader cannot create / update / delete events.
- ICS file opens in Apple Calendar with right time, title,
  location.

### Files to create

- `groups/{gid}/events/{eventId}` — new subcollection.
- `groups/{gid}/events/{eventId}/rsvps/{uid}` — new subcollection.
- `frontend/app/groups/[gid]/events/page.tsx` (list).
- `frontend/app/groups/[gid]/events/[eventId]/page.tsx` (detail).
- `frontend/components/events/EventCard.tsx`,
  `EventForm.tsx`, `RsvpButtons.tsx`, `CheckInButton.tsx`,
  `RecurrencePicker.tsx`.
- `frontend/lib/hooks/useEvents.ts`, `useEvent.ts`,
  `useRsvp.ts`.
- `infra/scheduled/event_reminders.py` — runs every 15 min;
  finds events starting in next [60, 75) min window where the
  reminder hasn't been sent; fires notifications.
- `mobile/app/(authed)/groups/[gid]/events/index.tsx`,
  `[eventId].tsx`.
- `backend/app/routers/calendar.py` —
  `GET /api/groups/{gid}/events/{eventId}.ics`.
- `backend/app/services/ics.py` — RFC 5545 ICS file builder.

### Files to modify

- `firestore.rules` — events + rsvps rules.
- `firestore.indexes.json` — composite index
  `events.startsAt` ASC + `events.deletedAt` ASC for the next-N
  query.
- `infra/scheduler.tf` — schedule the reminder job every 15 min.
- `backend/app/limits.py` — `EVENT_CREATE`, `EVENT_RSVP`.
- `backend/app/config.py` — `event_reminders_disabled: bool = False`.

### Data model changes

- `groups/{gid}/events/{eventId}`:
  ```ts
  {
    title: string,                 // ≤ 200
    description: string,           // ≤ 2000
    startsAt: Timestamp,
    endsAt: Timestamp,
    location: string | null,       // ≤ 500
    recurrence: { kind: 'weekly' | 'biweekly', count: number, until: Timestamp | null } | null,
    createdBy: string,
    createdAt: Timestamp,
    deletedAt: Timestamp | null,
    reminderSentAt: Timestamp | null,  // for the recurrence root; child events set their own
    parentEventId: string | null,  // links recurrence-generated events
    occurrenceIndex: number,       // 0-based for children
  }
  ```
- `groups/{gid}/events/{eventId}/rsvps/{uid}`:
  ```ts
  {
    status: 'going' | 'maybe' | 'no',
    respondedAt: Timestamp,
    attended: bool | null,
    checkedInAt: Timestamp | null,
  }
  ```

### Firestore rule deltas

```
match /groups/{gid}/events/{eventId} {
  allow read: if isGroupMember(gid);

  allow create: if (isGroupLeader(gid) || groupOrgAdmin(gid)) && notBanned()
    && get(/databases/$(database)/documents/groups/$(gid)).data.get('archivedAt', null) == null
    && request.resource.data.keys().hasOnly([
         'title','description','startsAt','endsAt','location',
         'recurrence','createdBy','createdAt','deletedAt',
         'reminderSentAt','parentEventId','occurrenceIndex'])
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.createdAt == request.time
    && request.resource.data.deletedAt == null
    && request.resource.data.title is string
    && request.resource.data.title.size() >= 1
    && request.resource.data.title.size() <= 200
    && request.resource.data.description is string
    && request.resource.data.description.size() <= 2000
    && request.resource.data.startsAt is timestamp
    && request.resource.data.endsAt is timestamp
    && request.resource.data.startsAt < request.resource.data.endsAt
    && (!('location' in request.resource.data)
        || request.resource.data.location == null
        || (request.resource.data.location is string
            && request.resource.data.location.size() <= 500));

  allow update: if (isGroupLeader(gid) || groupOrgAdmin(gid)) && notBanned()
    && onlyChanges(['title','description','startsAt','endsAt',
                    'location','deletedAt','reminderSentAt']);

  allow delete: if false;
}

match /groups/{gid}/events/{eventId}/rsvps/{uid} {
  allow read: if isGroupMember(gid);

  allow create: if isUser(uid) && isGroupMember(gid) && notBanned()
    && request.resource.data.keys().hasOnly(['status','respondedAt','attended','checkedInAt'])
    && request.resource.data.status in ['going','maybe','no']
    && request.resource.data.respondedAt == request.time
    && request.resource.data.attended == null
    && request.resource.data.checkedInAt == null;

  allow update: if isUser(uid) && isGroupMember(gid) && notBanned()
    && (
      // Member updates RSVP status.
      (onlyChanges(['status','respondedAt'])
        && request.resource.data.status in ['going','maybe','no']
        && request.resource.data.respondedAt == request.time)
      // Member checks in within the window.
      || (onlyChanges(['attended','checkedInAt'])
        && request.resource.data.attended == true
        && request.resource.data.checkedInAt == request.time
        && request.time >= get(/databases/$(database)/documents/groups/$(gid)/events/$(eventId)).data.startsAt - duration.value(15, 'm')
        && request.time <= get(/databases/$(database)/documents/groups/$(gid)/events/$(eventId)).data.startsAt + duration.value(15, 'm'))
    );

  // Leader manual mark-attendance — backend only.
  allow delete: if false;
}
```

### Backend interface

- `GET /api/groups/{gid}/events/{eventId}.ics`:
  - **Auth:** group member.
  - Builds RFC 5545 ICS file: `BEGIN:VCALENDAR ... END:VCALENDAR`.
  - One `VEVENT` per occurrence (recurrence expanded server-side).
  - `Content-Type: text/calendar; charset=utf-8`,
    `Content-Disposition: attachment; filename="event.ics"`.
- `POST /api/groups/{gid}/events/{eventId}/manual-attendance`:
  - **Auth:** leader / org admin.
  - **Body:** `{ uid: string, attended: bool }`.
  - Writes the rsvp doc field via Admin SDK.
  - Audit log `event_manual_attendance`.

### Frontend interface

- **Events list:** Group nav adds "Events" tab. Cards: title,
  start time (in user's locale), RSVP buttons, count of going.
- **Event detail:** full description, RSVP, "Add to calendar"
  ICS download, leader-only check-in roster.
- **Recurrence picker:** weekly / biweekly only. Document the
  limitation in the runbook.
- **Check-in:** a fat button "I'm here" enabled during the
  ±15 min window.

**Mobile parity (P19):** Native-equivalent UI. Calendar download
uses `expo-file-system` + `expo-sharing`.

### Cloud Functions

- **None new.** Reminder dispatch is a Cloud Run scheduled job,
  not a function. Notification fan-out reuses
  `onNotificationCreate.ts`.

### Reminder job

`infra/scheduled/event_reminders.py`:
1. (P8) circuit breaker + kill switch.
2. Query: `events.where('startsAt', '>=', now).where('startsAt', '<=', now + 75min)`.
3. For each, skip if `reminderSentAt != null`.
4. For each `rsvp.status === 'going'`:
   - Skip if banned.
   - Write `users/{uid}/notifications/{nid}` with
     `kind: "event_reminder"`, `body: title`,
     `groupId: gid`, `messageRef` null, `data: { eventRef, startsAt }`.
5. Set `reminderSentAt = serverTimestamp()` transactionally.
6. (P3-style) idempotency via the field — second run skips.

### Test plan

**Backend (`backend/tests/test_events.py`):**
- `non-leader cannot create event (rules tested separately)`.
- `manual-attendance writes attended bool`.

**Frontend (`frontend/tests/events.test.tsx`):**
- `RSVP buttons toggle status`.
- `check-in disabled outside the window`.
- `recurring weekly shows next 4 occurrences`.

**Rules (`firestore/tests/events.rules.test.ts`):**
- comprehensive coverage of create/update/delete branches.

**Reminder job (`infra/scheduled/test_event_reminders.py`):**
- `fires once per RSVP'd-going user`.
- `does not re-fire after reminderSentAt is set`.
- `clock-injection: now within window triggers send`.

### Edge cases / gotchas

- **Recurrence storage.** Generate child events at create time
  (max 12 weeks ahead). Document — full RRULE is overkill.
- **Time zones.** Store `startsAt` / `endsAt` in UTC; render in
  user's locale (T61).
- **Event in archived group.** Reject create (rule check).
- **Quiet hours:** event reminders bypass quiet hours by default
  (the user RSVP'd; they want to be reminded), but per-kind
  opt-out exists.
- **Cancellation.** `deletedAt = serverTimestamp` soft-deletes;
  reminder job filters by `deletedAt == null`.
- **ICS.** UID per event MUST be stable
  (`{eventId}@jacob.app`); calendars dedup on UID. For
  recurrences, use one UID + RRULE if calendar supports;
  otherwise per-occurrence.

### Migration / rollout

- Feature flag: `events_enabled` (T58).
- Env vars: `EVENT_REMINDERS_DISABLED`.

### Dependencies

- T07 (groups), T22 (leader role), T34 + T41 (push reminders).
- Cross-task: T60 (analytics).

### Estimated complexity

Medium-large (new collection, recurrence, scheduled job, ICS).
One Sonnet session, ~2 days.

---

## T50 — Watch Together — synchronized YouTube playback — Sonnet

**Goal:** A group member starts a "Watch Together" session for a
YouTube video; other members join and playback stays synchronized.
Built on YouTube IFrame Player API + RTDB for sync state.

### Acceptance criteria

- Two members in different tabs join a watch session; pausing as
  the leader pauses the follower within 3s.
- Seeking forward 30s on the leader pulls follower within 3s.
- The follower cannot pause/seek; only the leader can.
- Watch session writes a Firestore record with attendees +
  duration for T60 analytics.
- Mobile playback works for an embeddable YouTube video.

### Files to create

- `groups/{gid}/watch_sessions/{sessionId}` — Firestore doc
  (lifecycle metadata).
- `frontend/app/groups/[gid]/watch/[sessionId]/page.tsx`.
- `frontend/components/watch/WatchPlayer.tsx`,
  `WatchControls.tsx`, `WatchChat.tsx`,
  `WatchStartModal.tsx`.
- `frontend/lib/hooks/useWatchSync.ts` — RTDB-backed playback
  state.
- `mobile/app/(authed)/groups/[gid]/watch/[sessionId].tsx` —
  uses `react-native-youtube-iframe`.
- `mobile/lib/hooks/useWatchSync.ts`.
- `backend/app/routers/watch.py` — endpoints for create / end
  session.
- `infra/firebase-rtdb-rules.json` — extend with `/watch/...` rules.

### Files to modify

- `firestore.rules` — `watch_sessions` rules (member read,
  starter creates, members add themselves to attendees, leader
  ends).
- `firestore.indexes.json` — `watch_sessions` ordered by
  `endedAt ASC, createdAt DESC` for "active sessions" listing.
- `backend/app/limits.py` — `WATCH_SESSION_START: "10/hour"`.

### Data model changes

- `groups/{gid}/watch_sessions/{sessionId}`:
  ```ts
  {
    videoId: string,           // 11-char YouTube id
    sourceUrl: string,         // original URL
    title: string | null,      // pulled from oEmbed
    thumbnailUrl: string | null,
    leaderUid: string,         // current leader (transferable)
    createdBy: string,
    createdAt: Timestamp,
    endedAt: Timestamp | null,
    attendees: string[],       // dedup'd uid list
    durationSec: number | null,// computed on end
  }
  ```
- **RTDB:**
  - `/watch/{gid}/{sessionId}: { videoId, paused, positionSec, leaderUid, updatedAt }`.

### Firestore rule deltas

```
match /groups/{gid}/watch_sessions/{sessionId} {
  allow read: if isGroupMember(gid);

  allow create: if isGroupMember(gid) && notBanned()
    && get(/databases/$(database)/documents/groups/$(gid)).data.get('archivedAt', null) == null
    && request.resource.data.keys().hasOnly([
         'videoId','sourceUrl','title','thumbnailUrl',
         'leaderUid','createdBy','createdAt','endedAt',
         'attendees','durationSec'])
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.leaderUid == request.auth.uid
    && request.resource.data.createdAt == request.time
    && request.resource.data.endedAt == null
    && request.resource.data.attendees == [request.auth.uid]
    && request.resource.data.videoId is string
    && request.resource.data.videoId.size() == 11
    && request.resource.data.videoId.matches('[A-Za-z0-9_-]{11}');

  // Member joins → arrayUnion themselves; can update leaderUid only
  // if current leaderUid == auth.uid (leader transfer); end via
  // setting endedAt (any member can end if they're the only one
  // left — but easier: any member can set endedAt to now).
  allow update: if isGroupMember(gid) && notBanned()
    && (
      // Self-add to attendees (no other field changes).
      (onlyChanges(['attendees'])
        && request.resource.data.attendees.hasAll(resource.data.attendees)
        && request.resource.data.attendees.size() == resource.data.attendees.size() + 1
        && request.auth.uid in request.resource.data.attendees)
      // Leader transfer.
      || (onlyChanges(['leaderUid'])
        && resource.data.leaderUid == request.auth.uid)
      // End.
      || (onlyChanges(['endedAt','durationSec'])
        && request.resource.data.endedAt == request.time)
    );

  allow delete: if false;
}
```

### RTDB rule deltas

```json
"watch": {
  "$gid": {
    "$sessionId": {
      ".read": "auth != null && root.child('memberships').child(auth.uid).child($gid).exists()",
      ".write": "auth != null && root.child('memberships').child(auth.uid).child($gid).exists()",
      ".validate": "newData.hasChildren(['videoId','paused','positionSec','leaderUid','updatedAt']) && newData.child('leaderUid').val() === auth.uid"
    }
  }
}
```

The `.validate` clause forces the writer to be the current leader
in their *own* RTDB write. Followers do NOT write playback state.
Followers DO write membership (attendees) to Firestore via the
update branch above.

### Backend interface

- `POST /api/groups/{gid}/watch/start`:
  ```python
  class WatchStartRequest(BaseModel):
      videoUrl: str
  class WatchStartResponse(BaseModel):
      sessionId: str
      videoId: str
      title: str | None
      thumbnailUrl: str | None
  ```
  - **Auth:** group member, archived group rejected.
  - **Rate limit:** `WATCH_SESSION_START`.
  - Validates the URL (must be a youtube.com or youtu.be URL).
  - Extracts the videoId.
  - Calls oEmbed (`https://www.youtube.com/oembed?url=...`)
    via `safe_fetch` (P11) to pull title + thumbnail. On failure
    proceed without metadata (UI tolerates null).
  - Writes the watch_session doc via Admin SDK.
  - The client also writes — but the rule allows it. We use the
    backend so the oEmbed call doesn't expose the client's IP to
    YouTube. Decision: backend-create is the only path.
  - Audit log `watch_session_start`.

### Frontend interface

- **Start modal:** paste URL → backend create → redirect to
  `/groups/[gid]/watch/[sessionId]`.
- **Watch page:**
  - Top: video player (YT IFrame, embedded).
  - Right rail: presence + chat (T48 reuse + thread on
    watch_sessions doc — uses existing thread machinery from T09
    targeting `groups/{gid}/watch_sessions/{sessionId}`'s thread
    parent message id; **decision:** create a synthetic parent
    message at session create with body
    `[Watch Together: <title>]` so the existing thread infra
    works without special-casing).
  - Below: `<WatchControls>` — only the leader sees play / pause
    / seek; followers see "<Leader> is hosting".
- **Sync hook:** RTDB listener; if drift > 2s, jump.

**Mobile parity (P19):** Same flow; uses `YoutubeIframe` from
`react-native-youtube-iframe`. Native player controls are hidden;
we render our own.

### Cloud Functions

- **None.** A small idle-cleanup Cloud Run job (
  `infra/scheduled/cleanup_watch_sessions.py`) runs every 30 min,
  finds sessions where the RTDB `updatedAt` is older than 5 min
  and `endedAt` is null, and sets `endedAt + durationSec`.

### Test plan

**Backend (`backend/tests/test_watch.py`):**
- `start with a valid YouTube URL extracts the right videoId`.
- `start with a non-YouTube URL returns 400`.
- `start in archived group returns 409 archived`.

**Frontend (`frontend/tests/watch.test.tsx`):**
- `follower's player jumps when leader's positionSec changes by > 2s`.
- `follower controls are disabled`.
- `leader transfer updates the leaderUid`.

**Rules (`firestore/tests/watch.rules.test.ts`):**
- comprehensive coverage of create/join/end branches.

**RTDB rules:**
- `non-leader cannot write watch state (validate clause rejects)`.
- `non-member cannot read watch state`.

### Edge cases / gotchas

- **Video unavailable / private.** YouTube IFrame surfaces an
  error event; render a "Video unavailable" card and offer
  "Pick a different video" (kicks back to start modal).
- **Drift threshold.** 2s is the tolerance window; tighter
  causes thrashing on flaky networks.
- **Heartbeat.** Leader's writer publishes every 2s even if
  unchanged; followers use that to detect "leader is gone."
- **Leader transfer on disconnect.** If the leader's RTDB
  presence drops, the session should auto-transfer to the
  oldest-attendee. v1 doesn't auto-transfer; the cleanup job
  handles abandoned sessions. Document.
- **Reactions / chat.** Reuses T26 + T09; the
  `parentMessageId` is the session-pinned message.
- **Mobile background.** When the app backgrounds, the iframe
  player auto-pauses; document.
- **Privacy.** Don't log the video URL or title.
- **Cost.** RTDB writes per session are bounded — 30/min/session.
  Document scale.

### Migration / rollout

- Feature flag: `watch_together_enabled` (T58).
- Env vars: none.

### Dependencies

- T07 (groups), T48 (RTDB infra).
- Cross-task: T52 (sermon archive launches into a Watch Together).

### Estimated complexity

Medium (player sync logic, RTDB orchestration, modest UI). One
Sonnet session, ~2 days.

---

## T51 — Devotionals + reading plans — Sonnet

**Goal:** Library of structured Christian content — daily
devotionals (extends T33), multi-week reading plans (e.g. Gospel of
John in 21 days), per-user progress tracker.

### Acceptance criteria

- A signed-in user browses devotionals and picks a reading plan.
- Marking day 1 complete writes `plan_progress` with
  `completedDays: [1]`, `streak: 1`, `lastCompletedAt`.
- Missing a day with the 1-day grace keeps the streak; missing
  two consecutive days resets to 0.
- Sharing day 5 of "Gospel of John" to group X creates a group
  message with the right card.
- Reading plans live in `infra/seed/` and are loaded by a one-shot
  script committed in this PR.

### Files to create

- `devotionals/{slug}` (top-level Firestore collection):
  ```ts
  {
    title: string,
    scriptureRef: string,
    body: string,                  // markdown — see T53
    audioUrl: string | null,       // link only, not hosted
    sourceAttribution: string,
    publishedAt: Timestamp,
    audience: 'christian' | 'general',
    schemaVersion: 1,
  }
  ```
- `reading_plans/{slug}`:
  ```ts
  {
    title: string,
    description: string,
    days: { dayNumber: int, scriptureRef: string, prompt: string }[],
    duration: int,                 // total days
    audience: 'christian' | 'general',
    publishedAt: Timestamp,
    schemaVersion: 1,
  }
  ```
- `users/{uid}/plan_progress/{planSlug}`:
  ```ts
  {
    planSlug: string,
    startedAt: Timestamp,
    completedDays: number[],
    streak: int,
    lastCompletedAt: Timestamp,
  }
  ```
- `infra/seed/devotionals/` — JSON files, public-domain or
  licensed content.
- `infra/seed/reading_plans/john-21-days.json`,
  `psalms-30-days.json`, etc.
- `infra/scripts/seed_content.py` — load the seed.
- `frontend/app/devotionals/page.tsx`,
  `frontend/app/devotionals/[slug]/page.tsx`.
- `frontend/app/reading-plans/page.tsx`,
  `[slug]/page.tsx`,
  `[slug]/day/[n]/page.tsx`.
- `frontend/components/home/PlanProgressCard.tsx`.
- `frontend/components/devotionals/ShareToGroupDialog.tsx`.
- `mobile/app/(authed)/devotionals/`, `reading-plans/`.

### Files to modify

- `firestore.rules` — read for any signed-in user; writes
  Admin-SDK-only for `devotionals` / `reading_plans`; user-only
  for `plan_progress`.
- `firestore.indexes.json` —
  `devotionals.audience+publishedAt DESC`,
  `reading_plans.audience+publishedAt DESC`.
- `frontend/app/page.tsx` — render PlanProgressCard if active.

### Firestore rule deltas

```
match /devotionals/{slug} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;
}
match /reading_plans/{slug} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;
}
match /users/{uid}/plan_progress/{planSlug} {
  allow read: if isUser(uid);
  allow create, update: if isUser(uid) && notBanned()
    && request.resource.data.keys().hasOnly(
         ['planSlug','startedAt','completedDays','streak','lastCompletedAt'])
    && request.resource.data.planSlug == planSlug
    && request.resource.data.completedDays is list
    && request.resource.data.completedDays.size() <= 365
    && request.resource.data.streak is int
    && request.resource.data.streak >= 0;
  allow delete: if isUser(uid);
}
```

### Backend interface

- **None new.** Reads from Firestore directly. The seed script
  uses Admin SDK.
- `POST /api/groups/{gid}/messages/from-devotional` — optional
  helper that posts a styled card. Decision: do this client-side
  via a regular message create; the message body is markdown
  citing the plan. Backend not needed.

### Frontend interface

- **Devotional list:** category filter (audience), search bar
  (client-side filter — small content set).
- **Plan list:** filter by duration, audience.
- **Plan day page:** scripture ref + prompt; "Mark complete" button.
- **Streak math:** in `useReadingPlan` hook, on mark complete:
  - `today = startOfDayInTz(user.locale)`.
  - `lastCompleted = startOfDayInTz(progress.lastCompletedAt)`.
  - `daysGap = (today - lastCompleted) / day`.
  - If `daysGap === 0` (already completed today): no-op.
  - If `daysGap === 1`: `streak += 1`.
  - If `daysGap === 2`: 1-day grace — `streak += 1`.
  - If `daysGap >= 3`: `streak = 1`.
- **Share to group:** modal lets user pick a group; renders
  preview; submit creates a message with markdown body.

**Mobile parity (P19):** Same.

### Cloud Functions

- **None.**

### Test plan

**Frontend:**
- `mark complete with daysGap=0 no-ops`.
- `mark complete with daysGap=1 increments streak`.
- `mark complete with daysGap=2 still increments (1-day grace)`.
- `mark complete with daysGap=3 resets streak to 1`.

**Rules:**
- `non-owner cannot read another user's plan_progress`.
- `client cannot create a devotional`.

### Edge cases / gotchas

- **Time zone for streak math.** Always compute against the
  user's locale (T61 stores). DST: switching from PDT to PST
  doesn't break the streak math because we compare dates, not
  absolute times.
- **Markdown body in devotionals.** Use the same renderer as
  T53. Don't render images inline (T53 prohibits) — devotional
  body MUST follow the same subset.
- **Audio link.** Don't embed; link out only.
- **Licensed content.** Document attribution requirements per
  source. Public domain only in v1 (KJV, ASV, etc.); licensed
  content in Phase 4.
- **Sharing privacy.** A user sharing day 5 of a plan to a
  private group writes a regular message; T20 moderation runs as
  usual; T28 indexes it.
- **Plan progress as a user-deleted resource.** GDPR delete (T14)
  must clear `plan_progress` — verify in T14's coverage.

### Migration / rollout

- Feature flag: `devotionals_enabled` (T58).
- Seed run via the script in CI for staging; production seeds
  via the same script run in deploy.

### Dependencies

- T33 (daily verse).
- Cross-task: T53 (markdown), T54 (orgs add their own — Phase
  3.5 if pilot asks).

### Estimated complexity

Medium (content modeling + sharing flow + streak math). One
Sonnet session, ~1.5 days.

---

## T52 — Sermon archives — leader-curated playlist — Sonnet

**Goal:** A leader attaches a sermon archive: list of sermon links
(YouTube, podcast feeds) with metadata. Members browse, filter,
launch Watch Together.

### Acceptance criteria

- Leader adds a YouTube URL; title + thumbnail auto-populated.
- Member browses; filters by preacher.
- "Watch with the group" creates a T50 session and routes to it.
- Non-leader cannot add or delete sermons.

### Files to create

- `groups/{gid}/sermons/{sermonId}` — new subcollection.
- `frontend/app/groups/[gid]/sermons/page.tsx`,
  `[sermonId]/page.tsx`.
- `frontend/components/sermons/SermonCard.tsx`,
  `SermonList.tsx`, `WatchTogetherButton.tsx`,
  `SermonForm.tsx`.
- `backend/app/routers/sermons.py` —
  `POST /api/groups/{gid}/sermons` accepts URL; pulls oEmbed.
- `mobile/app/(authed)/groups/[gid]/sermons/index.tsx`,
  `[sermonId].tsx`.

### Files to modify

- `firestore.rules` — sermons rules (read by group members,
  write by leaders, archived-group reject).
- `firestore.indexes.json` — `sermons.deletedAt+date DESC`.
- `backend/app/limits.py` — reuse `BOARD_ADMIN_MUTATION` or add
  `SERMON_MUTATION: "20/hour"`.

### Data model changes

- `groups/{gid}/sermons/{sermonId}`:
  ```ts
  {
    title: string,
    preacher: string,
    scripture: string,
    date: Timestamp,                // sermon date, not added date
    sourceUrl: string,
    sourceType: 'youtube' | 'podcast' | 'other',
    thumbnail: string | null,
    addedBy: string,
    addedAt: Timestamp,
    deletedAt: Timestamp | null,
  }
  ```

### Firestore rule deltas

```
match /groups/{gid}/sermons/{sermonId} {
  allow read: if isGroupMember(gid);

  allow create: if (isGroupLeader(gid) || groupOrgAdmin(gid)) && notBanned()
    && get(/databases/$(database)/documents/groups/$(gid)).data.get('archivedAt', null) == null
    && request.resource.data.keys().hasOnly([
         'title','preacher','scripture','date','sourceUrl',
         'sourceType','thumbnail','addedBy','addedAt','deletedAt'])
    && request.resource.data.addedBy == request.auth.uid
    && request.resource.data.addedAt == request.time
    && request.resource.data.deletedAt == null
    && request.resource.data.sourceType in ['youtube','podcast','other']
    && request.resource.data.sourceUrl is string
    && request.resource.data.sourceUrl.size() <= 1000
    && request.resource.data.sourceUrl.matches('https://.*');

  allow update: if (isGroupLeader(gid) || groupOrgAdmin(gid)) && notBanned()
    && onlyChanges(['title','preacher','scripture','date','thumbnail','deletedAt']);

  allow delete: if false;
}
```

### Backend interface

- `POST /api/groups/{gid}/sermons`:
  ```python
  class SermonCreateRequest(BaseModel):
      sourceUrl: HttpUrl
      title: str | None = None
      preacher: str | None = None
      scripture: str | None = None
      date: date | None = None
  ```
  - **Auth:** leader / org admin.
  - **Rate limit:** `SERMON_MUTATION`.
  - For YouTube URLs: extract videoId, call oEmbed via P11
    `safe_fetch`, populate title/thumbnail. Override with
    user-supplied if present.
  - For other URLs: store as-is; thumbnail null.
  - Audit log `sermon_add`.

### Frontend interface

- **Sermons list:** card grid; filter by preacher (dropdown
  populated from existing sermons), date range picker.
- **Sermon detail:** thumbnail + metadata + "Watch with the
  group" button → POSTs to `/api/groups/{gid}/watch/start`
  with the URL.

**Mobile parity (P19):** Same.

### Cloud Functions

- **None.**

### Test plan

**Backend:**
- `add YouTube URL pulls oEmbed metadata`.
- `add invalid URL returns 400`.
- `non-leader returns 403`.

**Frontend:**
- `filter by preacher`.
- `Watch Together button opens T50 session`.

**Rules:**
- comprehensive coverage.

### Edge cases / gotchas

- **oEmbed failure.** Tolerate; thumbnail null.
- **Stale URLs.** Don't auto-validate; document a future
  link-checker job (Phase 4).
- **Comments.** Reuse thread machinery from T09 — sermons get
  threads via a synthetic parent message at sermon-create time
  (same trick as T50). Decision: don't bother; sermons are
  read-only artifacts, comments live in the chat where the
  sermon was shared.
- **Privacy.** Don't log URLs.

### Migration / rollout

- Feature flag: `sermon_archive_enabled` (T58).

### Dependencies

- T07, T22, T50.

### Estimated complexity

Small-medium. One Sonnet session, ~1 day.

---

## T53 — Markdown messages + link unfurls — Sonnet

**Goal:** Messages support a small markdown subset (bold, italic,
lists, code spans, blockquotes). Link unfurls render OG previews
for shared URLs. Both honor the moderation pipeline.

### Acceptance criteria

- A message with `**bold**` renders bold; `<script>` renders as
  text, not HTML.
- Posting a YouTube link unfurls within 5s and shows the
  thumbnail.
- A message with a link to `http://169.254.169.254/...` is
  rejected by the SSRF guard.
- Same URL posted twice within 24h hits the cache.
- Unfurls render on mobile identically.

### Files to create

- `frontend/lib/markdown.ts` — strict markdown renderer
  (`marked` with a strict ruleset + DOMPurify).
- `frontend/components/chat/MessageBody.tsx` — rendering layer
  replacing the existing `<p>{body}</p>` shape.
- `backend/app/routers/unfurl.py` — `POST /api/unfurl`.
- `backend/app/services/unfurl.py` — fetcher with P11 safe_fetch.
- `backend/app/services/safe_fetch.py` — **NEW: introduce P11
  helper here** (T53 is the first consumer). Subsequent tasks
  (T52, T55) import from it.
- `frontend/components/chat/UnfurlCard.tsx`.
- `mobile/components/chat/MessageBody.tsx`,
  `UnfurlCard.tsx`.

### Files to modify

- `functions/src/onMessageCreate.ts` — extend the existing
  trigger after moderation: detect URLs in the body (regex or
  `URL.parse` fallback), call backend unfurl service for up to 3
  URLs, attach result to the message.
- `firestore.rules` — `groups/{gid}/messages/{mid}.unfurls` is
  system-write only. Extend the message-create rule to allow
  the field as absent or list of structured items (the rule
  already allows extra system-set fields via the create-time
  allowlist not including unfurls — **decision:** don't add to
  the create allowlist; `unfurls` is set via a *backend update*
  after create. Verify the message-update rule has a
  system-only branch that can write `unfurls` — Admin SDK
  bypasses rules, so this is a documentation note, not a rule
  change).
- `firestore.indexes.json` — none.
- `backend/app/limits.py` — `UNFURL_FETCH: "30/minute"`.

### Data model changes

- `groups/{gid}/messages/{mid}.unfurls`:
  ```ts
  [
    {
      url: string,
      title: string | null,
      description: string | null,
      imageUrl: string | null,    // proxied through GCS public bucket
      siteName: string | null,
      fetchedAt: Timestamp,
    }
  ]
  ```
  Max 3 entries.

- `unfurl_cache/{urlHash}`:
  ```ts
  {
    url: string,
    title: string | null,
    description: string | null,
    imageUrl: string | null,
    siteName: string | null,
    fetchedAt: Timestamp,
    expiresAt: Timestamp,         // fetchedAt + 24h, Firestore TTL
  }
  ```

### Firestore rule deltas

```
match /unfurl_cache/{urlHash} {
  allow read, write: if false;
}
```

### Backend interface

- `POST /api/unfurl`:
  ```python
  class UnfurlRequest(BaseModel):
      url: HttpUrl
  class UnfurlResponse(BaseModel):
      title: str | None
      description: str | None
      imageUrl: str | None
      siteName: str | None
  ```
  - **Auth:** signed-in. (Server-to-server from the function
    also calls this via a service account flow — decision: the
    function calls the service module directly, not through
    HTTP, so `POST /api/unfurl` is for client-driven preview
    cases only. Keep it minimal — defer until a client need
    surfaces.)
  - **Rate limit:** `UNFURL_FETCH`.
  - **Behavior:**
    1. Compute `urlHash = sha256(url)[:16]`.
    2. Read `unfurl_cache/{urlHash}`. If fresh, return.
    3. Otherwise, P11 safe_fetch GET. Parse OG tags
       (`<meta property="og:title">` etc.). Fall back to
       `<title>` and `<meta name="description">`.
    4. If `og:image` present, download via safe_fetch, upload
       to public bucket under `unfurls/{urlHash}.jpg`, set
       `imageUrl` to the public URL.
    5. Write cache entry, return result.

### Frontend interface

- **Markdown rendering:** the strict subset:
  - Inline: `**bold**`, `*italic*`, `` `code` `` , `~~strike~~`.
  - Block: paragraphs, blockquotes (`> `), unordered lists
    (`- `, `* `), ordered lists (`1. `).
  - **Disabled:** headings (`#`), images (`![](...)`), tables,
    inline HTML, footnotes, definition lists.
  - URLs auto-link to `<a href="..." rel="noopener noreferrer" target="_blank">`.
  - All output goes through DOMPurify with a strict allowlist
    (`b, strong, i, em, code, blockquote, ul, ol, li, p, a, s, br`).
- **`MessageBody`:** if `unfurls.length > 0`, render
  `<UnfurlCard>` below the body for each entry (max 3).

**Mobile parity (P19):** Native markdown rendering using
`react-native-markdown-display` with the same allowlist.

### Cloud Functions

`onMessageCreate.ts` extension:
1. After moderation chain, scan `body` for URLs (use a basic
   regex `/(https?:\/\/[^\s)]+)/g`, max 10 matches; take first 3).
2. For each URL:
   - Backend service call (HTTP — function → backend) is a hop.
   Decision: extract the unfurl service into the function via a
   shared TypeScript port — **OR** call the backend over the
   internal GCP network. Pick: **call the backend over the
   internal network** so SSRF guard logic lives in one place
   (Python). This is the same pattern as T28's Typesense path.
   The Cloud Function service account has IAM access to the
   backend Cloud Run service.
3. Attach result to `groups/{gid}/messages/{mid}.unfurls`.
4. (P3) idempotency via `messages/{mid}/_unfurl_events/{eventId}`.

### Test plan

**Backend (`backend/tests/test_unfurl.py`):**
- `valid YouTube URL returns OG metadata`.
- `URL resolving to private IP rejected (SSRF)`.
- `redirect chain to private IP rejected`.
- `large response > 5MB aborts`.
- `cache hit on second request`.

**Frontend (`frontend/tests/markdown.test.tsx`):**
- `**bold** renders bold`.
- `<script> renders as text`.
- `inline HTML stripped by DOMPurify`.
- `URL auto-linking adds rel="noopener noreferrer"`.

**Functions:**
- `URL detected in body triggers unfurl write`.
- `> 3 URLs only first 3 unfurled`.

### Edge cases / gotchas

- **XSS surface.** The whole point of the strict subset is to
  stay narrow. Don't expand on a feature request.
- **DOMPurify on mobile.** `react-native-markdown-display`
  handles whitelisting natively; verify XSS guard via a test.
- **Image proxy.** Fetched images are uploaded to the public
  GCS bucket. Cap daily size; document.
- **OG tags missing.** Fall back to `<title>` and meta
  description; if neither, return null fields and render a
  plain-link card.
- **OG image with HTTPS but mixed content.** Always proxy.
- **OG image with malicious payload.** GCS doesn't render
  arbitrary images; serving them via `<img>` is fine
  (browsers don't execute SVGs as scripts in `<img src>`).
  Reject SVG MIME at proxy time anyway as defense-in-depth.
- **Caching.** 24h TTL; popular links stay cached.
- **Edits.** A message edit re-runs unfurl detection; old
  unfurls are replaced.
- **Privacy.** Don't log URLs in plain; log
  `urlHash`.
- **PII in OG.** Some pages embed user-specific OG titles;
  treat as opaque; don't try to dedupe by title.

### Migration / rollout

- Feature flag: `markdown_messages_enabled` (T58). Markdown
  rendering is purely additive (plain text still renders).
- Feature flag: `unfurl_enabled` (T58).
- Env vars: none new. Reuse storage bucket env vars from T10.

### Dependencies

- T08 (chat), T20 (moderation chain), T28 (search — markdown
  body still indexed as plain text).
- Consumed by T51, T52.

### Estimated complexity

Medium (markdown allowlist + unfurl + SSRF guard). One Sonnet
session, ~2 days.

---

## T54 — Org model — group-of-groups, org admins, branded workspace — **Opus**

**Goal:** A new top-level resource: an org (church, ministry
network, BJJ school) that owns one or more groups. Org admins
manage groups under their umbrella, invite at the org level, see
aggregated analytics, brand the workspace.

### Why Opus

This is the foundation other Phase 3 multi-tenant tasks build on
(T55, T56, T57 voice quotas, T60 dashboards, T63 NCMEC scope, T65
transparency). Three judgment calls:

1. **Permission boundary shift.** Group membership semantics
   change from "leader of the group" to "leader of the group OR
   org admin of the group's parent." Every existing rule needs
   the widening (P12) without regressing for unaffiliated groups.

2. **Backward compat.** Phase 1/2 groups have no `orgId`. The
   rule's `get('orgId', null)` and the `groupOrgAdmin(gid)`
   helper must short-circuit cleanly when `orgId == null`.
   Misimplement and 100% of existing groups break.

3. **Org member denormalization.** "Member of any group in the
   org" is the natural definition of org member; querying it
   live is expensive. Maintain `orgs/{orgId}/members/{uid}` via
   `onMemberWrite` extension. Idempotency under retries is
   non-trivial — Sonnet would likely under-implement.

### Acceptance criteria

- A platform admin creates an org via `POST /api/orgs`; an org
  admin then attaches three existing groups after their leaders
  consent.
- The org dashboard shows the three groups, total members across
  them (deduped), recent activity.
- Rule tests cover: org admin can read every group inside the
  org; non-org-admin cannot read across groups they're not a
  member of; unaffiliated groups behave exactly as in Phase 2.
- Migration leaves every existing group with `orgId = null`; no
  Phase 1/2 surface regresses (full Phase 2 test suite passes).
- ADR documents the rule-shape change, the orgId-null compat
  path, the billing-fields-but-no-billing-yet decision.

### Files to create

- `orgs/{orgId}` (top-level Firestore collection).
- `orgs/{orgId}/admins/{uid}` (subcollection).
- `orgs/{orgId}/members/{uid}` (subcollection — denormalized).
- `orgs/{orgId}/invites/{inviteId}` (subcollection).
- `backend/app/routers/orgs.py` — full router. Endpoints:
  - `POST /api/orgs` — platform admin only.
  - `POST /api/orgs/{orgId}/groups/{gid}/attach` — org admin +
    leader-consent flow.
  - `POST /api/orgs/{orgId}/groups/{gid}/detach`.
  - `POST /api/orgs/{orgId}/admins` — add admin.
  - `DELETE /api/orgs/{orgId}/admins/{uid}` — remove admin.
  - `POST /api/orgs/{orgId}/invites` — issue org-level invite.
  - `GET /api/orgs/{orgId}/dashboard` — aggregated analytics.
- `backend/app/services/orgs.py` — service layer (org CRUD,
  consent token issuance, denormalization).
- `frontend/app/orgs/[orgId]/page.tsx` — org dashboard.
- `frontend/app/orgs/[orgId]/settings/page.tsx`.
- `frontend/app/orgs/[orgId]/groups/page.tsx`.
- `frontend/app/orgs/[orgId]/admins/page.tsx`.
- `frontend/app/orgs/[orgId]/transparency/page.tsx` (placeholder
  — populated by T65).
- `frontend/lib/hooks/useOrg.ts`, `useOrgMembers.ts`,
  `useOrgGroups.ts`, `useOrgAdmins.ts`.
- `infra/scripts/seed_pilot_org.py` — for the first pilot
  church.
- `docs/adr/0007-org-model.md` — schema, rule shape, migration
  plan, billing-fields placeholder.

### Files to modify

- `firestore.rules` — **comprehensive update.** P12 widening
  for every leader-only rule; new `orgs/{orgId}` block;
  `groups/{gid}` create permits `orgId` field; `groups/{gid}`
  update permits `orgId` change only via Admin SDK (rule denies
  client writes to `orgId`).
- `firestore.indexes.json`:
  - `orgs/{orgId}/members.uid` ASC + DESC, COLLECTION_GROUP
    (mirror of T22 members index).
  - `groups.orgId` ASC + `createdAt` DESC.
  - `groups.orgId` ASC + `archivedAt` ASC + `memberCount` DESC
    (org dashboard listing).
- `functions/src/onMemberWrite.ts` — extend to write/delete
  `orgs/{orgId}/members/{uid}` when the group has `orgId != null`.
  Idempotent (P3).
- `backend/app/routers/groups.py` — `create_group` accepts
  optional `orgId`; if set, requires the caller to be an org
  admin of that org. Audit log includes `orgId`.
- `backend/app/limits.py` — `ORG_CREATE`, `ORG_ADMIN_MUTATION`.
- `backend/app/config.py` — `org_consent_token_ttl_minutes: int = 60`.
- `docs/data-model.md` — extend with the org tier.

### Data model changes

- `orgs/{orgId}`:
  ```ts
  {
    name: string,                // ≤ 200
    slug: string,                // unique; URL-safe
    description: string,         // ≤ 1000
    audience: 'christian' | 'bjj' | 'general',
    logoUrl: string | null,      // set via T55 brand step
    primaryColor: string | null, // hex, e.g. '#0E5CAB'
    customDomain: string | null, // T55
    customSubdomain: string | null,
    createdBy: string,           // platform admin
    createdAt: Timestamp,
    schemaVersion: 1,
    billing: {
      tier: 'free' | 'paid_pilot',
      customerId: string | null,
      status: 'active' | 'suspended',
    },
    llmModerationPolicy: 'off' | 'advisory' | 'aggressive',
    threadSummaryEnabled: bool,
    semanticSearchEnabled: bool,
    prayerClusteringEnabled: bool,
    transparencyReportEnabled: bool,
  }
  ```
- `orgs/{orgId}/admins/{uid}`:
  ```ts
  { addedBy: string, addedAt: Timestamp }
  ```
- `orgs/{orgId}/members/{uid}`:
  ```ts
  { joinedAt: Timestamp, groupIds: string[] }
  // groupIds is the list of org-internal groups the user is in;
  // updated by onMemberWrite. Deleting the doc happens when
  // groupIds becomes empty.
  ```
- `orgs/{orgId}/invites/{inviteId}` — same shape as T25
  group invites, scoped to org. Joining an org invite places
  the user in the org's "lobby" group (a default group created
  at org-create time).
- `groups/{gid}.orgId: string | null` — backfilled to null for
  existing groups; null means "unaffiliated."
- `org_consent_tokens/{token}`:
  ```ts
  {
    orgId: string,
    gid: string,
    issuedTo: string,            // leader uid
    issuedBy: string,             // org admin uid
    expiresAt: Timestamp,         // 60 min default
    consumedAt: Timestamp | null,
  }
  ```

### Firestore rule deltas

P12 helpers:

```
function isOrgAdmin(orgId) {
  return isSignedIn()
    && exists(/databases/$(database)/documents/orgs/$(orgId)/admins/$(request.auth.uid));
}
function groupOrgAdmin(gid) {
  let group = get(/databases/$(database)/documents/groups/$(gid)).data;
  return group.get('orgId', null) != null
    && isOrgAdmin(group.orgId);
}
```

Rules block:

```
match /orgs/{orgId} {
  allow read: if isSignedIn();    // org metadata is public-ish (logo, name)
  allow create, update, delete: if false;  // backend only

  match /admins/{uid} {
    allow read: if isOrgAdmin(orgId) || (request.auth.token.admin == true);
    allow write: if false;
  }
  match /members/{uid} {
    allow read: if isUser(uid) || isOrgAdmin(orgId);
    allow write: if false;
  }
  match /invites/{inviteId} {
    allow read: if isOrgAdmin(orgId);
    allow write: if false;
  }
}

// Cross-org member CG read (mirror of M11):
match /{path=**}/members/{uid} {
  allow read: if isSignedIn() && resource.data.uid == request.auth.uid;
}
```

P12 widening on EVERY existing leader rule. Sample:

```
// groups/{gid} update — extend
allow update: if (isGroupLeader(gid) || groupOrgAdmin(gid)) && notBanned()
  && onlyChanges([..., 'orgId'])
  && (
    // Leader edits non-orgId fields.
    !('orgId' in changedKeys())
    || (
      // Backend-only write — rule denies client writes to orgId.
      // Admin SDK bypasses; this branch is unreachable from clients.
      false
    )
  );
```

For orgId pinning on group create:

```
allow create: if isSignedIn() && notBanned()
  && request.resource.data.keys().hasOnly([..., 'orgId'])
  && (!('orgId' in request.resource.data)
      || request.resource.data.orgId == null);
// orgId for org-internal group creation is set by the backend
// via Admin SDK; clients cannot create a group already attached
// to an org.
```

### Backend interface

`POST /api/orgs`:
```python
class OrgCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=3, max_length=64, regex=r'^[a-z0-9-]+$')
    description: str = Field(default='', max_length=1000)
    audience: Literal['christian','bjj','general']
    initialAdminUid: str
class OrgCreateResponse(BaseModel):
    orgId: str
    slug: str
```
- **Auth:** platform admin.
- **Rate limit:** `ORG_CREATE` (5/day).
- Validates slug uniqueness (Firestore transaction on
  `org_slugs/{slug}` reservation doc).
- Creates `orgs/{orgId}` + initial admin doc + a default "lobby"
  group with `orgId` set + adds the admin as the lobby's leader.
- Audit log `org_create`.

`POST /api/orgs/{orgId}/groups/{gid}/attach`:
```python
class AttachRequest(BaseModel):
    consentToken: str | None = None  # leader-supplied if separate flow
class AttachResponse(BaseModel):
    orgId: str
    gid: str
```
- **Auth:** org admin.
- **Behavior:**
  1. If `consentToken` is provided, verify against
     `org_consent_tokens/{token}`. If valid + matches gid +
     unconsumed: proceed; mark consumed.
  2. Else if the calling user is also the group's only leader
     (rare but legitimate — admin was already the leader): proceed.
  3. Else: issue a consent token, send email to group leaders
     ("XYZ org wants to add your group; click to consent"), return
     409 `consent_required` with `consentLinkSent: true`.
  4. On consent: write `groups/{gid}.orgId = orgId` via Admin SDK.
  5. `onMemberWrite` extension (or a one-shot back-fill in this
     endpoint) writes `orgs/{orgId}/members/{uid}` for every
     existing group member.
  6. Audit log `org_attach_group`.

`POST /api/orgs/{orgId}/groups/{gid}/detach`:
- **Auth:** org admin.
- Reverses: clears `orgId`; removes org/members entries scoped
  to this group; **does not delete the group**.

`POST /api/orgs/{orgId}/admins`:
- **Auth:** existing org admin or platform admin.
- Adds a uid to the admins subcollection. Audit.

`GET /api/orgs/{orgId}/dashboard`:
- **Auth:** org admin.
- Aggregates: group count, total deduped members, weekly active
  count, recent message volume.
- Reads the analytics views (extended in T60).

### Frontend interface

- **Org dashboard (`/orgs/[orgId]`):**
  - Hero: org name + logo.
  - Stats: groups, members, weekly active.
  - Recent activity: mod queue counts, recent groups created,
    pending join requests across the org.
  - Settings link → `/orgs/[orgId]/settings`.
- **Settings:** name, description, audience, logo upload (P5
  reuse with `purpose: 'org_logo'`), primary color, AI policies
  (T43, T44, T46, T47 toggles).
- **Groups page:** list + filter + "Attach existing group"
  modal (sends consent email).
- **Admins page:** list + add + remove (different admin can't
  remove themselves if last admin).

**Mobile parity (P19):** Org dashboard read-only on mobile;
mutations open in browser.

### Cloud Functions

`onMemberWrite.ts` extension:
- On member create in a group with `orgId != null`:
  - In a transaction:
    - Read `orgs/{orgId}/members/{uid}`.
    - If exists: `arrayUnion(gid)` on `groupIds`.
    - Else: create with `groupIds: [gid]`, `joinedAt: serverTimestamp`.
- On member delete:
  - In a transaction:
    - Read; remove `gid` from `groupIds`.
    - If `groupIds.length === 0`: delete the org member doc.
- (P3) idempotency: extend the existing event marker.

### Test plan

**Backend (`backend/tests/test_orgs.py`):**
- `create org as platform admin succeeds`.
- `create org as non-admin returns 403`.
- `slug collision returns 409`.
- `attach group requires leader consent`.
- `attach with valid consent token succeeds`.
- `attach without consent token sends email`.
- `detach clears orgId and removes org member entries`.
- `dashboard aggregates correctly`.

**Functions (`functions/src/__tests__/onMemberWrite.test.ts`):**
- `member join in org-attached group writes org member entry`.
- `member leave decrements groupIds; deletes when empty`.
- `idempotent retry doesn't double-write`.

**Rules (`firestore/tests/orgs.rules.test.ts`):**
- Comprehensive coverage.

**Cross-org rules (`firestore/tests/cross-org.rules.test.ts`):**
- `org A admin cannot edit a group in org B`.
- `unaffiliated group leader-only rules unchanged`.

### Edge cases / gotchas

- **The Phase 2 test suite must continue to pass.** Run
  the full Phase 2 rules test suite as part of T54's PR; if any
  test fails, the rule widening regressed.
- **Consent flow with multiple leaders.** Document: any one
  leader's consent is sufficient. Future: require unanimous
  consent (Phase 3.5 if a real org asks).
- **Org admin can demote themselves.** Allow, but require ≥ 1
  admin remaining (mirrors the leader-count rule in T22). Backend
  enforces; rule does not (org admin writes go through backend).
- **Leader-count widening.** Org admins do NOT count as leaders
  for the leader-count invariant. The leader-count is per group.
- **Audience mismatch.** A `christian` org cannot attach a `bjj`
  group; reject in backend.
- **GroupOrgAdmin cost.** Adds one Firestore `get` per leader
  write. For low-rate paths (settings, archive, announce, sermon
  add, event create), it's fine; for chat hot path (message
  create), the rule does NOT widen (members post messages
  normally, regardless of org admin status).
- **Org logo.** P5 upload pipeline reuse, `purpose: 'org_logo'`.
  Extend `purpose` literal and the membership check (org admin
  required).
- **Org slug reservation.** Use a top-level `org_slugs/{slug}`
  doc as the unique-key proxy. Slug change = doc swap (rare;
  manual).
- **Custom domain placeholder.** `customDomain` /
  `customSubdomain` written by T55 backend only. Document.
- **Billing fields placeholder.** Don't expose any billing UI
  in v1; the field exists so the doc doesn't reshape later.

### Migration / rollout

- Feature flag: `orgs_enabled` (T58). Default 0% → 10% → 100%.
- Back-fill: existing groups stay `orgId = null`. The
  groupOrgAdmin helper short-circuits cleanly.
- Pilot org: `seed_pilot_org.py` provisions the first one.

### Dependencies

- T07 (groups), T22 (leader role), T29 (analytics —
  org-aggregated views).
- Consumed by T55, T56, T57, T60, T63, T65.

### Estimated complexity

Large (touches most of `firestore.rules`, new collection, member
mirror, consent flow). Two Opus sessions, ~4 days.

---

## T55 — Custom domains per org (`our-church.jacob.app`) — **Opus**

**Goal:** An org admin maps a subdomain like `our-church.jacob.app`
(or, with proof-of-DNS, a vanity domain like
`groups.our-church.org`) to their org's workspace. The frontend
resolves the org from the host header.

### Why Opus

Cookies, CORS, OAuth callback URLs, Firebase Auth's authorized-
domains list, and TLS provisioning all interact. Get one wrong
and you ship an account-takeover surface (cookie scope leak across
orgs, wrong WebAuthn RP id, callback to wrong origin). The number
of cross-cutting integration points puts this firmly in Opus
territory.

### Acceptance criteria

- An org admin claims `pilot-church.jacob.app`; visiting that
  hostname loads the workspace scoped to that org's groups.
- A vanity-domain claim with a valid TXT record provisions a
  working `https://groups.our-church.org` within 30 minutes (cert
  provisioning excepted).
- Auth works across the new domain (sign in, sign out, refresh).
- Reserved subdomains (`api`, `www`) rejected at claim time.
- Logo upload goes through the moderation pipeline.
- Runbook covers the "TLS still pending after 4 hours" failure mode.

### Files to create

- `infra/firebase-app-hosting.yaml` — wildcard-domain config for
  `*.jacob.app`.
- `frontend/middleware.ts` — extract org from host header,
  attach to request context, redirect canonical org URL.
- `frontend/lib/org-context.ts` — `OrgProvider` reads current
  org from host.
- `backend/app/routers/orgs.py` — extend with:
  - `POST /api/orgs/{orgId}/custom-domain`.
  - `GET /api/orgs/{orgId}/custom-domain/status`.
  - `DELETE /api/orgs/{orgId}/custom-domain`.
  - `POST /api/orgs/{orgId}/subdomain` (claims a
    `*.jacob.app`).
- `backend/app/services/dns_verification.py` — TXT-record
  verifier (uses `dnspython`); rate-limited; retries.
- `backend/app/services/identity_platform.py` — wrapper around
  the Identity Platform Admin SDK to manage authorized domains.
- `infra/cloudfront.tf` (or App Hosting custom domain
  declarations) — vanity domain mapping resource.
- `docs/runbooks/custom-domains.md` — DNS instructions, TLS
  provisioning timing, failure modes.

### Files to modify

- `firestore.rules` — `orgs/{orgId}` update extension allows
  setting `customSubdomain` / `customDomain` from backend only;
  rule asserts client cannot write.
- `frontend/lib/firebase.ts` — Firebase Auth uses the same
  config across origins; we DON'T need to re-init per host. The
  authorized-domains list is what allows OAuth providers (Google,
  Apple) to redirect to the new origin.
- `backend/app/limits.py` — `DOMAIN_VERIFY: "10/hour"`.
- `backend/.env.example` — `JACOB_BASE_DOMAIN` (e.g. `jacob.app`),
  `JACOB_RESERVED_SUBDOMAINS` (comma-separated:
  `api,www,admin,status,dashboard,help,blog,mail,smtp,imap,ns1,ns2`).

### Data model changes

- `orgs/{orgId}.customSubdomain: string | null` — the
  `*.jacob.app` portion (e.g. `pilot-church`).
- `orgs/{orgId}.customDomain: { hostname, status, verifiedAt, certStatus }`:
  ```ts
  {
    hostname: string,                     // 'groups.our-church.org'
    status: 'pending' | 'verified' | 'active' | 'failed',
    verifiedAt: Timestamp | null,
    certStatus: 'provisioning' | 'active' | 'failed',
    txtRecord: string,                    // 'jacob-domain-verify=<random>'
    txtRecordExpiresAt: Timestamp,
  }
  ```
- `domain_claims/{hostname}` (top-level, system-only) — uniqueness
  index for both subdomain and vanity domain (so two orgs can't
  claim the same name).

### Firestore rule deltas

```
match /domain_claims/{hostname} {
  allow read, write: if false;
}
// orgs/{orgId} update — extend onlyChanges to include
// 'customSubdomain' and 'customDomain', but the rule denies any
// client write to those fields:
allow update: if (isOrgAdmin(orgId) || request.auth.token.admin == true)
  && onlyChanges([... 'name','description','logoUrl','primaryColor', ...])
  // customSubdomain and customDomain are system-only — they are
  // NOT in this onlyChanges list.
```

### Backend interface

`POST /api/orgs/{orgId}/subdomain`:
```python
class SubdomainClaimRequest(BaseModel):
    subdomain: str = Field(min_length=3, max_length=40, regex=r'^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$')
class SubdomainClaimResponse(BaseModel):
    hostname: str
```
- **Auth:** org admin.
- **Rate limit:** `ORG_ADMIN_MUTATION`.
- Validates against reserved list. Reserves
  `domain_claims/{hostname}` transactionally. Sets
  `orgs/{orgId}.customSubdomain`. Adds the new hostname to
  Firebase Auth authorized domains list via Identity Platform.

`POST /api/orgs/{orgId}/custom-domain`:
```python
class VanityDomainClaimRequest(BaseModel):
    hostname: str = Field(min_length=4, max_length=253, regex=r'^[a-z0-9.-]+$')
class VanityDomainClaimResponse(BaseModel):
    txtRecord: str
    instructions: str
```
- **Auth:** org admin.
- **Rate limit:** `ORG_ADMIN_MUTATION`.
- Generates TXT verification token; stores
  `orgs/{orgId}.customDomain` with `status: pending`.
  Returns the TXT record the user must add.

`GET /api/orgs/{orgId}/custom-domain/status`:
- Polls for the TXT record (P11 safe_fetch isn't applicable —
  this is a DNS query). Uses `dnspython`. Rate limited.
  When verified: provisions Cloud Run domain mapping; updates
  `status: verified` then `active` once the cert is provisioned.

### Frontend interface

- **Org settings page:** "Branding" card.
  - Subdomain claim form (input + check availability + claim).
  - Custom domain section (separate; advanced flow): enter
    hostname, see TXT record, "Verify now" polling button.
  - Status banner once verified: "Provisioning TLS — this can
    take up to 30 minutes."
- **Middleware (`frontend/middleware.ts`):**
  - Read `host` header. If it's `*.jacob.app` (not the bare
    `jacob.app` or `www.jacob.app`):
    - Extract subdomain.
    - Look up `orgs.where('customSubdomain', '==', subdomain)`.
      Cache for 5 min (Edge cache).
    - Attach `x-jacob-org-id` header to the request.
  - If the host matches a `customDomain`:
    - Look up `orgs.where('customDomain.hostname', '==', host)`.
    - Attach header.
- **`OrgProvider`:** reads `x-jacob-org-id` from server
  components or the URL when client-side; provides `useOrg()`
  context to children. Org-scoped pages (chat, settings,
  dashboards) gate on `useOrg()`.

**Mobile parity (P19):** Mobile is single-host (`jacob.app`); custom
domains are web-only in v1. Document.

### Cloud Functions

- **None.**

### Test plan

**Backend:**
- `claim subdomain "api" returns 400 reserved`.
- `claim subdomain duplicate returns 409 domain_taken`.
- `claim vanity domain returns TXT record`.
- `verify with absent TXT record returns 400 domain_unverified`.
- `verify with valid TXT record updates status verified and provisions cert`.

**Frontend:**
- `middleware extracts org from subdomain`.
- `middleware caches lookup for 5 min`.

**Rules:**
- `client cannot write customSubdomain or customDomain`.

### Edge cases / gotchas

- **Cookie scope.** Firebase Auth cookies are set with
  `domain=.jacob.app` (parent domain) so a single sign-in covers
  all subdomains. This is **required** for the SSO experience.
  **Vanity domains have isolated cookies** — users sign in
  separately on `groups.our-church.org`. Document the trade-off.
- **WebAuthn RP id.** Passkeys registered on `jacob.app` work on
  any subdomain (RP id = parent). Passkeys registered on a
  vanity domain bind to that vanity domain only. Document.
- **OAuth callback URLs.** Add to Identity Platform's
  authorized-domains list at provisioning time.
- **Cert provisioning latency.** Google Cloud Run managed cert
  takes 5–30 min after DNS resolves. The runbook covers the
  4-hour failure mode.
- **Reserved subdomains.** Comprehensive list in the env var.
  Update when a new system service goes live.
- **DNS TTL.** Verification requires the TXT record to be
  visible. Recommend TTL ≤ 300s for first-time setup.
- **Vanity domain expiration.** If the user removes the TXT or
  CNAME, the cert renewal fails. Sentry alert; org admin gets
  email.
- **Domain transfer.** Don't permit re-claiming a vanity domain
  used by another org without a separate verification cycle.
- **Domain claim retraction.** Org can release the subdomain
  (deletes `domain_claims/{hostname}`); the hostname becomes
  free 30 days later (cooling-off period to prevent
  squatting-after-pivot abuse).

### Migration / rollout

- Feature flag: `custom_domains_enabled` (T58).
- Env vars: `JACOB_BASE_DOMAIN`, `JACOB_RESERVED_SUBDOMAINS`,
  `IDENTITY_PLATFORM_PROJECT`.

### Dependencies

- T54 (org model).
- Cross-task: T42 (passkey origin list), T57 (LiveKit join URL
  needs to know the right host).

### Estimated complexity

Large (multi-system integration). Two Opus sessions, ~3 days.

---

## T56 — BJJ vertical — sticker set, brand variant, audience switch — Sonnet

**Goal:** Onboard the first BJJ pilot. Add the BJJ sticker set,
brand-voice variant copy, and creation-time audience switch on
org/group create.

### Acceptance criteria

- A BJJ org with a single group can be created end-to-end;
  messages require a BJJ sticker.
- A Christian-audience message attempting a BJJ sticker is
  rejected by the rule.
- The onboarding page renders BJJ-flavored copy when the user is
  invited into a BJJ org.
- Discovery page filters between Christian and BJJ groups.
- Existing Christian groups see no UX change.

### Files to create

- `infra/seed/stickers/bjj.json` — sticker set:
  `roll_partner_needed`, `tournament_prep`, `technique_question`,
  `recovery`, `conditioning`, `bjj_milestone`, plus shared `general`
  set (`encouragement`, `question`, `praise`).
- `frontend/lib/copy/index.ts` — extract user-facing strings into
  i18n-style module keyed by `audience`. Default: `christian`.
- `frontend/lib/copy/christian.ts`, `frontend/lib/copy/bjj.ts`.
- `infra/scripts/seed_pilot_bjj_org.py`.
- `backend/app/templates/email/welcome_bjj.html.j2`,
  `digest_bjj.html.j2`.

### Files to modify

- `firestore.rules` — extend message create predicate to
  validate sticker slugs against the parent group's audience:
  ```
  // For groups/{gid}/messages/{mid} create — extend the existing
  // sticker validation:
  && request.resource.data.stickerIds.toSet().hasOnly(getAudienceStickers(gid))
  ```
  CEL doesn't support function calls returning sets dynamically.
  **Pragmatic alternative:** keep the sticker-existence check
  (T26) and validate the audience scope at the **trigger**:
  `onMessageCreate.ts` reads the parent group's `audience` and
  the sticker's `audience`; mismatch sets `moderation.state =
  'flagged'` with reason `audience_mismatch`. Document.
- `firestore/seed/stickers.ts` — extend with BJJ sticker seed.
- `frontend/app/discover/page.tsx` — audience filter dropdown.
- `frontend/app/onboarding/page.tsx` — copy lookup via
  `useCopy()`.
- `backend/app/services/email.py` — pick template by recipient's
  org's audience.

### Data model changes

- `orgs/{orgId}.audience` already exists (T54); no change.
- `groups/{gid}.audience` already exists; T56 honors it for sticker
  rules.
- `stickers/{stickerId}.audience` field already exists per T06;
  values: `'christian' | 'bjj' | 'general'`.

### Firestore rule deltas

The strict rule-side check is awkward in CEL. The trigger
catches mismatches; document. For a UI-side gate, the sticker
picker filters by `groups/{gid}.audience` — the user can't
post a BJJ sticker into a Christian group from the UI.
Defense-in-depth: trigger flags any message whose sticker
audience mismatches.

### Backend interface

- **None new.** Org / group create endpoints already accept
  `audience` (T54). Validate sticker slugs against the parent
  org's audience at ORG/GROUP create.

### Frontend interface

- **Discovery:** audience filter dropdown:
  `All | Christian | BJJ`.
- **Onboarding:** copy lookup `useCopy('welcome.title')` returns
  the right variant.
- **Sticker picker:** filtered by group audience.

**Mobile parity (P19):** Same.

### Cloud Functions

- `onMessageCreate.ts` extension — audience-mismatch flag.

### Test plan

**Frontend:**
- `useCopy returns BJJ variant when audience=bjj`.
- `sticker picker hides BJJ stickers in a Christian group`.

**Functions:**
- `BJJ sticker on a Christian group sets moderation.state=flagged`.

**Rules / E2E:**
- Comprehensive end-to-end: BJJ org created, group + members,
  message with BJJ sticker accepted; same on Christian rejected
  by trigger.

### Edge cases / gotchas

- **Audience immutability.** Org / group audience cannot change
  after create — would invalidate sticker history. Backend
  rejects audience change in update endpoint.
- **General stickers.** `audience: 'general'` is allowed in any
  group regardless of group audience. Document.
- **BJJ pilot org.** First pilot org seeded by the script; the
  org admin is set to the pilot's BJJ school owner uid (passed
  in env / arg).
- **Brand voice clash.** A BJJ user signing into a Christian
  org sees Christian copy (org's audience wins).
- **Email templates.** Add fallback to christian if a `bjj`
  template is missing.

### Migration / rollout

- Feature flag: `bjj_audience_enabled` (T58).

### Dependencies

- T06 (sticker model), T30 (discovery), T54 (org).

### Estimated complexity

Small-medium (mostly content + seed + audience switch). One
Sonnet session, ~1 day.

---

## T57 — Voice rooms (LiveKit) for small groups — **Opus**

**Goal:** A leader opens a voice room (drop-in audio) for a
group. Members join from web or mobile. Cap 10 concurrent. No
video. No recording in v1.

### Why Opus

Realtime infra is new. The abuse vectors (someone using the room
to harass a member) require kick / mute / ban / kill paths that
must be airtight before launch. The recording-policy decision (no
recording in v1) is a community-trust decision that propagates
through the spec and runbook. Cost guardrails are stricter than
typical (LiveKit is per-minute paid).

### Acceptance criteria

- Leader starts a room; another member joins within 5s; audio
  bidirectional with < 250ms RTT median.
- Kicking a member ejects them within 2s; they cannot rejoin
  during the same session.
- Killing the room disconnects every participant.
- Banned user cannot get a voice token (403 from `/voice/token`).
- Cost-cap test: cap mocked at 1, second voice-minute rejected.
- Mobile parity: same start/join/leave on iOS.
- Runbook documents the kill-room path and on-call routing.

### Files to create

- `backend/app/routers/voice.py` — full router.
- `backend/app/services/voice.py` — LiveKit server SDK wrapper
  (`livekit-server-sdk` Python). Issues short-lived JWT access
  tokens.
- `groups/{gid}/voice_sessions/{sessionId}` — Firestore doc.
- `frontend/app/groups/[gid]/voice/page.tsx` — voice room UI.
- `frontend/components/voice/VoiceRoom.tsx`,
  `VoiceParticipants.tsx`, `MuteButton.tsx`, `LeaveButton.tsx`,
  `KickButton.tsx`, `KillRoomButton.tsx`.
- `mobile/app/(authed)/groups/[gid]/voice.tsx`.
- `infra/livekit.tf` — LiveKit Cloud project setup. ADR doc
  decides Cloud vs. self-hosted; recommend Cloud for v1.
- `docs/adr/0008-voice-rooms.md`.
- `docs/runbooks/voice-incidents.md` — kick / mute / ban /
  kill-room procedures.
- `docs/community-guidelines.md` — extend with voice rules.

### Files to modify

- `firestore.rules` — `voice_sessions` rules.
- `firestore.indexes.json` —
  `voice_sessions.endedAt+createdAt DESC`.
- `backend/app/limits.py` — `VOICE_TOKEN`, `VOICE_START`.
- `backend/app/config.py` — `voice_enabled: bool = False`,
  `voice_per_org_monthly_cap_minutes: int = 1000`,
  `voice_max_concurrent: int = 10`.
- `backend/.env.example` — `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_HOST`.

### Data model changes

- `groups/{gid}/voice_sessions/{sessionId}`:
  ```ts
  {
    startedAt: Timestamp,
    endedAt: Timestamp | null,
    startedBy: string,
    participants: string[],   // history; not live (use LiveKit for live)
    kickedUids: string[],     // banned from this session
    killedAt: Timestamp | null,
    killedBy: string | null,
    durationSec: number | null,
  }
  ```
- `voice_org_usage/{orgId}-{YYYY-MM}`:
  ```ts
  {
    minutes: int,
    sessionCount: int,
    capExceededAt: Timestamp | null,
  }
  ```

### Firestore rule deltas

```
match /groups/{gid}/voice_sessions/{sessionId} {
  allow read: if isGroupMember(gid);
  allow create, update, delete: if false;  // backend only
}
match /voice_org_usage/{key} {
  allow read, write: if false;
}
```

### Backend interface

`POST /api/groups/{gid}/voice/start`:
- **Auth:** group leader OR org admin.
- **Rate limit:** `VOICE_START` (10/hour).
- Verifies group not archived, no active session.
- Reads `voice_org_usage` for the current month; rejects
  if cap exceeded.
- Creates `voice_sessions/{sessionId}` doc.
- Sends `kind: "voice_started"` notification (T34/T41) to all
  members (skip muted/blocked, skip non-announcement quiet
  hours suppression).
- Returns `{ sessionId, livekitRoom }`.

`POST /api/groups/{gid}/voice/end`:
- **Auth:** leader or org admin OR the only remaining
  participant.
- Sets `endedAt`, computes `durationSec`, increments
  `voice_org_usage.minutes`.

`POST /api/groups/{gid}/voice/kick`:
- **Auth:** leader.
- **Body:** `{ targetUid }`.
- Adds to `kickedUids`; calls LiveKit
  `room_service.remove_participant`.

`POST /api/groups/{gid}/voice/kill`:
- **Auth:** leader (any leader).
- Sets `killedAt`, `killedBy`. Calls LiveKit `room_service.delete_room`.

`GET /api/groups/{gid}/voice/token`:
- **Auth:** group member, not banned, not in
  `kickedUids`, voice session active.
- **Rate limit:** `VOICE_TOKEN` (20/min).
- Issues LiveKit JWT (60s TTL) bound to `room_name = sessionId`,
  `participant_identity = uid`. Permissions: `canPublish: true`,
  `canSubscribe: true`, `canPublishVideo: false` (audio only).

### Frontend interface

- **Voice room page:**
  - On open: GET token → connect via LiveKit web SDK.
  - Show participants grid (avatar + display name + speaking
    indicator + mute icon).
  - Self mute/unmute. Leader sees per-participant mute and kick.
  - Leave button → disconnect.
  - Kill room button (leader, separate confirmation).
- **Notification on start:** "X started a voice room" with
  Join button.

**Mobile parity (P19):** Same flow; LiveKit RN SDK.

### Cloud Functions

- **None.** A 5-minute Cloud Run idle-cleanup job
  (`infra/scheduled/cleanup_voice_sessions.py`) closes sessions
  where the last participant left. Reads LiveKit's room state via
  the server SDK.

### Test plan

**Backend (`backend/tests/test_voice.py`):**
- `start by leader returns sessionId`.
- `start when cap reached returns 429 voice_quota_exceeded`.
- `token for banned user returns 403`.
- `kick adds to kickedUids and calls LiveKit remove`.
- `kill calls LiveKit delete_room and updates state`.
- `non-leader cannot start`.

**Frontend:**
- `participants render in grid with mute indicator`.
- `kick button visible only to leader`.

**Rules:**
- comprehensive coverage.

### Edge cases / gotchas

- **No recording** in v1. The LiveKit server config explicitly
  disables egress. Document. The community guidelines explicitly
  state this; recording is a Phase 4 decision.
- **Banned user.** Backend filter at token issuance; LiveKit
  itself doesn't know about JACOB bans.
- **Kicked user re-join attempt.** Token issuance checks
  `kickedUids`; reject. Document that kick is per-session, not
  per-group ban.
- **Cost cap at 100% of monthly minutes.** Hard 429; org admin
  must contact platform admin to raise. v2 self-serve raise via
  the dashboard (Phase 3.5).
- **Token TTL.** 60s — short enough that compromise is bounded;
  long enough that race-on-join is fine.
- **LiveKit egress (recording, streaming) disabled.** Verify the
  LiveKit project config blocks it.
- **Mobile background.** The mobile LiveKit SDK supports
  background audio; document the iOS background mode required
  in `app.config.ts`.
- **Notification spam.** Voice-start notifications cap at one per
  group per 4-hour window (server-side dedup).
- **Privacy.** Don't log audio payloads (impossible — LiveKit
  doesn't expose them) but also don't log participant uids in
  bulk; log session id.

### Migration / rollout

- Feature flag: `voice_rooms_enabled` (T58). Default 0% → 5%
  (closed cohort) → 25% → 100%.
- Env vars: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_HOST`, `VOICE_PER_ORG_MONTHLY_CAP_MINUTES`.

### Dependencies

- T07, T22 (leader), T34/T41 (push), T58 (feature flag).
- Cross-task: T54 (org cap).

### Estimated complexity

Large (LiveKit integration, abuse mitigations, mobile parity,
cost caps). Two Opus sessions, ~3 days.

---

## T58 — Feature flags + staged rollout admin — Sonnet

**Goal:** Self-serve feature flags. Every Phase 3 task ships
behind a flag. Ramp 0 → 10 → 50 → 100% from admin UI without
redeploying. Cohort targeting.

### Acceptance criteria

- Setting `mobile_native_enabled` to 50% causes ~half of test
  users to evaluate true; client and server agree.
- Adding a uid to `cohorts.uids` flips that user to true
  regardless of percentage.
- Toggling a flag in admin UI surfaces in another browser tab
  within 5s.
- Audit log entry exists for every change.
- Cleanup banner appears for a flag manually back-dated to "100%
  since 31 days ago."

### Files to create

- `feature_flags/{flagKey}` (top-level Firestore collection):
  ```ts
  {
    enabled: bool,
    rolloutPercentage: int,        // 0..100
    cohorts: {
      orgIds: string[],
      roles: string[],             // ['admin','leader','member']
      uids: string[],
    },
    description: string,
    updatedBy: string,
    updatedAt: Timestamp,
    fullRolloutAt: Timestamp | null,  // set when ramped to 100%
    schemaVersion: 1,
  }
  ```
- `backend/app/services/flags.py` — server-side evaluator.
  `evaluate_flag(flag_key, *, uid, org_ids, roles)`.
- `backend/app/routers/flags.py` — admin endpoints (read/write).
- `frontend/lib/flags.ts` — `useFlag(key)` + `evaluateFlag(key, ctx)`.
- `frontend/app/admin/flags/page.tsx` — admin UI.
- `frontend/app/admin/flags/[flagKey]/page.tsx` — detail/audit history.
- `mobile/lib/flags.ts` — mobile parity.
- `backend/scripts/flag.py` — CLI for incident response.
- `docs/runbooks/feature-flags.md` — naming convention,
  cleanup policy.

### Files to modify

- `firestore.rules` — `feature_flags` rules:
  ```
  match /feature_flags/{flagKey} {
    allow read: if isSignedIn();      // self-evaluation
    allow create, update, delete: if false;
  }
  ```
- `backend/app/limits.py` — `FLAG_MUTATION: "30/minute"`.
- `audit_log` is written on every flag change.

### Backend interface

`GET /api/admin/flags`:
- **Auth:** platform admin.
- Lists all flags.

`POST /api/admin/flags`:
- **Auth:** platform admin.
- **Body:** `{ flagKey, enabled, rolloutPercentage, cohorts, description }`.
- Validates rolloutPercentage in [0,100]; cohorts shape; flagKey
  format. Writes; audit log.

`POST /api/admin/flags/{flagKey}/percentage`:
- Sets just the percentage; convenience endpoint.

### Frontend interface

- **Admin flag list:** table of all flags + state. Filter by
  "candidate for cleanup" (>30 days at 100%).
- **Detail page:** edit flag + see audit history (querying
  `audit_log.where('action','==','flag_update').where('targetRef','==','feature_flags/{flagKey}')`).
- **`useFlag`:** subscribes to `feature_flags/{flagKey}` via
  `onSnapshot` (or to the whole collection once and selects).
  Returns `enabled: bool` after evaluation.

### Cloud Functions

- **None.** No triggers; the collection is read-only client.

### Test plan

**Backend:**
- `evaluate_flag with percentage=50 returns deterministic uid hash bucket`.
- `cohort.uids overrides percentage`.
- `cohort.orgIds overrides for users in that org`.
- `unknown flag defaults to disabled`.

**Frontend:**
- `useFlag updates within snapshot when flag doc changes`.
- `flags collection has only one listener at a time (singleton)`.

**Rules:**
- `client cannot write`.
- `client can read`.

### Edge cases / gotchas

- **Hash function parity.** Server (Python `hashlib`) and client
  (Web Crypto / Node `crypto`) and mobile (RN `crypto-js` or
  similar) MUST produce identical bucket. Pin a test fixture of
  100 (uid, flagKey) → bucket pairs and assert all three
  implementations match.
- **Cleanup discipline.** A flag at 100% for >30 days surfaces
  in admin UI as "Candidate for cleanup" — encourage removal.
- **Listener cost.** A single collection listener per client is
  fine for ≤ 1000 flags. Beyond that, switch to a server-fetched
  manifest at sign-in.
- **Stale listener.** When a user signs out, tear down.
- **Race.** Two admins editing the same flag — last write wins.
  Surface a "Refresh" prompt if the local cached version differs
  from server.

### Migration / rollout

- Self-bootstrapping: the flag system uses itself in dogfood mode
  after deploy.

### Dependencies

- T13 (admin claim), T15 (admin tooling).
- Consumed by every Phase 3 task that ships behind a flag.

### Estimated complexity

Medium. One Sonnet session, ~1.5 days.

---

## T59 — On-call rotation + incident playbook + postmortem template — Sonnet

**Goal:** Operationalize on-call. Define rotation, escalation,
postmortem template, status page, incident banner.

### Acceptance criteria

- First two on-call rotations scheduled and documented.
- A synthetic SEV1 alert reaches the on-call's phone in dev.
- Status page is live and reachable at `status.jacob.app`.
- A test postmortem fills out the template end-to-end.
- Incident banner renders on home page when activated; clears
  when `displayUntil` passes.

### Files to create

- `docs/oncall.md` — extend with rotation schedule (two-person
  weekly), escalation, expectations.
- `docs/runbooks/incident.md` — playbook with severity defs
  (SEV1/2/3), declaration template, comms template, IC role.
- `docs/postmortem-template.md` — blameless template.
- `docs/adr/0009-oncall-tooling.md` — vendor (PagerDuty vs.
  Opsgenie), cost, cadence.
- `infra/oncall/pagerduty.tf` (or `opsgenie.tf`) — alert routing.
- `infra/status-page.tf` — Cloud Status (Uptime Kuma or
  StatusPage.io — pick in ADR).
- `frontend/components/admin/IncidentBanner.tsx`.
- `frontend/lib/hooks/useActiveIncidents.ts`.
- `active_incidents/{incidentId}` (Firestore):
  ```ts
  {
    severity: 'SEV1' | 'SEV2' | 'SEV3',
    title: string,
    body: string,
    createdBy: string,
    createdAt: Timestamp,
    displayUntil: Timestamp,
    acknowledged: bool,
  }
  ```

### Files to modify

- `firestore.rules` — `active_incidents` rules: read for any
  signed-in (and possibly anonymous on the home page); write for
  platform admin only.
- `backend/app/routers/incidents.py` — admin-only endpoints to
  declare/clear incidents.
- `backend/app/limits.py` — reuse `ADMIN_MUTATION`.
- `frontend/app/page.tsx` — render banner if active.
- `mobile/components/IncidentBanner.tsx` — mobile parity.

### Data model changes

- `active_incidents/{incidentId}` — see above.

### Firestore rule deltas

```
match /active_incidents/{incidentId} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;
}
```

### Backend interface

`POST /api/admin/incidents`:
```python
class IncidentDeclareRequest(BaseModel):
    severity: Literal['SEV1','SEV2','SEV3']
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=2000)
    displayMinutes: int = Field(ge=15, le=1440)
class IncidentDeclareResponse(BaseModel):
    incidentId: str
```

`POST /api/admin/incidents/{incidentId}/clear`:
- Sets `displayUntil` to now-1ms.

### Frontend interface

- **Banner:** non-dismissible; styled per severity (SEV1 red,
  SEV2 amber, SEV3 blue).

**Mobile parity:** Same.

### Cloud Functions

- **None.**

### Test plan

- `declare incident sends webhook to PagerDuty` (mocked).
- `incident banner renders on home page`.
- `incident banner clears when displayUntil passes`.

### Edge cases / gotchas

- **PagerDuty integration secret.** Store in Secret Manager.
- **Status page.** Tied to uptime checks (T15). Document the
  data flow: uptime check fail → PagerDuty incident → status
  page subscriber email.
- **Postmortem template.** Includes timeline, contributing
  factors, action items, what went well — blameless.

### Migration / rollout

- Feature flag: not gated (operational tooling — always on).

### Dependencies

- T15 (uptime checks), T58 (flag for the banner if needed).

### Estimated complexity

Small-medium. One Sonnet session, ~1 day.

---

## T60 — Group-health dashboard for leaders/pastors — Sonnet

**Goal:** Extend T29's leader analytics into a richer dashboard:
engagement trends, retention curves, event attendance (T49), prayer-
request response rates (T47), sentiment trend (rolling). Org admins
see an aggregated dashboard.

### Acceptance criteria

- A leader sees retention curves for each weekly cohort.
- An org admin sees aggregated charts across the org's groups.
- Per-member sentiment is never surfaced — verified by code-search
  test.
- Prayer response numbers match a hand-counted tally on a fixture.
- Runbook explains each chart and lists what NOT to use it for.

### Files to create

- `frontend/app/orgs/[orgId]/analytics/page.tsx` — new.
- `frontend/components/analytics/RetentionChart.tsx`,
  `EngagementTrendChart.tsx`, `SentimentChart.tsx`,
  `EventAttendanceChart.tsx`, `PrayerResponseChart.tsx`.
- `docs/runbooks/leader-analytics.md` — what each chart means.

### Files to modify

- `infra/bigquery/views.sql` — extend with new views:
  - `engagement_weekly` — extend with `replyCount`, `reactionCount`,
    `mentionCount`.
  - `member_retention_cohort` — new (P16 math).
  - `event_attendance_weekly` — new.
  - `prayer_response_weekly` — new.
  - `sentiment_weekly` — new (rolling 7-day avg from
    `moderation_queue.severity` aggregates).
- `backend/app/routers/analytics.py` — extend with org endpoints:
  - `GET /api/orgs/{orgId}/analytics`.
  - extended `GET /api/groups/{gid}/analytics`.
- `frontend/app/groups/[gid]/analytics/page.tsx` — extended.
- `infra/scheduled/firestore_to_bigquery.py` — extend the export to
  include `events`, `rsvps`, `prayingFor`.

### Data model changes

- **None in Firestore.** All aggregates live in BigQuery views.

### Firestore rule deltas

- **None.**

### Backend interface

`GET /api/orgs/{orgId}/analytics`:
```python
class OrgAnalyticsResponse(BaseModel):
    orgId: str
    groupCount: int
    activeMembers7d: int
    activeMembers30d: int
    retentionCohorts: list[CohortPoint]
    engagementTrend: list[TrendPoint]
    eventAttendance: list[EventPoint]
    prayerResponse: list[PrayerPoint]
    sentimentTrend: list[SentimentPoint]
```
- **Auth:** org admin OR platform admin.
- **Rate limit:** `ANALYTICS_QUERY`.
- Reads from BigQuery views via service-account auth.
- Cache 1h.

`GET /api/groups/{gid}/analytics` (extended):
- Same shape, scoped to a single group.
- **Auth:** group leader OR org admin OR platform admin.

### Frontend interface

- Charts via `recharts` (same lib as T29).
- 30/90-day toggles.
- Per-org dashboard mirrors per-group but stacks groups in
  small-multiples.

**Mobile parity (P19):** Read-only; mobile dashboards Phase 3.5.

### Cloud Functions

- **None.**

### Test plan

**Backend:**
- `prayer_response_weekly view produces expected counts on a fixture`.
- `sentiment_weekly never includes per-uid sentiment`.
- code-search test: `assert no field name endswith ('.sentiment')` in
  any analytics response payload.

**Frontend:**
- charts render with sample data.

### Edge cases / gotchas

- **24h staleness banner** stays — same UX as T29.
- **Privacy.** Per-member sentiment surfacing is forbidden. The
  tests assert this; the runbook lists what NOT to use the data
  for ("retention dropping in week 3 is not a sign that a member
  should be removed").
- **Cohort retention math** — use P16. Don't reinvent.
- **Org-aggregate weighting.** Equal-weight across groups, OR
  cohort-size-weighted? Pick cohort-size-weighted (matches the
  intuition); document.
- **Empty groups in org.** Skip from aggregates with < 3 members
  (privacy).

### Migration / rollout

- Feature flag: `org_analytics_enabled` (T58).

### Dependencies

- T22, T29, T47, T49, T54.

### Estimated complexity

Medium. One Sonnet session, ~2 days.

---

## T61 — i18n foundation — en + es seed, RTL-ready, locale routing — Sonnet

**Goal:** Internationalize frontend + mobile with English and
Spanish. Wire RTL support so adding Arabic later is config-only.

### Acceptance criteria

- Switching `/en/groups` → `/es/groups` re-renders in Spanish.
- A new email goes out in Spanish to a user with `locale: "es"`.
- A test scaffolding an RTL locale doesn't break layout.
- Untranslated strings render with `[ES]` prefix in dev; fall
  back to English in prod.
- Mobile honors locale.

### Files to create

- `frontend/lib/i18n/index.ts` — `next-intl` setup.
- `frontend/lib/i18n/messages/en.json`,
  `frontend/lib/i18n/messages/es.json`.
- `frontend/middleware.ts` — extend with locale detection /
  redirect.
- `frontend/app/[locale]/` — restructure routes under locale
  segment. **Keep existing `/admin` outside the locale prefix
  (admin is English-only in v1).**
- `mobile/lib/i18n/index.ts` — `i18n-js` setup.
- `mobile/lib/i18n/messages/en.json`, `es.json`.
- `backend/app/templates/email/welcome.es.html.j2`,
  `digest.es.html.j2`,
  `account_deletion_confirmation.es.html.j2`,
  `export_ready.es.html.j2`.
- `docs/i18n.md` — translation contribution flow,
  pluralization rules, how to add a new locale.

### Files to modify

- `frontend/app/layout.tsx` — `lang` attribute, RTL
  `dir="rtl"` when locale's directionality requires.
- `frontend/lib/copy/index.ts` (T56) — switch to next-intl
  message lookup.
- `users/{uid}.locale: 'en' | 'es'` — new field; default `'en'`.
- `firestore.rules` — extend `users/{uid}` update onlyChanges to
  allow `locale`.
- `backend/app/services/email.py` — pick template by recipient's
  `locale`.
- `tailwind.config.ts` — add logical property variants.

### Data model changes

- `users/{uid}.locale: 'en' | 'es'`.

### Firestore rule deltas

```
allow update: if isUser(uid) && notBanned()
  && changedKeys().hasOnly(['displayName', 'photoURL', 'isMinor', 'locale'])
  && (!('locale' in changedKeys())
      || request.resource.data.locale in ['en','es']);
```

### Backend interface

- **None new.** Email service picks the right locale.

### Frontend interface

- Locale switcher in user settings.
- All new strings go through `t('key')`.
- First 200 strings translated to Spanish (committed in PR).
- Missing strings: render with `[ES]` prefix in dev (`NODE_ENV !== 'production'`),
  fall back to English in prod.

**Mobile parity (P19):** Same.

### Test plan

- `locale=es URL renders Spanish`.
- `email sent to user with locale=es uses .es template`.
- `RTL fake locale doesn't break layout (visual snapshot)`.

### Edge cases / gotchas

- **Locale + customDomain.** Custom domains work with the
  locale prefix; document.
- **DST and time formatting.** `Intl.DateTimeFormat(user.locale)` —
  document `tz` behavior.
- **AI surfaces.** LLM moderation prompt is English; document
  that non-English moderation precision is unmeasured.

### Migration / rollout

- Feature flag: `i18n_es_enabled` (T58).

### Dependencies

- T11 (existing email infra).

### Estimated complexity

Medium. One Sonnet session, ~2 days.

---

## T62 — Accessibility deepening — chat screen-reader, switch control — Sonnet

**Goal:** Bring the chat surface, sticker picker, reactions,
offline cache to a real screen-reader-usable bar. Switch-control
friendly; voice-control friendly.

### Acceptance criteria

- A screen-reader user can read the message log, reply, send a
  sticker, react.
- `axe-core` reports zero serious/critical violations on
  `/groups/[gid]/chat`, `/discover`, `/admin/queue`.
- Switch-control demo (recorded) shows tab order.
- Reduced-motion mode disables typing-indicator and reaction-bar
  animations.
- Mobile VoiceOver navigates chat end-to-end.

### Files to create

- `frontend/lib/a11y.ts` — focus trap helper, skip-link.
- `frontend/tests/a11y/` — axe-core integration tests.
- `docs/a11y.md` — testing checklist.

### Files to modify

- `frontend/components/chat/MessageList.tsx` — ARIA `log` role,
  `aria-live="polite"`, message group headings.
- `frontend/components/chat/MessageItem.tsx` — labelling of
  reactions, mentions, threads.
- `frontend/components/stickers/StickerPicker.tsx` —
  keyboard nav, ARIA roles.
- `frontend/components/chat/ReactionPicker.tsx` — ditto.
- `frontend/app/layout.tsx` — skip-link, lang attribute.
- `frontend/components/chat/TypingIndicator.tsx` —
  `prefers-reduced-motion`.
- `mobile/components/chat/` — equivalent VoiceOver / TalkBack
  labels.

### Data model changes

- **None.**

### Firestore rule deltas

- **None.**

### Backend interface

- **None.**

### Frontend interface

- Screen reader announces new messages without repeating log.
- Tab order: `header → messages → input → send`. No focus trap
  in sticker picker.
- Color contrast: WCAG AA (4.5:1) verified by axe.
- Reduced-motion: typing animation + reaction-bar pulse off.

### Test plan

- axe-core passes on the listed pages.
- Manual: VoiceOver on Mac + NVDA on Windows; recorded in PR.
- Reduced-motion test asserts the animation class is absent
  when prefers-reduced-motion: reduce.

### Edge cases / gotchas

- **`aria-live="polite"`** doesn't interrupt; that's the right
  default. `assertive` for moderation banners only.
- **Color contrast on existing tokens** may fail; update tokens
  in `docs/design-tokens.md`.
- **Mobile reactions animations.** Disabled by reducemotion via
  `AccessibilityInfo.isReduceMotionEnabled()`.

### Migration / rollout

- No feature flag; pure improvement.

### Dependencies

- T08 (chat), T26 (reactions), T36 (PWA), T48 (presence/typing).

### Estimated complexity

Medium. One Sonnet session, ~2 days.

---

## T63 — NCMEC formal reporting workflow — **Opus**

**Goal:** Wire the existing CSAM hash-match path (T10) into a
formal NCMEC CyberTipline report. When a CSAM match fires, the
system files an automatic report (operator-approved) and preserves
evidence per legal retention requirements.

### Why Opus

Legal compliance, irreversible external action, evidence chain-of-
custody. The implementation must fail closed (block uploads if the
reporting path is broken) and must be operator-approved before the
first real fire. The data shape, retention timing, and operator-
gate decisions are policy-sensitive and must be reviewed with
counsel before code lands.

### Acceptance criteria

- A simulated CSAM match in dev creates a `ncmec_cases` pending
  doc, fires email to test admin, surfaces in the queue.
- Operator clicks Submit; in dev (against NCMEC sandbox or
  mocked endpoint), request sent, response recorded.
- A failed submit (mocked 500) retries 3x and surfaces an alert.
- Held file retention test confirms `_held/` lifecycle does not
  delete a file before `retainedUntil`.
- Legal doc covers chain-of-custody, NCMEC operator account
  ownership, periodic legal review cadence.
- Runbook walks the on-call through the first real-fire scenario.

### Files to create

- `backend/app/services/ncmec.py` — NCMEC CyberTipline API
  client. Decides between SOAP and HTTP; document in ADR. v1
  uses the HTTPS XML submit endpoint; document the protocol.
- `backend/app/routers/ncmec.py` — endpoints.
- `ncmec_cases/{caseId}` (Firestore):
  ```ts
  {
    matchedAt: Timestamp,
    hashSource: 'photodna' | 'pdq' | 'other',
    hashValue: string,
    evidence: {
      gcsPath: string,             // `_held/...`
      sha256: string,
      sizeBytes: int,
      contentType: string,
    },
    reporterUid: string | null,    // if user-reported, the reporter
    suspectUid: string | null,     // the uploader
    status: 'pending' | 'submitted' | 'withdrawn' | 'failed',
    submittedBy: string | null,
    ncmecReportId: string | null,
    submittedAt: Timestamp | null,
    retainedUntil: Timestamp,      // default matchedAt + 90 days
    withdrawnReason: string | null,
    failureReason: string | null,
    schemaVersion: 1,
  }
  ```
- `backend/app/templates/email/ncmec_pending.html.j2`.
- `docs/legal/ncmec.md` — legal framework, NCMEC operator
  account setup, chain-of-custody rules, who can submit.
- `docs/runbooks/csam-incident.md` — operator playbook.
- `docs/adr/0010-ncmec-reporting.md` — fail-closed posture,
  operator-gate decision.

### Files to modify

- `firestore.rules` — `ncmec_cases` denied to all clients.
- `infra/buckets.tf` — extend `_held/` lifecycle:
  - SetStorageClass to COLDLINE at age 30 days.
  - Delete at age 2557 days (≈7 years) — aligns with L14 from
    Phase 2 review (Phase 2 deferred).
  - **Block deletes by default** at the bucket level for objects
    in `_held/` until `retainedUntil` passes — use object-level
    holds via `gcs.set_object_retention_lock` if available;
    otherwise document the operational rule.
- `functions/src/onPhotoUploadFinalize.ts` — when CSAM match
  fires, create a `ncmec_cases` pending doc + send email +
  audit_log.
- `backend/app/limits.py` — `NCMEC_SUBMIT: "10/hour"`.
- `backend/app/config.py` — `ncmec_submit_disabled: bool = False`,
  `ncmec_endpoint: str = "https://report.cybertip.org/ispws/"`,
  `ncmec_operator_id: str = ""`.
- `backend/.env.example` — `NCMEC_API_KEY`,
  `NCMEC_OPERATOR_ID`, `NCMEC_ENDPOINT`,
  `NCMEC_SUBMIT_DISABLED`.

### Data model changes

- See `ncmec_cases/{caseId}` above.

### Firestore rule deltas

```
match /ncmec_cases/{caseId} {
  allow read, write: if false;
}
```

### Backend interface

`GET /api/admin/ncmec/pending`:
- **Auth:** platform admin.
- Returns pending cases, paginated.

`POST /api/admin/ncmec/{caseId}/submit`:
- **Auth:** platform admin.
- **Rate limit:** `NCMEC_SUBMIT`.
- **Behavior:**
  1. Read case doc.
  2. If `status != 'pending'` → 409.
  3. Build XML payload per NCMEC spec (operator id, evidence
     metadata, hash, optional uploader info).
  4. POST to NCMEC endpoint with retries (3 attempts, exponential
     backoff).
  5. On success: parse `ncmecReportId`; update case doc with
     `status: submitted`, `submittedBy`, `submittedAt`,
     `ncmecReportId`. Audit log `ncmec_submit`.
  6. On failure after retries: `status: failed`,
     `failureReason`. Sentry alert.

`POST /api/admin/ncmec/{caseId}/withdraw`:
- For false positives. **Operator must enter reason ≥ 50 chars.**
  Audit log `ncmec_withdraw`.
- Submit a withdrawal report to NCMEC if the case was already
  submitted.

### Frontend interface

- `frontend/app/admin/ncmec/page.tsx` — pending queue. Each case
  shows the gcsPath (admin-readable signed URL with short TTL),
  evidence sha256, suspect uid, "Submit" + "Withdraw" buttons.
- Confirmation modal on Submit: "This will file an external
  legal report. Are you sure?" — typed-confirmation
  ("type SUBMIT to confirm").

**Mobile parity:** Web only.

### Cloud Functions

`onPhotoUploadFinalize.ts` extension:
- On CSAM hash match: write `ncmec_cases/{caseId}` doc with
  status pending; the existing `_held/` move stays. Email the
  on-call admin (`docs/runbooks/csam-incident.md` lists the
  on-call rotation).

### Test plan

**Backend (`backend/tests/test_ncmec.py`):**
- `simulated match creates pending case`.
- `submit calls NCMEC endpoint with the right payload`.
- `submit retries on 500 error`.
- `submit timeout marks failed and alerts`.
- `withdraw with reason < 50 chars returns 400`.

**Functions:**
- `CSAM hash match writes ncmec_cases pending and sends email`.

**Rules:**
- `client cannot read or write ncmec_cases`.

### Edge cases / gotchas

- **Fail-closed.** If the NCMEC endpoint is unreachable when an
  operator clicks Submit, the request fails with a clear error;
  the file stays in `_held/`. The upload itself was already
  blocked by T10.
- **No automatic submission.** Operator-gated only. Document.
- **Chain of custody.** Evidence path + sha256 + size are
  immutable on the case doc. The case doc itself is append-only
  — once submitted, the only allowed transition is to
  `withdrawn`.
- **Retention.** 90 days minimum (default `retainedUntil`);
  operator can extend per legal advice. After
  `retainedUntil`, files in `_held/` are eligible for deletion
  via the bucket lifecycle (T63 sets a 7-year max).
- **Suspect uid.** Only set if known (the uploader); in
  user-report flows the suspect may differ. Document the
  semantics.
- **Logs.** Never log evidence content. Log case id, sha256,
  size.
- **Operator account ownership.** The NCMEC operator account
  belongs to JACOB the entity, not an individual. Document
  ownership transfer in the legal doc.
- **Audit.** Every status transition writes audit_log.

### Migration / rollout

- Feature flag: not gated (legal compliance — always on once
  endpoint is wired).
- Env vars: `NCMEC_API_KEY`, `NCMEC_OPERATOR_ID`,
  `NCMEC_ENDPOINT`, `NCMEC_SUBMIT_DISABLED`.
- Pre-launch: legal counsel signs off on the operator account
  setup and the chain-of-custody documentation. Recorded in PR.

### Dependencies

- T10 (CSAM hash check), T13 (admin claim), T18 (email).

### Estimated complexity

Medium-large. The legal review loop is the bottleneck, not the
code. Two Opus sessions, ~3 days (mostly the doc + sandbox
testing).

---

## T64 — Appeals process for moderation actions — **Opus**

**Goal:** Every moderation action gets an appeal path. The user
receives an email with a link, can write a one-time appeal, and a
different admin reviews. Outcome and reasoning are visible to the
appellant.

### Why Opus

Due-process surface; the rules around who-reviews-what need to be
airtight or moderation looks arbitrary. The "different admin" rule
must be enforceable in single-admin environments (dev / small
deployments) without a security regression — that's the judgment
call. The reversal-on-decide transactional shape (un-hide message,
lift ban, restore archive) is non-trivial.

### Acceptance criteria

- A user whose message was hidden receives an appeal email;
  clicking opens the appeal page; submitting writes the doc.
- A different admin can decide; on reversed, the message un-hides
  and the user is notified.
- The original actor cannot decide their own appeal (403 from
  backend; UI hides the button).
- An appeal past 7 days surfaces an OVERDUE banner.
- All decisions write audit_log rows.
- A second appeal on the same subject by the same user returns 409.

### Files to create

- `appeals/{appealId}` (top-level Firestore):
  ```ts
  {
    subject: { type: string, ref: string },
    appellantUid: string,
    originalActorUid: string,
    originalActionAt: Timestamp,
    submittedAt: Timestamp,
    body: string,                // user's appeal text, ≤ 2000 chars
    decision: 'pending' | 'upheld' | 'reversed',
    decidedBy: string | null,
    decidedAt: Timestamp | null,
    reasoning: string | null,    // admin's reasoning, ≤ 2000 chars
    schemaVersion: 1,
  }
  ```
- `appeal_eligible_actions/{actionId}` (P17 shape).
- `backend/app/routers/appeals.py`.
- `backend/app/services/appeals.py` — encodes the "different admin"
  rule + the reversal logic.
- `backend/app/templates/email/moderation_action.html.j2` (extends
  existing notification with appeal link) +
  `appeal_decision.html.j2` for the outcome notification.
- `frontend/app/appeals/[appealId]/page.tsx` — appellant UI.
- `frontend/app/admin/appeals/page.tsx` — admin queue.
- `frontend/app/admin/appeals/[appealId]/page.tsx` — admin detail.
- `infra/scheduled/appeal_overdue_check.py` — daily; surfaces
  overdue appeals on the admin queue + email reminder.

### Files to modify

- `firestore.rules` — `appeals` rules + `appeal_eligible_actions`.
- `firestore.indexes.json` — `appeals.decision+submittedAt ASC`.
- `backend/app/limits.py` — `APPEAL_SUBMIT: "3/day"`.
- `backend/app/config.py` — `appeal_link_ttl_days: int = 14`,
  `appeal_decision_sla_days: int = 7`.
- `backend/app/routers/admin.py` — every moderator action
  (`hide_message`, `ban_user`, `archive_group`) writes an
  `appeal_eligible_actions/{actionId}` doc + sends the action
  email with the appeal token.
- `docs/community-guidelines.md` — extend with appeals policy
  + SLA.
- `audit_log` — every decision writes a row.

### Data model changes

- See `appeals/{appealId}` and `appeal_eligible_actions/{actionId}`.

### Firestore rule deltas

```
match /appeals/{appealId} {
  allow read: if isUser(resource.data.appellantUid)
              || (request.auth.token.admin == true);
  // Submission via backend (signed JWT verifies appellant).
  allow create, update, delete: if false;
}

match /appeal_eligible_actions/{actionId} {
  allow read, write: if false;
}
```

### Backend interface

`POST /api/appeals`:
```python
class AppealSubmitRequest(BaseModel):
    appealToken: str             # JWT from email
    body: str = Field(min_length=20, max_length=2000)
class AppealSubmitResponse(BaseModel):
    appealId: str
```
- **Auth:** signed-in (the appellant).
- **Rate limit:** `APPEAL_SUBMIT` (3/day).
- **Behavior:**
  1. Verify JWT (issuer, expiry, signature).
  2. Verify the JWT subject uid matches the authed uid.
  3. Reject if a non-pending appeal already exists for
     `(subject.ref, appellantUid)` → 409 `appeal_already_decided`.
  4. Reject if a pending appeal exists → 409 `appeal_already_decided`.
  5. Write `appeals/{appealId}` with `decision: 'pending'`.
  6. Audit log `appeal_submit`.

`GET /api/appeals/{appealId}`:
- **Auth:** appellant or admin.
- Returns the appeal doc.

`GET /api/admin/appeals`:
- **Auth:** admin.
- Lists with filter (pending / decided / overdue).

`POST /api/admin/appeals/{appealId}/decide`:
```python
class DecideRequest(BaseModel):
    decision: Literal['upheld','reversed']
    reasoning: str = Field(min_length=20, max_length=2000)
class DecideResponse(BaseModel):
    appealId: str
    decision: str
```
- **Auth:** admin (NOT the original actor).
- **Rate limit:** `ADMIN_MUTATION`.
- **Behavior:**
  1. Read appeal doc; reject if `originalActorUid == auth.uid`
     (403 `appeal_self_review`).
  2. **Single-admin override:** if there is only one admin in the
     system AND that admin is the original actor, return 403
     with documented "manual escalation required" message
     (the runbook covers contacting another team for review;
     in dev / single-admin deployments, document the env-var
     override `JACOB_ALLOW_SELF_APPEAL_REVIEW=true` for testing
     only).
  3. In a transaction:
     - Update appeal doc: `decision`, `decidedBy`, `decidedAt`,
       `reasoning`.
     - If `decision === 'reversed'`:
       - Un-hide message (clear `moderation.state`), or
       - Lift ban (delete `bans/{uid}`), or
       - Un-archive group (clear `archivedAt`),
         depending on `subject.type`.
  4. Email the appellant with the outcome + reasoning.
  5. Audit log `appeal_decide`.

### Frontend interface

- **Appellant page:** read appeal status; if pending, show "We're
  reviewing — typically within 7 days." If decided, show outcome
  + reasoning + a button "Submit another appeal" — disabled
  (one-time only).
- **Admin queue:** filterable list. OVERDUE banner on items
  past SLA.
- **Admin detail:** appeal body + original action context +
  decide form (decision + reasoning).

**Mobile parity:** Mobile reads only (decisions are web-only in
v1).

### Cloud Functions

- **None.** Email + reversal happen in the backend transaction.

### Test plan

**Backend (`backend/tests/test_appeals.py`):**
- `submit with valid JWT writes appeal`.
- `submit with expired JWT returns 401`.
- `submit duplicate returns 409`.
- `decide reversed un-hides the message in a transaction`.
- `decide reversed lifts the ban`.
- `decide reversed un-archives the group`.
- `original actor cannot decide own appeal (403)`.
- `decide as different admin succeeds`.
- `daily overdue job surfaces ≥ 7-day-old pending appeals`.
- `appeal email sent on action with valid JWT in URL`.

**Frontend:**
- `appellant page renders status correctly`.
- `admin decide button hidden for original actor`.

**Rules:**
- comprehensive coverage.

### Edge cases / gotchas

- **JWT signing key.** Use the existing service account key OR
  a dedicated symmetric secret in Secret Manager. Document.
  v1: `JACOB_APPEAL_JWT_SECRET` env var.
- **JWT TTL** 14 days — long enough to give users a real chance,
  short enough to bound replay risk.
- **Reversal transactionality.** All-or-nothing: if the reversal
  side-effect fails, the decision write rolls back. Use Firestore
  transactions.
- **Single-admin dev environments.** Document the
  override env var for development; warn against in prod.
- **Appeal surface for AI-flagged messages that never resulted
  in a member-visible action.** No appeal — the action is the
  trigger, and an LLM advisory flag with no hide is not an
  action. Document.
- **Multi-stage appeals.** Phase 4 if pilot data shows we need
  it. Document.
- **Public outcome reports.** T65 covers aggregates.
- **Audit log search.** Querying audit_log by appellant uid or
  action id requires existing CG indexes (already present).

### Migration / rollout

- Feature flag: `appeals_enabled` (T58).
- Backfill: existing actions don't have eligible-action docs;
  the appeal email is wired going forward only. Document.
- Env vars: `JACOB_APPEAL_JWT_SECRET`,
  `JACOB_APPEAL_LINK_TTL_DAYS`,
  `JACOB_APPEAL_DECISION_SLA_DAYS`,
  `JACOB_ALLOW_SELF_APPEAL_REVIEW`.

### Dependencies

- T13 (admin), T14 (account flow), T18 (email), T19 (mod
  pipeline).
- Cross-task: T63 (NCMEC actions are NOT appealable through this
  surface; document).

### Estimated complexity

Large. Two Opus sessions, ~3 days.

---

## T65 — Quarterly transparency report + audit-log export — Sonnet

**Goal:** Generate a quarterly transparency report — moderation
actions, reports received, appeals decided, NCMEC submissions,
takedowns. Org admins get a per-org version. All redacted.

### Acceptance criteria

- A draft for the current quarter is generated by the scheduled
  job and visible to platform admins.
- "Publish" makes it readable on the public page.
- Per-org version generates correctly for a test org with 3 groups.
- Privacy-guard test passes (no PII leak).
- Audit-log export covers a date range and produces CSV that
  opens in Excel without quoting issues.
- Runbook checklist captures review-before-publish steps.

### Files to create

- `infra/scheduled/transparency_report.py` — quarterly Cloud Run
  job (1st of Jan/Apr/Jul/Oct).
- `backend/app/services/transparency.py` — assembles redacted
  aggregates from `moderation_queue`, `bans`, `appeals`,
  `ncmec_cases`, `audit_log`.
- `transparency_reports/{reportId}` (Firestore):
  ```ts
  {
    period: string,             // '2026-Q3'
    scope: 'platform' | string, // 'platform' or orgId
    payload: {
      moderationActions: { ... },
      reportsReceived: { ... },
      appealsDecided: { ... },
      ncmecSubmissions: { ... },
      accountActions: { ... },
      dataExportRequests: { ... },
    },
    generatedAt: Timestamp,
    publishedAt: Timestamp | null,
    publishedBy: string | null,
    schemaVersion: 1,
  }
  ```
- `frontend/app/transparency/page.tsx` — public-facing list of
  published reports.
- `frontend/app/transparency/[reportId]/page.tsx` — render.
- `frontend/app/admin/transparency/page.tsx` — admin queue (drafts
  + published).
- `frontend/app/orgs/[orgId]/transparency/page.tsx` — per-org
  version.
- `backend/app/routers/transparency.py`.
- `docs/runbooks/transparency-report.md` — review checklist
  before publish.

### Files to modify

- `firestore.rules` — `transparency_reports` rules.
- `firestore.indexes.json` —
  `transparency_reports.scope+period DESC`.
- `backend/app/limits.py` — `TRANSPARENCY_PUBLISH: "5/day"`.

### Data model changes

- See `transparency_reports/{reportId}`.

### Firestore rule deltas

```
match /transparency_reports/{reportId} {
  // Public reports (publishedAt set + scope = 'platform'): any signed-in.
  // Per-org reports: org admin only.
  allow read: if isSignedIn() && (
    (resource.data.scope == 'platform' && resource.data.publishedAt != null)
    || (resource.data.scope != 'platform' && isOrgAdmin(resource.data.scope))
    || (request.auth.token.admin == true)
  );
  allow create, update, delete: if false;
}
```

### Backend interface

`GET /api/transparency/latest`:
- **Auth:** signed-in.
- Returns the most recently published platform-scope report.

`GET /api/orgs/{orgId}/transparency`:
- **Auth:** org admin.

`POST /api/admin/transparency/{reportId}/publish`:
- **Auth:** platform admin (for platform-scope) OR org admin
  (for org-scope).
- **Rate limit:** `TRANSPARENCY_PUBLISH`.
- **Behavior:**
  1. Read draft.
  2. Run privacy-guard regex (P18). If matches → 422
     `transparency_pii_leak`.
  3. Set `publishedAt`, `publishedBy`. Audit log
     `transparency_publish`.

### Frontend interface

- **Public page:** list of published platform reports; clicking
  opens the rendered shape (charts + tables; no raw text).
- **Admin queue:** drafts + published with last-modified.
- **Per-org page:** same shape as platform but scoped.

**Mobile parity:** Public page reads on mobile; admin actions web
only.

### Cloud Functions

- **None.** Quarterly job is Cloud Run.

### Test plan

**Backend:**
- `quarterly job generates draft for prior quarter`.
- `privacy guard rejects payload containing a uid`.
- `publish updates publishedAt`.
- `audit-log export covers a date range`.

**Frontend:**
- `public page renders the latest published report`.

### Edge cases / gotchas

- **Privacy guard.** Regex scans for any base64-style token of
  length ≥ 20 (Firebase doc ids). If matches → block.
- **Round to 5 when bucket count < 25** (P18). Document the
  reason (re-identification protection).
- **Audit-log CSV.** Use `csv` module with QUOTE_ALL to avoid
  Excel quote issues.
- **Multi-language.** v1 reports in English only; document.
- **Per-org transparency for orgs with very low activity.** If
  any bucket has < 5 events, suppress that bucket entirely
  ("insufficient data"). Document.
- **Publish requires checklist sign-off.** Runbook lists the
  checklist; the "Publish" button has a typed-confirmation
  modal that requires the operator to type the period
  (e.g. `2026-Q2`) before submitting.

### Migration / rollout

- Feature flag: `transparency_reports_enabled` (T58).
- Quarterly job activates once T63 + T64 are both at 100%
  rollout (so the bucket categories are populated).

### Dependencies

- T13 (admin), T29 (analytics export), T38 (data export
  bundle reuse), T54 (org), T63 (NCMEC), T64 (appeals).

### Estimated complexity

Medium. One Sonnet session, ~2 days.

---

## 3. Cross-cutting Phase 2 deferred items absorbed by Phase 3

The Phase 2 review left six items on the cutting-room floor in
`docs/follow-ups/phase-2-deferred.md`. Each is mapped here to a
Phase 3 task that naturally absorbs it:

| Item | Absorbed by | How |
|------|-------------|-----|
| **M4** — `announce_message` blocking fan-out | T49 (events) sets the architectural pattern (notification fan-out via Cloud Function trigger keyed on a field), AND T57 (voice rooms) — the same pattern fans `voice_started` notifications. Apply the M4 fix as a prerequisite for T49: extract the fan-out into `onAnnouncementWrite.ts` (new trigger on `messages.announcedAt` change) so the announce endpoint returns immediately. The same trigger shape is reused for events and voice. **Decision:** Land the M4 fix as a small prep PR before T49. |
| **M7** — `runModeration` duplication | Already extracted in the C5 fix (per Phase 2 review fixes merged). Confirmed; nothing more needed in Phase 3. If T43's LLM tier extension surfaces drift, use the same shared service. |
| **M16** — `_events` markers grow unbounded | Use Firestore TTL on `processedAt + 7 days`. **T48** introduces a similar idempotency mirror in RTDB; while doing so, set the TTL policy on `_events`, `_reaction_events`, `_member_events`, `_unfurl_events`, `_embedding_events`, `_announcement_events`. One-shot config change. |
| **L9** — Sentry SSR exceptions | Address in the same PR as T59 (on-call) — the SSR exception path is part of the observability story, and the runbook references Sentry. Add `instrumentation.ts` per Next.js 14 docs. |
| **L11** — Typesense image pinned by tag | T45 extends the Typesense schema; while adding the vector field, pin the digest. Same PR. |
| **L14** — `_held/` has no Delete lifecycle | T63 adds the 7-year Delete lifecycle as part of the NCMEC retention work. Same PR. |

If Sonnet sessions touch any of these absorptions, follow the
listed task's spec; do not create a parallel PR.

---

## 4. Cross-task dependency map (visualized)

```
T54 (org) ──────────────────────────────────────────────────────┐
  │                                                             │
  ├──> T55 (custom domains)                                     │
  ├──> T56 (BJJ vertical)                                       │
  ├──> T57 (voice rooms — per-org cap)                          │
  ├──> T60 (group-health dashboard, org variant)                │
  ├──> T63 (NCMEC scope, org-aware)                             │
  ├──> T65 (transparency, org variant)                          │
  ├──> T43 (LLM moderation policy per org)                      │
  ├──> T44 (thread summary toggle per org)                      │
  ├──> T46 (semantic search per-org)                            │
  └──> T47 (prayer clustering per-org)                          │
                                                                │
T58 (feature flags) ────────────────────────────────────────────┤
  │                                                             │
  └──> Every T40-T57, T59-T65 ships behind a flag               │
                                                                │
T45 (embeddings) ──> T46 (semantic search)                      │
              └───> T47 (prayer matching)                       │
                                                                │
T48 (RTDB) ──> T50 (watch together)                             │
        └───> T57 (voice rooms — RTDB participants)             │
                                                                │
T40 (mobile) ──> T41 (native push)                              │
         └───> T42 (Apple sign-in flow)                         │
                                                                │
T34 + T41 (push) ──> T49 (event reminders)                      │
                └──> T57 (voice notifications)                  │
                                                                │
T20 (text moderation) ──> T43 (LLM tier)                        │
                  └────> T64 (appeals — hide → eligible action) │
                                                                │
T10 (CSAM) ──> T63 (NCMEC reporting)                            │
                                                                │
T63 + T64 ──> T65 (transparency aggregates)                     │
```

The two highest-leverage early blocks are:

- **T54 (orgs) + T58 (feature flags).** Land both early; they
  unlock the rest.
- **T48 (RTDB introduction).** Lands the realtime infra T50 and
  T57 share.

---

## 5. AI/safety surface — quick index

For an audit pass focused on AI safety + theological-or-safety-
sensitive logic, the relevant tasks and their most-load-bearing
subsections:

| Task | Surface | Subsection |
|------|---------|------------|
| T43  | LLM moderation never auto-hides | "Edge cases / gotchas: prayer / testimony false positives" |
| T44  | Leader-canonical override        | "Edge cases / gotchas: Save button delay" |
| T45  | Embedding cost guardrail         | "Cost spikes" gotcha |
| T46  | Permission boundary re-verification | ADR addendum |
| T47  | Opt-in prayer matching, no public counts | "Edge cases / gotchas: No public counts" |
| T54  | Phase 2 test suite must continue to pass | "Edge cases / gotchas: Phase 2 test suite" |
| T55  | Cookie scope across domains      | "Edge cases / gotchas: Cookie scope" |
| T57  | No recording in v1 + abuse mitigations | "Edge cases / gotchas: No recording" |
| T63  | NCMEC fail-closed                | "Edge cases / gotchas: Fail-closed" |
| T64  | Different-admin rule              | Backend `decide` step 2 |
| T65  | Privacy guard regex              | "Privacy-redacted aggregate" P18 |

Pull these subsections out for the security-focused review pass.

---

## 6. Open questions / DESIGN-OPEN

All six items below have **resolved recommendations** in
`docs/phase-3-design-decisions.md` (2026-05-03). The
recommendations are awaiting rubber-stamp before being folded
into ADRs at implementation time. Each entry below summarizes
the resolution; see the decisions doc for the *why*, cost
analysis, reversibility, and vendor pricing citations.

1. **T57 — LiveKit Cloud vs self-hosted.** **Resolved:**
   LiveKit Cloud, Build (free) tier. Stay under 5,000 WebRTC
   minutes/month with a global cap of 4,000 minutes. ADR 0008
   ratifies. **Owner:** platform.
2. **T59 — PagerDuty vs Opsgenie.** **Resolved:** PagerDuty
   Free (5 users, 100 phone+SMS/month, no card). Drop Opsgenie
   from the spec — its free tier has no voice and Atlassian
   has announced EOL 2027-04-05. ADR 0009 ratifies.
   **Owner:** platform.
3. **T59 — Status page vendor.** **Resolved:** Better Stack
   Status (free tier; custom domain on `status.jacob.app`).
   Atlassian Statuspage no longer has a free tier. Self-hosted
   cstate on Firebase Hosting is the documented Plan B if
   Better Stack pricing changes. ADR 0009 ratifies.
   **Owner:** platform.
4. **T63 — NCMEC submission protocol.** **Resolved:** HTTPS
   REST + XML at `https://report.cybertip.org/ispws/`. SOAP is
   not actually offered by NCMEC; the open question dissolved
   on contact with the current operator docs. ADR 0010
   ratifies. **Owner:** legal + platform.
5. **T55 — Vanity domain provisioning surface.** **Resolved:**
   Two-tier — Firebase Hosting wildcard for `*.jacob.app`
   subdomains; Cloud Run domain mappings for operator-DNS
   vanity domains; upgrade to External HTTPS LB only on a
   forcing function (latency, Cloud Armor need, own-cert
   requirement). Replace `infra/cloudfront.tf` (no AWS in our
   stack) with `infra/firebase-hosting-domains.tf` +
   `infra/cloud-run-domain-mappings.tf` when T55 is picked up.
   No standalone ADR — captured in the decisions doc.
   **Owner:** platform.
6. **T47 — Prayer cluster eps tuning.** **Resolved:** Default
   `prayer_clustering_eps = 0.18` (down from 0.25 in this
   spec; theology-first asymmetric-harm posture). Add per-org
   override `orgs/{orgId}.prayerClusteringEps: number | null`
   (platform-admin write only, default null). No leader-facing
   tunability in v1. ADR 0006 ratifies. **Owner:** pilot
   leader + product.

These are the only open items at the time of writing. Every
other task pre-decides the architectural shape. If a Sonnet
session opens a new design question during implementation, treat
it as a *finding*, file in `docs/follow-ups/phase-3-deferred.md`,
and continue with the explicit fallback documented in the spec.

---

*End of Phase 3 implementation spec.*
