# Phase 3 — Parked work (cost / product gates)

Phase 3 tasks that did **not** ship in the May 2026 sprint because
they require a product decision, an external account / contract, or
recurring cost we have not yet committed to. These are distinct from
the engineering deferrals tracked in `phase-3-deferred.md` — those
are "we know what to do, we just haven't done it." Items below are
"we know what to build, but we haven't decided whether or when to
spend on it."

Each entry: scope, why parked, estimated cost-when-shipped, what
would need to happen to revive.

---

## T50 — Watch Together (synchronized YouTube playback) — PARKED 2026-05-17

**Scope:** Group members watch a YouTube video together in sync.
Leader starts a session; followers join and playback stays coordinated
via Firebase RTDB. Session metadata (attendees, duration) written to
`groups/{gid}/watch_sessions/{sessionId}` in Firestore.
See `docs/phase-3-dev-plan.md § T50` and `docs/phase-3-impl-spec.md § T50`.

**Why parked:** Ministry owner explicitly deferred all video features.
No timeline given; revisit when the product direction on video is settled.

**What's built:**
- `backend/app/routers/watch.py` — 6 REST endpoints (list, get, start, join,
  end, transfer)
- `backend/app/services/watch.py` — business logic
- `backend/app/models/watch.py` — pydantic models
- `frontend/app/groups/[gid]/watch/[sessionId]/page.tsx` — session page
  (currently shows a "not available" message; full component in git history)
- `frontend/lib/hooks/useWatchSession.ts` — React hooks
- `infra/firebase-rtdb-rules.json` — RTDB playback-state rules (still enforced)
- Firestore collection `groups/{gid}/watch_sessions` (default-deny, stays as-is)

**Current state (parked):**
- All backend endpoints return `503 feature_paused` because the
  `feature_flags/watch_sessions` Firestore document does not exist (absent ⇒
  disabled). The routes and code are fully in place.
- The `/groups/[gid]/watch/[sessionId]` frontend route renders a
  "not available" message instead of the session UI.
- The "Watch with the group" button on the sermon page is disabled with a
  "not available" label.
- Backend tests: `backend/tests/test_watch.py` — all skipped via `pytestmark`.
- Frontend tests: `frontend/tests/watch.test.tsx` — skipped via `describe.skip`.

**To re-enable:**
1. Product sign-off that video features are back on the roadmap.
2. Create `feature_flags/watch_sessions` in Firestore with `enabled: true`
   (the endpoint gate checks this document on every request).
3. Restore the full frontend session page from git history (the pre-parking
   commit on `chore/park-watch-sessions`).
4. Remove `describe.skip` from `frontend/tests/watch.test.tsx`.
5. Remove `pytestmark` skip from `backend/tests/test_watch.py`.
6. Update the sermon-page button back to "Watch with the group (coming soon)"
   and wire up the start-session flow.
7. Restore nav entries if any are desired.

---

## T40 — React Native (Expo) shell

**Scope:** RN/Expo shell with auth, chat, threads parity to web
(text input only — no photo upload until the moderation pipeline
has a tested mobile entry point). See
`docs/phase-3-dev-plan.md:97-129`.

**Why parked:**
- Apple Developer Program membership is required to TestFlight or
  ship to the App Store: **$99/year**.
- Two app-store review surfaces to maintain (App Store + Play
  Store) plus the EAS build pipeline.
- Without T40, T41 (native push) and T42 (Sign in with Apple) are
  also blocked — Apple sign-in is only required by App Store
  policy for apps with non-Apple SSO; the web app already uses
  Google sign-in and does not need Apple.

**Estimated cost when shipped:**
- $99/yr Apple Developer.
- $0 Google Play (one-time $25 already paid or to be paid by the
  org account at registration).
- EAS Build free tier covers staging-build cadence; paid tier
  ($29/mo+) only if build queue becomes a bottleneck.
- Engineering: ~3 weeks for parity to web (chat + threads) per
  the spec.

**To revive:**
1. Decision to spend $99/yr (and to maintain a second + third
   release surface).
2. Choose which audience pays for it first (BJJ pilot? a partner
   church? small-group leaders broadly?).
3. Scaffold the Expo project under `mobile/` (workspace member);
   reuse `frontend/lib/api.ts` shape on the RN side.

---

## T41 — Native push notifications (APNs + FCM)

**Scope:** Native iOS/Android push for the same notification kinds
T34 already serves on web (mentions, replies, announcements) plus
event reminders (T49) and voice-room invites (T57 — also parked).
See `docs/phase-3-dev-plan.md:131-159`.

**Why parked:**
- Hard-blocked on T40. There is no native shell to register the
  device token.
- APNs requires the same Apple Developer account as T40.
- FCM is free for both registration and delivery on Firebase Spark
  /Blaze; no additional cost.

**Estimated cost when shipped:**
- $0 incremental on top of T40 (FCM is free, APNs is part of the
  Apple Developer Program).
- Engineering: ~1 week, mostly re-using `users/{uid}/devices/{did}`
  + `users/{uid}/notifications/{nid}` data shape T34 established.

**To revive:** ships immediately after T40.

---

## T42 — Identity expansion (passkeys, Apple, magic links)

**Scope:** Three new sign-in paths alongside email/password and
Google: WebAuthn passkeys, Sign in with Apple, magic links.
See `docs/phase-3-dev-plan.md:163-190`.

**Why parked:**
- Sign in with Apple is the only piece blocked on the Apple
  Developer Program; passkeys + magic links are not.
- We could ship the passkey + magic-link halves *without* Apple,
  but the spec was scoped as a single task — splitting reopens
  the ADR.
- Magic-link delivery costs sit on the existing SendGrid budget;
  passkeys are free (browser-native).

**Estimated cost when shipped:**
- $0 incremental for passkey / magic-link.
- Apple sign-in: bundled with the $99/yr T40 spend.
- Engineering: ~1 week if scoped to passkey + magic-link only;
  ~2 weeks for the full three-path expansion.

**To revive:**
- *Half-revive* (passkey + magic-link): write a shorter ADR
  scoping it to two paths and ship it. No external dependency.
- *Full revive*: requires T40's Apple spend.

---

## T43 — LLM-assisted text moderation (pre-flag with reasoning)

**Scope:** A second-tier moderation review that runs Claude on
content the perspective-API tier flagged ambiguous, and writes a
plain-English reason next to the flag for the moderator queue.
**Never** auto-hides — leader/moderator action only. Uses Opus
because false positives silence real prayer requests.
See `docs/phase-3-dev-plan.md:194-226`.

**Why parked:**
- Recurring API spend that scales with moderation volume.
- Rough cost model: ~5% of messages are flagged by tier-1, of
  which Opus reviews each. At Opus pricing (~$15/MTok input,
  ~$75/MTok output) and a ~1k-input / ~200-output average per
  flag, per-flag cost ≈ $0.03. A pilot org with 1k messages/day
  and 5% flag rate ⇒ $1.50/day ⇒ $45/month per org. Manageable
  per-pilot; reckless at scale without a per-org budget cap.
- The cost guardrail (per-org `aiBudgetUSDPerMonth` ceiling, with
  fail-closed flag once exhausted) is part of the spec but not
  yet implemented.

**Estimated cost when shipped:**
- API: $30–$80/mo per active pilot org (depends on flag rate).
- Engineering: ~1 week. Opus session.

**To revive:**
1. Decision to spend ~$50/mo per pilot org (or to set the
   budget ceiling lower).
2. Implement the cost guardrail first (per-org monthly cap +
   fail-closed flag) as a prereq, not just spec.
3. Ship behind T58 feature flag `ai_text_moderation` so it can
   be disabled per-org without a deploy.

---

## T44 — Thread summarization with leader-canonical override

**Scope:** A "Summarize this thread" action visible only to
leaders. Opus drafts; leader edits and saves. The saved summary is
canonical (members see it, search retrieves it). Saved summaries
include `modelDraftHash` so a future audit can confirm whether the
leader edited or accepted verbatim. **Never** auto-summarizes.
See `docs/phase-3-dev-plan.md:230-261`.

**Why parked:**
- Recurring API spend per leader-initiated summary.
- Rough cost model: ~$0.05–$0.10 per summary at typical thread
  sizes. Low absolute cost, but it scales with leader activity.
- Subordinate to T43 in priority — moderation false positives
  silence real users; missing a summary is a UX gap.

**Estimated cost when shipped:**
- API: $5–$30/mo per active org (depends on leader summary use).
- Engineering: ~3–5 days. Opus session.

**To revive:**
1. T43 ships first (proves the AI-safety guardrail pattern P10
   in production).
2. Decision to spend a few dollars per org per month on summary
   drafts.
3. Ship behind T58 feature flag `ai_thread_summary`.

---

## T45 — Embeddings export pipeline + admin tuning surface

**Scope:** Compute embeddings on message create, store as a vector
field in the Typesense sidecar (T28), expose an admin tuning page
to inspect cost and recompute for a date range. Hard prerequisite
for T46 (semantic search) and T47 (prayer clustering).
See `docs/phase-3-dev-plan.md:265-292`.

**Why parked:**
- Recurring API spend that scales with **all** messages, not just
  flagged ones.
- Rough cost model: at OpenAI `text-embedding-3-small` pricing
  (~$0.02/MTok), and ~50 tokens/message average, per-message
  cost ≈ $0.000001. A pilot org with 1k messages/day ⇒ $0.001/day
  ⇒ $0.03/month per org. **Cheap.** The driver is volume; even at
  100k messages/day across the platform, monthly spend is ~$3.
- The expensive part is the Typesense Cloud Run footprint when
  the vector field is enabled (memory grows with the index).
  Likely a doubling of the current Typesense instance size.

**Estimated cost when shipped:**
- API: ~$3–$10/mo across the platform.
- Typesense: +$15–$30/mo Cloud Run overhead for the vector index.
- Engineering: ~1 week.

**To revive:**
1. Decision to spend ~$25/mo (mostly Typesense, minimally API).
2. Pin Typesense image digest as part of the same PR (closes
   L11 follow-up too).
3. Ship behind T58 feature flag `ai_embeddings`.

---

## T46 — Semantic message search (vector sidecar)

**Scope:** A "Search by meaning" toggle on the existing search bar.
Backed by Typesense vector search using T45 embeddings, scoped to
the same per-group permission boundary T28 established. Uses Opus
on the *query expansion* path (the search is Typesense; Opus
rephrases the query).
See `docs/phase-3-dev-plan.md:296-323`.

**Why parked:** Hard-blocked on T45.

**Estimated cost when shipped:**
- API: ~$5/mo across the platform (one Opus rephrase per
  semantic search; semantic search is opt-in toggle).
- Engineering: ~3–5 days on top of T45.

**To revive:** ships immediately after T45.

---

## T47 — Prayer-request clustering and "praying for" matching

**Scope:** Weekly job clusters prayer-tagged messages by cosine
similarity on T45 embeddings; surfaces "members praying for similar
things" in the leader digest. Opus drafts cluster summaries (same
leader-canonical-override pattern as T44). Opt-in only — no
aggregate counts revealed to the requester.
See `docs/phase-3-dev-plan.md:327-359`.

**Why parked:**
- Hard-blocked on T45.
- Most theologically sensitive surface in the plan: the prayer
  cluster is asymmetric-harm (false-positive surfaces an unwanted
  match; false-negative is silence). Default `eps=0.18` per
  `phase-3-impl-spec.md §6.6` is conservative; per-org override
  reserved for platform admin.

**Estimated cost when shipped:**
- API: ~$2/mo per active org for cluster summary drafts.
- Engineering: ~1 week on top of T45. Opus session.

**To revive:** ships after T45 + T46 prove the embedding pipeline is
stable. Pilot with one org first.

---

## T57 — Voice rooms (LiveKit) for small groups

**Scope:** LiveKit Cloud–backed voice rooms for small groups.
Leader starts; up to 25 participants; 60-min hard cap; **no
recording** in v1. Notifications via T34/T41 (so partly blocked on
T41 for native parity, but web-only rollout is possible).
See `docs/phase-3-dev-plan.md:646-681` and `phase-3-impl-spec.md
§6.1` (ADR 0008 was planned to ratify the LiveKit vendor decision but was never written since T57 was parked).

**Why parked:**
- Pure product call. The Phase 3 sprint shipped every other live /
  realtime piece (T48 presence, T49 events, T50 Watch Together)
  but voice introduces a different abuse surface (live audio,
  real-time moderation harder than text) and a recording-policy
  decision we have explicitly deferred.
- LiveKit Cloud Build tier is free up to 5,000 WebRTC minutes/
  month with a global cap of 4,000 minutes wired into the spec —
  zero recurring spend at pilot scale.

**Estimated cost when shipped:**
- $0 LiveKit Cloud at pilot scale (Build tier).
- $50–$100/mo if usage tips into the Ship tier (~50k WebRTC
  minutes/month; well above pilot need).
- Engineering: ~2 weeks.

**To revive:**
1. Product decision: do we want voice in the product, given the
   abuse posture and the recording-policy deferral?
2. If yes, write the v1 abuse-mitigation runbook (room-leader
   kick, reporting flow, no-recording disclosure UI) before
   coding.
3. Pilot with one or two trusted small groups; scale only when
   the abuse picture is understood.

---

## M5 — SSE / sub-second realtime

**Scope:** Replace the 10s polling pattern in chat + threads with
server-sent events (SSE) from FastAPI for true sub-second push.
The data-layer migration (M1–M6) deliberately deferred this:
post-M6 we keep polling because it's free.

**Why parked:**
- SSE on Cloud Run requires `min-instances ≥ 1` per region for
  any realtime guarantees (otherwise connections drop on cold
  start and reconnect storms cost more than polling). At
  ~$15–$30/mo per always-warm instance, this is recurring spend
  with no Phase 3 forcing function.
- Polling at 10s is acceptable UX for chat; presence + typing
  (T48) already use RTDB for the sub-second case.
- The "right" answer at scale is probably WebSockets via a
  separate service (or Firestore-realtime *back* once the
  adblocker problem is solved by an account-attached Firestore
  proxy), not SSE. Locking in SSE now risks two migrations.

**Estimated cost when shipped:**
- Cloud Run min-instance: $15–$30/mo per region.
- Engineering: ~1 week for the SSE shim; significantly more if we
  move to WebSockets.

**To revive:**
1. A real UX complaint about the 10s lag (we have not had one
   yet).
2. Decision on the right transport (SSE vs. WS vs. Firestore-via-
   proxy). ADR required.
3. Decision to pay the always-warm-instance cost.
