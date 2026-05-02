# JACOB — Phase 3 Dev Plan

This is the development plan for Phase 3 of JACOB (the "Platform" phase). Read `CLAUDE.md` first — it pins the conventions every task here inherits — then skim `docs/phase-2-dev-plan.md` (T19–T39) for context on what this builds on. Phase 3 picks up where Phase 2's `T39` left off.

## Goals

Phase 1 made JACOB work for one small group. Phase 2 made it feel like a community platform — discovery, reactions, threads, search, push, leader analytics. Phase 3 turns JACOB into a **platform**: native mobile, an organizational layer above groups, AI assistance with theological guardrails, live realtime, structured Christian content, and the trust-and-safety / reliability work that scale demands.

1. **Meet members where they are** — ship native iOS/Android, native push, and modern identity (passkeys, Sign in with Apple, magic links).
2. **Add an organizational layer** — model "church" / "ministry" / "gym" as a parent of groups, with org admins, branded workspaces, and the BJJ vertical riding on top of it.
3. **Introduce AI carefully** — moderation pre-flagging, thread summaries, semantic search, prayer-request matching. Every AI surface ships with a leader review path and a kill switch. We do not auto-publish AI-generated text into a religious context.
4. **Live and synchronous** — presence, typing, voice rooms for small groups, and structured live events (scheduled prayer times, Watch Together).
5. **Christian content as a first-class surface** — devotionals, reading plans, sermon archives, rich text & link unfurls so members can actually share what they're reading.
6. **Trust & safety at scale** — formal NCMEC reporting workflow, an appeals process for moderation actions, a quarterly transparency report.
7. **Reliability and operability for a real on-call** — feature flags with cohort targeting, staged rollouts, an incident playbook, accessibility deepening, and i18n foundation.

## Success criteria for Phase 3

- A pilot member installs the native iOS app from TestFlight, signs in with a passkey or Apple ID, and reaches the same chat surface as on web within 60 seconds. Push lands in under 10 seconds.
- A pastor running a multi-group church can manage three groups under one branded workspace at `our-church.jacob.app`, see a single dashboard of activity, and delegate moderation to a co-leader without an engineer touching Firestore.
- Every AI-generated artifact (auto-flag, summary, suggested match) is attributed as such in the UI, has a "wrong / hide / explain" feedback control, and is captured for monthly tuning review. No AI output is published or sent without the responsible leader (or the user themselves) opting in.
- A member can join a small-group voice room from web or mobile in under 10 seconds, with end-to-end audio in under 250 ms RTT median.
- The first NCMEC report fires end-to-end through the formal workflow in dev (with synthetic test data) and is confirmed by the test inbox.
- A leader can read a thread summary, fix it, and the corrected version becomes the canonical record — leader edit always wins over the model.
- Feature flags gate every Phase 3 task that lands behind a rollout. We can ramp to 10% / 50% / 100% from the admin UI without a deploy.

## Non-goals (explicitly deferred to Phase 4 or later)

- **Tithing / giving / paid courses / fundraising** — Phase 4. Christian apps and money are a flammable mix; we want the trust-and-safety baseline (T63–T65) and the org model (T54) in place first, and we want the legal/tax framing settled before we let dollars flow. T59 carries placeholder org-billing fields so the org doc isn't reshaped when paid tiers do land.
- **Public third-party API + OAuth for external integrations** — Phase 4. The org model (T54) and per-org workspaces (T55) need to settle before we expose stable surfaces to outside developers; otherwise the API contracts will reshape every quarter.
- **Federated moderation across orgs** — Phase 4. Each org owns its own moderation queue in Phase 3; cross-org moderation collaboration needs a trust framework we don't have yet.
- **Watch Party for live-streamed sermons that JACOB hosts** — Phase 4. T52 (Watch Together) covers synchronized playback of YouTube-hosted content; hosting our own video is a Phase 4 cost decision.
- **Translation memory / human-in-the-loop translation review** — Phase 4. T63 ships the i18n foundation (en + es, RTL-ready) but does not promise non-English translation parity.
- **Cross-group DMs** — still deferred. Phase 2 said "Phase 4 if at all"; that judgment stands.
- **E2EE** — still never. Architectural decision unchanged: server-side encryption only.
- **Multi-region data residency for EU users** — Phase 4. Phase 3 keeps `nam5`. T63 documents the constraint in the i18n runbook.
- **Web3 / on-chain anything** — never.

## Dependencies on Phase 2

Phase 3 assumes everything in `docs/phase-2-dev-plan.md` (T19–T39) shipped. Where a Phase 3 task touches a Phase 2 surface that's incomplete or ambiguous, the dependency is called out in the task spec. The high-leverage upstream tasks are:

- T22 (multi-leader hierarchy) — every Phase 3 leader-permissioned surface uses it.
- T28 (search sidecar) — T46 (semantic search) extends the same Typesense deployment with vector search; the ADR from T28 is amended, not rewritten.
- T29 (sticker analytics + BigQuery export) — T60 (group-health dashboard) extends the same export pipeline.
- T34 (web push + `users/{uid}/notifications` collection) — T41 (native push) reuses the same notification source-of-truth.
- T38 (data export) — T62 (transparency report) reuses the bundle-assembly machinery for an aggregated, redacted org-level export.

## How to use this document with Sonnet

Each task below is a standalone spec sized for one focused Sonnet session. Workflow is unchanged from Phase 1/2:

1. Open a new Claude Code session in the repo. `CLAUDE.md` loads automatically.
2. Tell Sonnet: *"Implement task `Tnn` from `docs/phase-3-dev-plan.md`. Read the task spec, then propose a plan before writing code."*
3. Review the plan. Push back if any acceptance criterion is missing or the model is reaching outside the task's `Out of scope`.
4. Approve, let it implement, review the diff against acceptance criteria.

Reserve **Opus** for: `T43` (LLM moderation pre-flagging — false-positive cost is silencing a real prayer request), `T44` (thread summarization — the canonical-record problem), `T46` (semantic search — embedding pipeline crosses the per-group permission boundary that T28 established), `T47` (prayer-request matching — most theologically sensitive surface in this plan), `T54` (org model — new top-level resource and a complete reshape of group-membership semantics), `T55` (custom domains — TLS / DNS / cookie scope), `T57` (live voice rooms — realtime infra, abuse vectors, recording policy), `T63` (NCMEC formal reporting workflow — legal compliance and irreversible external action), `T64` (appeals process — moderation reversibility / due-process surface), and any task whose Sonnet plan looks shaky.

The remaining tasks follow patterns Phase 1/2 already established and are appropriate for Sonnet.

## Task overview

| ID  | Task                                                       | Theme                          | Depends on            | Notes                  |
|-----|------------------------------------------------------------|--------------------------------|-----------------------|------------------------|
| T40 | React Native (Expo) shell — auth, chat, threads parity     | Native mobile                  | T04, T08, T09, T36    |                        |
| T41 | Native push notifications (APNs + FCM)                     | Native mobile                  | T34, T40              |                        |
| T42 | Identity expansion — passkeys, Sign in with Apple, magic links | Identity                   | T04                   |                        |
| T43 | LLM-assisted text moderation (pre-flag with reasoning)     | AI                             | T20, T39              | **Use Opus**           |
| T44 | Thread summarization with leader-canonical override        | AI                             | T09, T22              | **Use Opus**           |
| T45 | Embeddings export pipeline + admin tuning surface          | AI                             | T20, T28              |                        |
| T46 | Semantic message search (vector sidecar)                   | AI                             | T28, T45              | **Use Opus**           |
| T47 | Prayer-request clustering and "praying for" matching       | AI                             | T06, T08, T35, T45    | **Use Opus**           |
| T48 | Presence + typing indicators (per-group, leader-toggleable) | Live & realtime               | T07, T08              |                        |
| T49 | Scheduled events — prayer times, attendance, RSVPs         | Live & realtime                | T07, T22, T34, T41    |                        |
| T50 | Watch Together — synchronized YouTube playback             | Live & realtime                | T07, T48              |                        |
| T51 | Devotionals + reading plans                                | Christian content              | T33                   |                        |
| T52 | Sermon archives — leader-curated playlist                  | Christian content              | T07, T22, T50         |                        |
| T53 | Markdown messages + link unfurls                           | Christian content              | T08, T20, T28         |                        |
| T54 | Org model — group-of-groups, org admins, branded workspace | Multi-tenancy                  | T07, T22, T29         | **Use Opus**           |
| T55 | Custom domains per org (`our-church.jacob.app`)            | Multi-tenancy                  | T54                   | **Use Opus**           |
| T56 | BJJ vertical — sticker set, brand variant, audience switch | Multi-tenancy                  | T06, T30, T54         |                        |
| T57 | Voice rooms (LiveKit) for small groups                     | Live & realtime                | T07, T22, T34, T41    | **Use Opus**           |
| T58 | Feature flags + staged rollout admin                       | Reliability                    | T13, T15              |                        |
| T59 | On-call rotation + incident playbook + postmortem template | Reliability                    | T15, T58              |                        |
| T60 | Group-health dashboard for leaders/pastors                 | Insights                       | T22, T29, T54         |                        |
| T61 | i18n foundation — en + es seed, RTL-ready, locale routing  | International / a11y           | T11                   |                        |
| T62 | Accessibility deepening — chat screen-reader, switch ctrl  | International / a11y           | T08, T26, T36         |                        |
| T63 | NCMEC formal reporting workflow                            | Trust & safety                 | T10, T13, T18         | **Use Opus**           |
| T64 | Appeals process for moderation actions                     | Trust & safety                 | T13, T14, T18, T19    | **Use Opus**           |
| T65 | Quarterly transparency report + audit-log export           | Trust & safety                 | T13, T29, T38, T54    |                        |

26 tasks. A reasonable solo cadence: 1 task per 5–7 days. Phase 3 should land in 24–32 weeks. The highest-leverage early blocks are **Multi-tenancy** (T54–T56 unlock orgs, BJJ, branded workspaces, and analytics scoping) and **Reliability** (T58 unlocks the staged-rollout posture every other Phase 3 task assumes). Land T54 and T58 early.

---

## T40 — React Native (Expo) shell — auth, chat, threads parity

**Goal:** A first iOS + Android build that signs in with Firebase Auth, lists the user's groups, opens a group chat, sends messages with stickers, and reads threads. Feature parity is intentionally narrow — anything not in the parity set falls back to a webview link to the PWA.

**Files:**
- `mobile/` — new workspace; `pnpm create expo-app` with TypeScript, Expo Router, EAS Build configured
- `mobile/app/` — Expo Router screens: `_layout.tsx`, `(auth)/sign-in.tsx`, `(authed)/groups/index.tsx`, `(authed)/groups/[gid]/chat.tsx`, `(authed)/groups/[gid]/thread/[mid].tsx`, `(authed)/profile.tsx`
- `mobile/lib/firebase.ts` — Firebase init via `@react-native-firebase/app`
- `mobile/lib/hooks/` — copy + adapt the existing `useAuth`, `useGroups`, `useGroupMessages`, `useThread` hooks
- `mobile/components/chat/` — re-implement (not share — RN ≠ DOM) `MessageList`, `MessageItem`, `MessageInput`, `StickerPicker`
- `mobile/eas.json` — build profiles `development`, `preview`, `production`
- `.github/workflows/mobile-eas.yml` — build the iOS preview on every PR that touches `mobile/`, publish via EAS to internal distribution
- `mobile/README.md` — local dev (Expo Go vs. dev client decision), TestFlight enrollment, Play Console enrollment
- `pnpm-workspace.yaml` — add `mobile`

**Behavior:**
- Sign in: email/password, Google, and (after T42) passkey / Apple. Use `@react-native-firebase/auth`.
- Groups list reuses the existing `groups/{gid}/members` collection-group query the web hook uses (post-T39).
- Chat sends and receives top-level messages and threads via the same Firestore SDK paths. Text input only — photo upload is deferred to a Phase 3.5 (do **not** ship a photo path until the moderation pipeline has a tested mobile entry point).
- Anything not implemented (admin queue, settings, search, reactions) renders a "Open in browser" button that opens the PWA at the deep-link URL.
- Feature flag (T58): the entire mobile app is gated behind `mobile_native_enabled` so we can dark-launch.

**Acceptance criteria:**
- Internal-distribution iOS build installs on a TestFlight tester's device, signs in with Google, lists groups, sends a message, and the message appears on the web app within 2s.
- Same for Android via Play Console internal track.
- Firestore listeners are torn down on screen unmount (verified via a debug listener-count overlay enabled by env var).
- A non-member opening a deep-link to a group they don't belong to is shown a "request to join" screen, not a permission-denied stack trace.
- The "Open in browser" fallback appears for any unimplemented surface and opens the right deep link.
- EAS preview builds run in CI without a paid Apple Developer secret leaking into PR logs.

**Out of scope:** Photo upload (Phase 3.5 — needs the mobile-side moderation entry point), reactions / mentions / search (Phase 3.5 once the parity foundation is solid), in-app payments (Phase 4), offline writes (still deferred from T36).

---

## T41 — Native push notifications (APNs + FCM)

**Goal:** Native iOS and Android push delivery for the same notification kinds T34 already serves on web (mentions, replies, announcements) plus the new Phase 3 kinds (event reminders from T49, voice-room invites from T57).

**Files:**
- `mobile/lib/push.ts` — `expo-notifications` setup, APNs / FCM token registration
- `mobile/lib/hooks/usePushSetup.ts`
- `users/{uid}/devices/{deviceId}` — extend the schema from T34 with `platform: "web" | "ios" | "android"` and `appVersion`
- `functions/src/onNotificationCreate.ts` — extend the existing T34 trigger to fan to FCM (web), APNs (iOS native via FCM HTTP v1 API), FCM (Android native), keyed by device platform
- `mobile/app/(authed)/settings/notifications.tsx` — per-kind opt-in toggles, mirrors `frontend/app/settings/notifications/page.tsx`
- `docs/runbooks/push.md` — extend with native-channel troubleshooting (APNs cert renewal, FCM v1 service account)
- `infra/secrets.tf` — APNs auth key in Secret Manager; rotation runbook

**Behavior:**
- On first authed launch on mobile, request notification permission, register the device token, write `users/{uid}/devices/{deviceId}` with `platform`. Refresh on every cold start.
- Notification payload includes a deep link (e.g. `jacob://groups/g123/messages/m456`); tapping opens the right screen.
- The notification trigger checks the user's per-kind preferences (web and mobile share the same prefs) before sending. A user with mobile-only enabled does not get a web push for the same notification.
- Quiet hours: per-user `users/{uid}.notificationPrefs.quietHours` (start/end in user-local time). Notifications during quiet hours queue and deliver on the next eligible window — except for `kind: "announcement"` from a leader, which always delivers.
- Token revocation: signing out unregisters the device token and deletes the device doc.
- Stale-token cleanup (from T34) extended to platform-specific failure codes (`Unregistered` on iOS, `NotRegistered` on Android → delete device doc).

**Acceptance criteria:**
- A mention in a group surfaces a native push on the mentioned user's iPhone within 10s in dev (cold-starts excepted).
- Tapping the push opens the right thread.
- Quiet-hours suppression: a non-announcement push fired during a configured quiet window is held and delivered after the window. Verified with a test that fakes "now" via the function's clock-injection helper.
- APNs certificate / FCM v1 service-account rotation runbook in `docs/runbooks/push.md` is exercised against staging.
- Sentry captures `push_send_failed` with platform + reason (no PII in the breadcrumb).

**Out of scope:** Rich push (images, custom action buttons) — Phase 4; in-app notification center UI (the data lives in `users/{uid}/notifications/{nid}` already; the mobile inbox UI is Phase 3.5 work tracked separately).

---

## T42 — Identity expansion — passkeys, Sign in with Apple, magic links

**Goal:** Three new sign-in paths alongside the existing email/password and Google: WebAuthn passkeys (web + iOS 16+ / Android 14+), Sign in with Apple (required for App Store approval given T40), and email magic links.

**Files:**
- `frontend/components/auth/PasskeyButton.tsx`, `AppleSignInButton.tsx`, `MagicLinkForm.tsx`
- `frontend/lib/passkey.ts` — WebAuthn helpers (`navigator.credentials.create / get`, base64url encoding)
- `mobile/lib/auth/` — `applesignin.ts` (`expo-apple-authentication`), `passkey.ts` (`react-native-passkey`)
- `backend/app/routers/auth.py` — `POST /api/auth/passkey/register/options`, `POST /api/auth/passkey/register/verify`, `POST /api/auth/passkey/sign-in/options`, `POST /api/auth/passkey/sign-in/verify`. Passkey assertion is exchanged for a Firebase custom token via Admin SDK.
- `users/{uid}/private/passkeys/{credentialId}` — credential public key, sign counter, name, last-used. Owner-only read; no client write (registration goes through backend).
- `firestore.rules` — passkeys subcollection
- `docs/auth.md` — new doc: which methods are supported on which platforms, recovery flows, account-takeover threat model

**Behavior:**
- Passkey registration: signed-in user from settings adds a passkey. Backend issues a `PublicKeyCredentialCreationOptions` payload with a per-user challenge stored in a short-lived Firestore doc (`users/{uid}/private/passkeyChallenges/{challengeId}` with 5-min TTL). Client invokes WebAuthn, posts the attestation; backend verifies, stores the credential.
- Passkey sign-in: discoverable credentials (`allowCredentials: []`); backend resolves uid from the credential id, verifies the assertion, returns a Firebase custom token. Frontend signs in with `signInWithCustomToken`.
- Apple sign-in: Firebase OIDC provider; the only nuance is iOS native (T40) requires the Apple-native flow, which returns an Apple identity token that gets exchanged via Firebase's `OAuthProvider("apple.com")`.
- Magic link: Firebase's built-in `sendSignInLinkToEmail`, with a custom email template (T18). Expiry: 15 min. Single-use enforced by the existing Firebase action-code semantics.
- Account-recovery threat model: a user with passkey-only auth who loses their device falls back to magic link to their verified email; document this as the canonical recovery path. Document that we do **not** offer SMS recovery in v1 (SIM-swap risk).

**Acceptance criteria:**
- A user can register a passkey on Chrome/Safari (web) and on iOS 16+ (mobile) and use it to sign in on a different device that supports cross-device passkeys.
- Sign in with Apple works in TestFlight build and meets App Store guideline 4.8 (Sign in with Apple offered alongside any third-party SSO — Google).
- Magic link delivers in under 30 seconds via SendGrid sandbox; expired link returns a clear error page; reused link returns "already used."
- All four new paths produce a valid Firebase ID token that the backend's `get_current_user` accepts unchanged.
- `docs/auth.md` covers recovery, the no-SMS rationale, and the cross-device passkey flow.

**Out of scope:** SMS / phone auth (intentionally — SIM-swap risk for a community app), enterprise SSO (SAML / Okta) — overlaps with T54's org admin needs and is split out as a Phase 3.5 follow-up if a partner church asks, hardware-key-only enforcement (Phase 4 admin policy).

---

## T43 — LLM-assisted text moderation (pre-flag with reasoning)

**Goal:** A second layer of text moderation (after T20's Cloud NL classifier) that uses an LLM to pre-flag messages where the classifier was uncertain, *and* attaches a one-sentence reason in the moderation queue. The LLM is never the sole decider — it always raises a human-review event, never auto-hides on its own.

**This is the highest-stakes AI surface in Phase 3. False positives in a religious context look like silencing prayer or testimony — exactly the speech we want to protect. Use Opus.**

**Files:**
- `functions/src/onMessageCreate.ts` — extend the T20 trigger; if NL scores fall in the "uncertain" band (e.g. any category in `[0.4, 0.7]`), call the LLM tier
- `functions/src/services/llmModeration.ts` — Anthropic Claude Haiku 4.5 client (cheapest capable tier), with per-call cost tracking and prompt-caching enabled on the system prompt
- `backend/app/routers/admin.py` — `POST /api/admin/moderation/llm-policy` to set per-org sensitivity (off / advisory / aggressive)
- `firestore.rules` — `moderation_queue/{itemId}.llm` is system-only; UI can read but not write
- `frontend/app/admin/queue/[itemId]/page.tsx` — show the LLM reason inline, with explicit "AI suggestion · not a decision" treatment, plus a "model was wrong" feedback button
- `firestore` — new collection `llm_moderation_feedback/{eventId}` capturing reviewer action vs. LLM suggestion, for monthly review
- `docs/runbooks/llm-moderation-tuning.md` — kill switch, cost ceiling, monthly review checklist
- `docs/adr/0004-llm-moderation.md` — ADR: why a two-tier classifier, why never auto-hide, the prompt, the eval set

**Behavior:**
- Trigger only runs in the uncertain band; high-confidence NL hits already auto-hide via T20, low-confidence pass through. Cost-bound: ≤ 15% of messages should reach the LLM tier under normal operation. Daily cap (env var) enforced; on cap, log `llm_moderation_quota_exceeded` and skip.
- Prompt is fixed and committed to the repo. System prompt explicitly: this is a Christian small-group context; flag harassment, hate, sexual content, self-harm, and credible threats; do NOT flag prayer, testimony, biblical quotes, or earnest theological disagreement. Output: `{ flagged: bool, reasons: ["harassment" | ...], severity: 1|2|3, explanation: "<one short sentence>" }`. Use prompt caching on the system prompt — > 90% cache hit rate is a gate.
- On `flagged: true`, write a `moderation_queue` row with `llm: { reason, severity, model, promptVersion }` and `auto: true`. The message is **not** hidden — the human reviewer decides.
- Reviewer feedback: every reject/approve writes `llm_moderation_feedback/{eventId}` with `agreedWithModel: bool`, fueling a monthly precision/recall report.
- Per-org policy `off | advisory | aggressive`: `off` skips the LLM tier entirely; `advisory` is the default and matches the behavior above; `aggressive` lowers the uncertain band's lower bound to 0.25.
- Kill switch: `LLM_MODERATION_DISABLED=true` env var → trigger no-ops with an info log.

**Acceptance criteria:**
- A test message in the uncertain band produces a queue row with a one-sentence LLM explanation within 10s of post (cold-starts excepted).
- The message is **not** hidden by the LLM tier alone — verified by an integration test that posts an uncertain-band message and checks `messages/{mid}.moderation` is unset.
- Cost guardrail: a unit test with the daily cap mocked at 1 confirms the second uncertain message in a day skips the LLM tier and logs `llm_moderation_quota_exceeded`.
- The ADR documents: prompt, eval set, target precision/recall, monthly review process, who owns it.
- Prompt-cache hit rate over a 100-message synthetic eval is ≥ 90% (verified in CI fixture).
- Reviewer-action feedback writes are visible in the admin queue page and aggregate into a basic count in the runbook.

**Out of scope:** Auto-hiding on LLM signal alone (intentionally never), training a custom classifier (Phase 4 if the precision/recall data justifies it), multi-language LLM moderation beyond English (the prompt is English; flag non-English in the runbook).

---

## T44 — Thread summarization with leader-canonical override

**Goal:** A leader can request a one-paragraph summary of a long thread (≥ 10 replies). The model's output is shown as "Suggested summary — review before sharing." The leader edits to taste and saves; the saved version becomes the canonical record and the model's draft is discarded.

**Use Opus. The risk is exactly the same as the AI-pulpit problem: an unattended model output becomes the canonical record of what was said in a faith conversation. Leader-edit-always-wins is the architectural answer.**

**Files:**
- `backend/app/routers/threads.py` — `POST /api/groups/{gid}/threads/{mid}/summary/draft` (leader-only; calls the model), `POST /api/groups/{gid}/threads/{mid}/summary` (saves the leader's final text)
- `backend/app/services/thread_summary.py` — Anthropic Claude Sonnet 4.6 client (quality matters more than cost here), prompt cache on system prompt
- `groups/{gid}/messages/{mid}.summary` — `{ text, savedBy, savedAt, modelDraftHash, edited: bool }`. System-only write (rules deny client direct write).
- `frontend/components/chat/ThreadSummaryPanel.tsx` — leader-only UI, shows draft → edit textarea → save
- `frontend/components/chat/MessageItem.tsx` — render the saved summary inline at the top of the thread, with a "Summary by <leader>, edited from AI draft" attribution
- `docs/runbooks/thread-summary.md` — prompt, eval set, leader guidance ("edit, don't accept verbatim")

**Behavior:**
- Eligible threads: `threadReplyCount >= 10`. The "Summarize" button appears only for leaders and only on eligible threads.
- Draft endpoint reads up to the most recent 100 thread messages, calls the model with a fixed prompt (committed to the repo) — system prompt: "summarize the thread for someone who missed it, in 2-4 sentences, neutral and faithful to what was said. Do not editorialize, do not add scripture references that were not in the source." Returns the draft + the SHA-256 hash of the model output. The draft is **not** persisted on the message doc.
- Save endpoint accepts the leader's final text and stores it on `messages/{mid}.summary` with `modelDraftHash` (forensic trail) and `edited: true` (we always treat it as edited unless the hash matches verbatim).
- Members of the group see the saved summary inline; non-leaders cannot see drafts.
- Removing the summary is a leader action; clears the field and writes an audit row.
- Cost guardrail: rate-limit `summary/draft` to 5/leader/hour (T17 style).
- Kill switch: `THREAD_SUMMARY_DISABLED=true` env var.

**Acceptance criteria:**
- A leader requesting a summary on a 12-reply thread receives a draft within 8s; the draft is not persisted until the leader hits Save.
- The saved summary renders inline and is attributed to the leader (display name), with the "edited from AI draft" indicator if `edited: true`.
- Members (non-leaders) cannot call the draft endpoint (403) and cannot write `messages/{mid}.summary` from the client (rules test).
- Forensic trail: a saved summary always includes `modelDraftHash` so a future audit can confirm whether the leader edited or accepted verbatim.
- Rate limit: 6th draft request from the same leader in an hour returns 429.
- Eval: a fixture of 10 sample threads produces summaries that pass a manual review checklist in the runbook (no fabricated scripture, no editorializing) — checklist captured in the PR description.

**Out of scope:** Auto-summarizing (intentionally never — every summary is leader-initiated and leader-saved), member-facing "Summarize for me" (Phase 4 — different threat model), summarizing the whole group's day (Phase 4).

---

## T45 — Embeddings export pipeline + admin tuning surface

**Goal:** Build the embedding-generation pipeline that T46 (semantic search) and T47 (prayer matching) both depend on. Embeddings are computed on message create, stored in the Typesense sidecar (T28) as a vector field, and an admin tuning page lets us inspect cost and recompute for a date range.

**Files:**
- `functions/src/onMessageEmbed.ts` — Firestore trigger; on message create, calls the embeddings model and upserts the vector to Typesense alongside the existing T28 message index
- `functions/src/services/embeddings.ts` — embedding client (Vertex AI `text-embedding-004` to start; ADR justifies vendor choice)
- `infra/scheduled/reembed_messages.py` — Cloud Run job for date-range reembedding (e.g. when the model version changes)
- `frontend/app/admin/embeddings/page.tsx` — admin-only page showing daily count, cost, model version, last full-reindex date; "Recompute date range" form
- `backend/app/routers/admin.py` — `POST /api/admin/embeddings/reindex` (range-bounded, rate-limited)
- `docs/adr/0005-embeddings-pipeline.md` — vendor choice, model version, cost projection, kill switch

**Behavior:**
- On message create (after T20's text-moderation completes — chained via the existing trigger), call the embedding model with the message body. Upsert into the existing T28 Typesense collection with a new `embedding` field. Soft-deleted messages get their vector zeroed (or removed); hard-deleted messages have the doc removed (T28 already does this for the text path).
- Cost guardrail: hard daily cap (env var), default 50,000 calls/day. Over the cap, log `embedding_quota_exceeded`, skip; the message is still indexed for keyword search.
- Per-org policy: `groups/{gid}.embeddingsEnabled` (default true; can be disabled by the org admin if a specific group wants out — see T54).
- Reindex job: idempotent; takes a date range and a target model version; reads from Firestore (not BigQuery, so it sees current state) and reembeds. Resumable via a checkpoint doc.
- Admin page: daily counts (read from BigQuery analytics view extended with embedding events), cost ($ projection at the current Vertex price), kill-switch toggle (`EMBEDDINGS_DISABLED`).

**Acceptance criteria:**
- A new message gets an embedding in Typesense within 10s in dev (cold-starts excepted).
- Disabling embeddings for a group via `groups/{gid}.embeddingsEnabled = false` stops the trigger from calling the model on subsequent messages (verified by an integration test).
- The reindex job completes a 1-day range against a fixture of 1,000 messages in under 10 minutes; rerunning the same range produces the same vectors (idempotent).
- Daily cap: a unit test with the cap mocked at 1 confirms message #2 of the day is skipped with `embedding_quota_exceeded`.
- Admin page shows daily count and cost; kill-switch flips the env var via a Secret Manager round-trip and is reflected in the next trigger invocation.
- ADR documents the Vertex `text-embedding-004` choice and the upgrade path to a newer dimension.

**Out of scope:** User-supplied embeddings (the trigger is the only writer), embedding photo content (Phase 4 — multimodal embeddings + cost), per-language embedding tuning (deferred to T61 i18n work).

---

## T46 — Semantic message search (vector sidecar)

**Goal:** Extend the T28 search bar with a "Search by meaning" toggle. Backed by Typesense vector search using the embeddings from T45, scoped to the same per-group permission boundary T28 established.

**Use Opus. Crossing the permission boundary with vector search is exactly where T28's ADR warned against shortcuts.**

**Files:**
- `backend/app/routers/search.py` — extend with `mode=keyword|semantic` query param; semantic mode posts to Typesense's `/multi_search` with `vector_query`
- `backend/app/services/search.py` — embedding-on-the-fly for the user's query (cached in-memory for 5 min per query string), then vector search call, with the same `filter_by: groupId:[g1,g2,...]` clause as T28
- `frontend/components/search/SearchBar.tsx` — mode toggle, with explainer copy ("Searches by topic, not exact words")
- `frontend/app/search/page.tsx` — render results with a "Why this match?" disclosure showing the matched message and the relevance score
- `docs/adr/0002-search-sidecar.md` — amend with the vector-mode addendum

**Behavior:**
- The `?mode=semantic` path embeds the query text once (with the same model from T45, ensuring vector-space alignment), then issues a Typesense vector query with `k=20` and a `vector_distance_threshold` to drop noisy hits.
- Permission boundary: identical to T28 — backend resolves the user's group ids and includes them in `filter_by`. The client cannot query Typesense directly. **Re-document this in the ADR addendum** because the embedding-based recall is broader, and a permission bug here leaks more than a keyword-search permission bug would.
- Hybrid (combine keyword + semantic with reciprocal rank fusion) is supported as `mode=hybrid` and is the **default** for the UI; pure-semantic is opt-in for power users.
- Rate limit: 20/min/user for semantic (more expensive than keyword); 30/min for keyword stays as-is.
- Telemetry: log query length, mode, latency, result count (no query text — privacy).

**Acceptance criteria:**
- Searching "feeling overwhelmed at work" surfaces messages about stress / anxiety even when the literal words don't match (verified against a hand-built fixture of 50 messages with a 10-query relevance test).
- A user not in group `g1` cannot retrieve a `g1` message via semantic or hybrid search (integration test mirroring T28's).
- Semantic mode latency p95 ≤ 800ms in dev with a 10k-message corpus.
- The ADR addendum captures the recall-broadening risk and the permission re-verification.
- Telemetry: dashboards show keyword vs. semantic vs. hybrid usage split.

**Out of scope:** Cross-group semantic search (deliberately scoped to memberships, same as T28), search-by-image (Phase 4 — needs T45 multimodal extension), reranker models (Phase 4 if relevance proves insufficient).

---

## T47 — Prayer-request clustering and "praying for" matching

**Goal:** A weekly job clusters open prayer-tagged messages across a leader's groups (within the same org — T54) and surfaces a digest: "These three prayer requests are about job loss; consider responding to all three." Inside a group, an opt-in "Praying for this" surface lets members commit to a request and receive a quiet reminder.

**Most theologically sensitive surface in Phase 3. Use Opus. Pair with a leader review of the prompt + sample clusters before the job goes live.**

**Files:**
- `infra/scheduled/prayer_clustering.py` — weekly Cloud Run job
- `backend/app/services/prayer_clustering.py` — embedding similarity + small-cluster detection (DBSCAN-like with eps tuned per the ADR)
- `groups/{gid}/messages/{mid}.prayerCluster` — cluster id (system-set), nullable; clusters live at `prayer_clusters/{clusterId}` (org-scoped — see T54)
- `users/{uid}/prayingFor/{messageId}` — owner-only doc with `committedAt`
- `frontend/components/chat/PrayingForButton.tsx` — opt-in commit on a `prayer`-tagged message
- `frontend/app/groups/[gid]/prayer/page.tsx` — group prayer feed with "Praying for" counts
- `frontend/app/leaders/digest/page.tsx` — leader-only weekly cluster digest (within the org)
- `docs/runbooks/prayer-clustering-tuning.md` — eval set, theological-soundness checklist, kill switch
- `docs/adr/0006-prayer-clustering.md` — why opt-in, why org-scoped, theological framing

**Behavior:**
- Weekly job (Saturday 16:00 UTC): for each org, gather prayer-tagged messages (sticker `prayer`) created in the last 14 days, marked open (no `closedAt`). Cluster by cosine similarity on T45 embeddings. Drop clusters of size < 2.
- Write `prayer_clusters/{clusterId}` with `orgId`, member message refs, summary draft (from a model — same leader-canonical-override pattern as T44; the leader can edit before it appears in the digest), `createdAt`, `dismissedBy[]`.
- Leader digest view shows clusters with a "View all" link to each member request. Leader can dismiss a cluster (per-leader dismissal so co-leaders see independent state).
- "Praying for" commit: opt-in only — no aggregate counts revealed to the requester (they don't need a follower count on a prayer). Committers receive a once-a-week quiet in-app reminder ("You said you'd pray for X; the request is still open. View?"). Reminders are `notification` rows; routed through T34/T41 with respect for quiet hours.
- Fully off by default at the org level: `orgs/{orgId}.prayerClusteringEnabled = false`. Opt-in by an org admin after the leader has reviewed the runbook checklist.

**Acceptance criteria:**
- The clustering job run against a fixture of 50 prayer messages across 2 groups produces clusters that pass the theological-soundness checklist (no inappropriate cross-categorization — e.g. grief and joy never share a cluster).
- A member committing to "praying for" a request creates the doc; weekly reminder fires (verified with clock injection); committing user is **not** disclosed to the requester.
- Leader digest is visible only inside the org boundary; cross-org clustering is forbidden by query construction (verified in tests).
- Kill switch: `PRAYER_CLUSTERING_DISABLED=true` → job no-ops; per-org disable toggles work.
- ADR captures the theological framing (privacy of the requester, no counts shown back, opt-in stance).
- Runbook checklist signed off by a real pilot leader before flag-on in production (recorded in the PR description).

**Out of scope:** Cross-org prayer matching (Phase 4 — federation question), automatic public posting of cluster summaries (intentionally never — leaders edit-then-share), match-suggestion to non-leaders (Phase 4).

---

## T48 — Presence + typing indicators (per-group, leader-toggleable)

**Goal:** A "online now" indicator and Slack-style typing indicators inside a group chat. Leader-toggleable per group (some groups want the social signal; others find it intrusive). Built on Realtime Database (cheaper than Firestore for ephemeral state) — Phase 2 deliberately deferred this; the group sizes now justify it.

**Files:**
- `frontend/lib/firebase.ts` — add Realtime Database init
- `frontend/lib/hooks/usePresence.ts`, `useTyping.ts`
- `frontend/components/chat/PresenceBar.tsx`, `TypingIndicator.tsx`
- `infra/firebase-rtdb-rules.json` — RTDB rules: only members can write to a group's presence/typing path
- `mobile/lib/hooks/usePresence.ts`, `useTyping.ts` — mobile parity
- `groups/{gid}.presenceEnabled` — leader-only field, default true

**Behavior:**
- Presence: each client writes to `/presence/{gid}/{uid}` with `{ lastSeenAt: serverTimestamp, status: "online" }` on connect, sets `onDisconnect()` to update to `offline`. Client-side debouncing: only re-publish heartbeat every 60s.
- Typing: client writes to `/typing/{gid}/{uid}` with TTL semantics (the writer clears after 5s of inactivity; readers also drop entries older than 8s defensively).
- UI: group header shows a count of currently-online members; hovering shows the names. Typing indicator at the bottom of the message list ("Alice is typing…", up to 2 names then "and N others").
- Per-group disable: when `presenceEnabled = false`, clients skip writes and skip rendering. Leader toggle in group settings (T23).
- Cost cap: only the active group writes presence/typing. Leaving the group screen tears down the connection.

**Acceptance criteria:**
- Opening the group chat in two tabs as different users shows both as online within 3s.
- Closing the tab clears presence within 30s (RTDB `onDisconnect` cleanup verified).
- Typing in the input shows the indicator on the other tab within 1s; stopping for 6s clears it.
- Disabling presence for the group as a leader hides the indicators and stops the writes (verified by inspecting RTDB rules + traffic).
- RTDB rules deny writes from a non-member of the group.

**Out of scope:** Cross-group presence ("Alice is online in Group X") — privacy-violating by default; per-thread typing indicators — too noisy; "last seen N minutes ago" — overstepping for a community app.

---

## T49 — Scheduled events — prayer times, attendance, RSVPs

**Goal:** A leader can schedule an event (prayer time, study, gathering). Members RSVP, get a reminder push (T41), and check in at event time. Attendance feeds the leader analytics (T60).

**Files:**
- New collection `groups/{gid}/events/{eventId}` — `{ title, description, startsAt, endsAt, location?, recurrence?, createdBy }`
- New subcollection `groups/{gid}/events/{eventId}/rsvps/{uid}` — `{ status: "going|maybe|no", respondedAt, attended? }`
- `firestore.rules` — events: leader create/update/delete, member read, member RSVP write to their own doc only
- `frontend/app/groups/[gid]/events/page.tsx`, `.../events/[eventId]/page.tsx`
- `frontend/components/events/EventCard.tsx`, `RsvpButtons.tsx`, `CheckInButton.tsx`
- `infra/scheduled/event_reminders.py` — runs every 15 min, sends reminders for events starting in the next [60-75] min window
- `mobile/app/(authed)/groups/[gid]/events/` — mobile parity
- `backend/app/routers/calendar.py` — `GET /api/groups/{gid}/events/{eventId}.ics` (calendar file download)

**Behavior:**
- Recurrence: simple weekly (`weekly`, `every 2 weeks`) — full RRULE is overkill. Document the limitation.
- RSVP states: `going | maybe | no`. Default null (no response). Counts surface to leaders.
- Reminder push: 60 min before, fires once per RSVP'd-going user via the existing `users/{uid}/notifications/{nid}` collection. Honors quiet hours (T41) — reminder still fires; quiet-hours suppression doesn't apply to event reminders, but the user can opt-out per-kind in settings.
- Check-in: opens a 30-min window (15 min before through 15 min after the start). Member taps "I'm here" → writes `attended: true`. Leader can manually mark attendance after the fact for offline events.
- ICS download: a member can add the event to Google Calendar / Apple Calendar.

**Acceptance criteria:**
- Leader creates a recurring weekly prayer time; the next 4 occurrences are visible in the events list.
- A member RSVPing "going" receives a push reminder 60 min before in dev (verified by clock injection).
- Check-in flow accepts taps within the window and rejects outside; check-in writes `attended: true` and feeds T60 dashboard.
- Non-leader cannot create / update / delete events (rules tests).
- ICS file opens in Apple Calendar with the right time, title, and location.

**Out of scope:** Video conferencing integration (Zoom / Meet links) — Phase 4 (security review for guest links); waitlists / capacity caps — Phase 4 if a real group asks; full RRULE recurrence (monthly nth-weekday, etc.) — Phase 4.

---

## T50 — Watch Together — synchronized YouTube playback

**Goal:** A group member starts a "Watch Together" session for a YouTube video; other members join and the playback stays synchronized. Used for Sunday-sermon catch-up, devotional videos, etc. Built on YouTube IFrame Player API + Realtime Database for sync state.

**Files:**
- `frontend/app/groups/[gid]/watch/[sessionId]/page.tsx`
- `frontend/components/watch/WatchPlayer.tsx`, `WatchControls.tsx`, `WatchChat.tsx`
- `frontend/lib/hooks/useWatchSync.ts` — RTDB-backed playback state (`{ videoId, paused, positionSec, leaderUid, updatedAt }`)
- `groups/{gid}/watch_sessions/{sessionId}` — Firestore doc (creation, end, attendees) for analytics; live state lives in RTDB
- `mobile/app/(authed)/groups/[gid]/watch/[sessionId].tsx` — mobile parity (uses `react-native-youtube-iframe`)

**Behavior:**
- Any member can start a session by pasting a YouTube URL. The starter is the session "leader" — only the leader can play/pause/seek. Leader can transfer.
- RTDB sync: the leader publishes `{ paused, positionSec, updatedAt }` every 2s. Followers reconcile if their position drifts > 2s.
- Mini-chat in the watch session is a thread on the watch_sessions doc — uses the existing thread machinery (T09).
- Leaving the page tears down the listener; the session ends when the last member leaves (TTL cleanup via RTDB onDisconnect + a 5-min idle sweep).
- Reactions: T26 reactions render in the mini-chat for now.

**Acceptance criteria:**
- Two members in different tabs join a watch session; pausing as the leader pauses the follower within 3s.
- Seeking forward 30s on the leader pulls the follower within 3s.
- The follower cannot pause/seek (only the leader can); attempting to does nothing.
- Watch session writes a Firestore record with attendees + duration for T60 analytics.
- Mobile playback works for an embeddable YouTube video.

**Out of scope:** Self-hosted video (Phase 4), private videos / DRM content (out of scope for YouTube IFrame), captions sync UI (the IFrame handles native captions; we don't add a layer).

---

## T51 — Devotionals + reading plans

**Goal:** A library of structured Christian content — daily devotionals (extends T33's daily verse), multi-week reading plans (e.g. "Read the Gospel of John in 21 days"), and a per-user progress tracker. Curated by JACOB initially; orgs can add their own (T54) once the org model lands.

**Files:**
- New collections `devotionals/{slug}` (top-level, public-domain or licensed content), `reading_plans/{slug}` (top-level), `users/{uid}/plan_progress/{planSlug}`
- `firestore.rules` — read for any signed-in user; writes Admin SDK only for `devotionals` and `reading_plans`; user-only for `plan_progress`
- `infra/seed/reading_plans/` — JSON files for v1 plans (e.g. Gospel of John, Psalms in 30 days)
- `frontend/app/devotionals/page.tsx` — index, category filter
- `frontend/app/devotionals/[slug]/page.tsx`
- `frontend/app/reading-plans/page.tsx`, `.../[slug]/page.tsx`, `.../[slug]/day/[n].tsx`
- `frontend/components/home/PlanProgressCard.tsx` — surfaces on the home page when active
- `mobile/app/(authed)/devotionals/`, `reading-plans/` — mobile parity

**Behavior:**
- Devotional: title, scripture reference, body (markdown — see T53), audio? (link only — no hosting), source attribution.
- Reading plan: ordered days, each with a scripture reference + optional reflection prompt. Streak tracking (consecutive days completed) on `plan_progress`.
- Catch-up: missing a day doesn't break the streak immediately — 1-day grace. Missing 2 days resets.
- "Share with my group": a member reading day 5 of a plan can post the reflection prompt to a chosen group's chat. Renders as a styled card with the plan name + day number.
- Non-goal v1: no commenting on devotionals; the share-to-group flow is the comment surface.

**Acceptance criteria:**
- A signed-in user can browse devotionals and pick a reading plan.
- Marking day 1 complete writes `plan_progress` with `completedDays: [1]`, `streak: 1`, `lastCompletedAt`.
- Missing a day with the 1-day grace keeps the streak; missing two consecutive days resets to 0 on next completion.
- Sharing day 5 of "Gospel of John" to group X creates a group message with the right card.
- Reading plans live in `infra/seed/` and are loaded by a one-shot script committed in this PR.

**Out of scope:** User-generated devotionals (Phase 4 — needs moderation flow), audio playback (link-out is fine for v1), licensed content from publishers (Phase 4 — partnerships).

---

## T52 — Sermon archives — leader-curated playlist

**Goal:** A leader can attach a sermon archive to their group: a curated list of sermon links (YouTube, podcast feeds) with metadata. Members browse, filter by date / preacher / scripture, and start a Watch Together session (T50) directly from a sermon.

**Files:**
- New subcollection `groups/{gid}/sermons/{sermonId}` — `{ title, preacher, scripture, date, sourceUrl, sourceType: "youtube|podcast|other", thumbnail }`
- `firestore.rules` — read for group members, write for leaders
- `frontend/app/groups/[gid]/sermons/page.tsx`, `.../[sermonId]/page.tsx`
- `frontend/components/sermons/SermonCard.tsx`, `SermonList.tsx`, `WatchTogetherButton.tsx`
- `backend/app/routers/sermons.py` — `POST /api/groups/{gid}/sermons` accepts a YouTube URL and pulls the title/thumbnail via oEmbed; podcast feed support is URL-only (no parsing)

**Behavior:**
- Leader pastes a URL; backend fetches oEmbed metadata (title, thumbnail) for YouTube, falls back to a manual form.
- Members see a list; filter by date range, preacher, scripture.
- "Watch with the group" launches a T50 session.
- Comments live as a thread on the sermon doc — reuses the thread machinery from T09.

**Acceptance criteria:**
- Leader adds a YouTube URL and the title + thumbnail are auto-populated.
- Member browses the list and filters by preacher.
- "Watch with the group" creates a T50 session and routes to it.
- Non-leader cannot add or delete sermons (rules test).

**Out of scope:** Auto-import from a church's sermon RSS feed (Phase 4 — partner-by-partner), sermon transcription (Phase 4 — cost), per-sermon discussion guide (Phase 4 — overlaps with T51 plans).

---

## T53 — Markdown messages + link unfurls

**Goal:** Messages support a small markdown subset (bold, italic, lists, code spans, blockquotes). Link unfurls render Open Graph previews (title, description, image, source) for shared URLs. Both honor the existing moderation pipeline.

**Files:**
- `frontend/lib/markdown.ts` — limited markdown renderer (no HTML pass-through, no images, no headings to keep messages tight)
- `frontend/components/chat/MessageBody.tsx` — rendering layer
- `backend/app/routers/unfurl.py` — `POST /api/unfurl` accepts a URL, fetches and parses OG tags server-side (so we don't expose users' IPs to the target), returns `{ title, description, imageUrl, siteName }`
- `backend/app/services/unfurl.py` — fetcher with per-host rate limit, allowlist of safe schemes (`https` only), redirect cap, total fetch size cap, **deny private network ranges (SSRF guard)**
- `groups/{gid}/messages/{mid}.unfurls` — `[{ url, title, description, imageUrl, siteName, fetchedAt }]`. System-only write (rules deny client direct write).
- `functions/src/onMessageCreate.ts` — extend to detect URLs in the body and call the unfurl service; result attached to the message
- `frontend/components/chat/UnfurlCard.tsx`

**Behavior:**
- Markdown subset is intentionally small to avoid XSS surface. Use `marked` with a strict ruleset and DOMPurify on the output. Inline HTML rejected.
- Unfurl pipeline: max 3 URLs per message; first 3 win. Image is proxied through GCS to avoid mixed-content / hotlinking issues (small daily cap on the proxy bucket).
- SSRF guard: backend resolves the hostname before fetch and rejects RFC 1918 private ranges, link-local, loopback, IPv6 ULA. Document the threat in the unfurl service.
- Caching: same URL within 24h reuses the previous unfurl result.

**Acceptance criteria:**
- A message with `**bold**` renders bold; a message with `<script>` renders as text, not HTML.
- Posting a YouTube link unfurls within 5s and shows the thumbnail.
- A message with a link to `http://169.254.169.254/...` (cloud metadata service) is rejected by the SSRF guard; backend test covers it.
- Same URL posted twice within 24h hits the cache (verified by counter).
- Unfurls render on mobile (T40) identically.

**Out of scope:** Custom OG metadata authoring per-org (Phase 4), in-message embedded video (Phase 4 — bandwidth), image rendering inline in markdown (intentionally — photo upload is the path for images, prevents arbitrary external images).

---

## T54 — Org model — group-of-groups, org admins, branded workspace

**Goal:** A new top-level resource: an org (a church, a ministry network, a BJJ school) that owns one or more groups. Org admins can manage groups under their umbrella, invite members at the org level, see aggregated analytics, and (later) brand the workspace.

**Use Opus. New top-level collection. Group membership semantics shift from "member of a group" to "member of a group inside an org" — a permission-boundary change touching every existing rule.**

**Files:**
- New collections `orgs/{orgId}`, `orgs/{orgId}/admins/{uid}`, `orgs/{orgId}/members/{uid}`, `orgs/{orgId}/invites/{inviteId}`
- `groups/{gid}.orgId` — nullable; null means "unaffiliated group" (the Phase 1/2 default; preserved for backward compat)
- `firestore.rules` — full ruleset for orgs, plus extensions to every existing group rule that needs to honor org-level permissions
- `firestore.indexes.json` — composite indexes on `(orgId, createdAt)` for groups
- `backend/app/routers/orgs.py` — `POST /api/orgs`, `POST /api/orgs/{orgId}/groups/{gid}/attach`, `POST /api/orgs/{orgId}/admins/{uid}`, `GET /api/orgs/{orgId}/dashboard`
- `frontend/app/orgs/[orgId]/page.tsx` — org admin dashboard
- `frontend/app/orgs/[orgId]/settings/page.tsx`
- `infra/scripts/seed_pilot_org.py` — for the first pilot church
- `docs/adr/0007-org-model.md` — schema, rule shape, migration plan, billing-fields placeholder
- `docs/data-model.md` — extend with the org tier

**Behavior:**
- Creating an org requires a JACOB platform admin (T13 surface) — orgs are not self-serve in v1 to keep the surface controlled. Org admins are then delegated by the platform admin.
- An org admin can attach an existing group (with the group leader's consent — backend confirms via a one-shot consent token sent to the leader) or create a new group inside the org.
- Org membership: a user becomes an org member by being a member of any group inside the org (denormalized for query speed; trigger maintains).
- Org admin powers: see all groups in the org, see aggregated analytics (T60), set org-wide moderation policy defaults (cascades to `groups/{gid}.moderationPolicy` for new groups), invite members at the org level (which lands them in a default "lobby" group).
- Backward compat: every existing group has `orgId = null`; nothing breaks. Phase 2 features remain identical for unaffiliated groups.
- Billing fields: `orgs/{orgId}.billing` carries a placeholder shape (`{ tier: "free", customerId: null, status: "active" }`) so the doc shape doesn't reshape when Phase 4 paid tiers land. No write paths exposed today.

**Acceptance criteria:**
- A platform admin creates an org via `POST /api/orgs`; an org admin then attaches three existing groups after their leaders consent.
- The org dashboard shows the three groups, total members across them (deduped), recent activity.
- Rule tests cover: org admin can read every group inside the org; non-org-admin cannot read across groups they're not a member of; unaffiliated groups behave exactly as in Phase 2.
- The migration leaves every existing group with `orgId = null`; no Phase 1/2 surface regresses (full Phase 2 test suite still passes).
- The ADR documents the rule-shape change, the orgId-null compat path, and the billing-fields-but-no-billing-yet decision.

**Out of scope:** Self-serve org creation (Phase 4 — needs identity verification), org-level billing (Phase 4), federated moderation across orgs (Phase 4), org-to-org messaging (Phase 4).

---

## T55 — Custom domains per org (`our-church.jacob.app`)

**Goal:** An org admin maps a subdomain like `our-church.jacob.app` (or with proof-of-DNS, a vanity domain like `groups.our-church.org`) to their org's workspace. The frontend resolves the org from the host header.

**Use Opus. Cookies, CORS, OAuth callback URLs, and Firebase Auth's authorized-domains list all interact here. Get one wrong and you ship an account-takeover surface.**

**Files:**
- `infra/firebase-app-hosting.yaml` — wildcard-domain config for `*.jacob.app`
- `frontend/middleware.ts` — extract org from the host header, attach to request context, redirect to canonical workspace URL
- `frontend/lib/org-context.ts` — `OrgProvider` reads the current org from the host
- `backend/app/routers/orgs.py` — `POST /api/orgs/{orgId}/custom-domain` (admin verifies via DNS TXT record), `GET /api/orgs/{orgId}/custom-domain/status`
- `backend/app/services/dns_verification.py` — TXT-record verifier with rate limit + retries
- `infra/cloudfront.tf` (or Cloud Run domain mappings) — provisioning step for vanity domains
- `docs/runbooks/custom-domains.md` — DNS instructions for org admins, TLS provisioning timing, what to do when it stalls
- Firebase Auth: extend authorized-domains list via the Identity Platform API at provisioning time

**Behavior:**
- Subdomain `our-church.jacob.app`: claimable on org create, validated as DNS-safe (regex), reserved subdomains list (`www`, `api`, `admin`, etc.).
- Vanity domain (`groups.our-church.org`): admin enters the domain, system returns a TXT record to add to their DNS. A status endpoint polls until the record is visible (15-min check). On verify, system creates a Cloud Run domain mapping (or App Hosting custom domain), which provisions a managed cert.
- Cookie scope: session cookies are set on `*.jacob.app` for subdomains (so a single sign-on per browser); vanity domains have isolated cookie state. Document the trade-off.
- Firebase Auth: every claimed domain is added to the authorized-domains list automatically (via Identity Platform Admin SDK). OAuth redirect URIs include the new origin.
- Brand: org admin uploads a logo (uses T10 moderation pipeline) and picks a primary color; rendered in the workspace header. No CSS injection.

**Acceptance criteria:**
- An org admin claims `pilot-church.jacob.app`; visiting that hostname loads the workspace scoped to that org's groups.
- A vanity-domain claim with a valid TXT record provisions a working `https://groups.our-church.org` within 30 minutes (Cloud Run cert provisioning excepted).
- Auth works across the new domain (sign in, sign out, refresh).
- Reserved subdomains (`api`, `www`) are rejected at claim time.
- Logo upload goes through the moderation pipeline (verified by uploading a known-bad asset).
- Runbook covers the "TLS still pending after 4 hours" failure mode.

**Out of scope:** Per-org custom CSS / theme injection (Phase 4 — XSS surface), per-org email sender domain (Phase 4 — DKIM / SPF setup per org), white-labeled mobile app (Phase 4 — App Store policy).

---

## T56 — BJJ vertical — sticker set, brand variant, audience switch

**Goal:** Onboard the first BJJ pilot. Add the BJJ sticker set (T06's `audience: "bjj"` already exists), a brand-voice variant (different copy in onboarding, FAQ, email templates), and a creation-time audience switch on org/group create.

**Files:**
- `infra/seed/stickers/bjj.json` — sticker set: `roll_partner_needed | tournament_prep | technique_question | recovery | conditioning | bjj_milestone`
- `frontend/lib/copy/` — extract user-facing strings into a small i18n-style module keyed by `audience`; load `christian` or `bjj` variant
- `groups/{gid}.audience` — already exists from T30; widen to honor the new sticker set on message create
- `firestore.rules` — message create predicate widens to accept `bjj` sticker slugs when the parent group's audience is `bjj`
- `backend/app/templates/email/` — BJJ variants of onboarding + digest templates
- `frontend/app/discover/page.tsx` — audience filter now actually has two real options
- `infra/scripts/seed_pilot_bjj_org.py`

**Behavior:**
- Org or group creation page asks for the audience up front. Once set, it's immutable on the org (changing audience would invalidate every group's sticker history).
- Stickers are scoped: a BJJ group can use BJJ stickers + a few cross-audience ones (`general`); a Christian group cannot use BJJ-only stickers and vice versa.
- Brand voice: every `t()` call in the frontend pulls from the audience-keyed copy module. Default to `christian` for back-compat (every existing group is `audience: "christian"`).
- Email templates pick the right variant based on the recipient's primary org's audience.
- Discovery shows audience-filtered results.

**Acceptance criteria:**
- A BJJ org with a single group can be created end-to-end; messages require a BJJ sticker.
- A Christian-audience message attempting a BJJ sticker is rejected by the rule (test).
- The onboarding page renders BJJ-flavored copy when the user is invited into a BJJ org.
- Discovery page filters between Christian and BJJ groups.
- Existing Christian groups see no UX change.

**Out of scope:** Multi-audience groups (intentionally not — defeats the brand cohesion), AI matching of "find me a roll partner this Saturday" (Phase 4 once the BJJ pilot generates enough volume), tournament bracket integrations (Phase 4 — partner-by-partner).

---

## T57 — Voice rooms (LiveKit) for small groups

**Goal:** A leader can open a voice room (drop-in audio) for a group. Members join from web or mobile. Room caps at 10 concurrent. No video. No recording in v1.

**Use Opus. Realtime infra is new. Abuse vectors (someone using the room to harass a member) need a kill / kick / ban path before launch.**

**Files:**
- `backend/app/routers/voice.py` — `POST /api/groups/{gid}/voice/start` (leader only), `POST /api/groups/{gid}/voice/end`, `GET /api/groups/{gid}/voice/token` (issues a short-lived LiveKit access token)
- `backend/app/services/voice.py` — LiveKit server SDK wrapper, with per-room participant cap enforcement
- `groups/{gid}/voice_sessions/{sessionId}` — `{ startedAt, endedAt?, startedBy, participants[] }`
- `frontend/app/groups/[gid]/voice/page.tsx` — voice room UI (uses LiveKit web SDK)
- `frontend/components/voice/VoiceRoom.tsx`, `VoiceParticipants.tsx`, `MuteButton.tsx`, `LeaveButton.tsx`
- `mobile/app/(authed)/groups/[gid]/voice.tsx` — mobile (LiveKit RN SDK)
- `infra/livekit.tf` — LiveKit Cloud project setup (or self-hosted on GKE — decide in the ADR)
- `docs/adr/0008-voice-rooms.md` — vendor choice, recording posture, abuse vectors, kill switch
- `docs/runbooks/voice-incidents.md` — kick / mute / ban / kill-room procedures
- `docs/community-guidelines.md` — voice-specific rules

**Behavior:**
- Leader-only start. Participants join via short-lived token (≤ 60s) issued by backend after verifying group membership and ban status.
- Cap: 10 concurrent. 11th gets a "room is full" message.
- Moderation: any member can mute themselves; only the leader can mute another member or kick. Kicking writes an audit row. A second leader can kill the room entirely.
- No recording in v1. Document this prominently. Recording is a Phase 4 decision once the abuse pattern (or absence) is understood.
- Notification: starting a room writes one `notification` row per group member with `kind: "voice_started"`; routed through T34/T41. Quiet hours suppress unless the room is announced as scheduled (T49 integration).
- Cost guardrail: per-org monthly cap on voice-minutes (configurable), default 1000 minutes. Over the cap, leaders see a "limit reached, contact admin" message.

**Acceptance criteria:**
- Leader starts a room; another member joins within 5s and audio is bidirectional with < 250ms RTT median over a clean connection.
- Kicking a member from the room ejects them within 2s; they cannot rejoin during the same session.
- Killing the room disconnects every participant.
- Banned user (T13) cannot get a voice token (403 from `GET /voice/token`); rule and backend test cover it.
- Cost-cap test: with the cap mocked at 1, the second voice-minute is rejected with a clear error.
- Mobile (T40) parity: same start/join/leave flow on iOS.
- Runbook documents the kill-room path and who is on call for voice incidents (T59).

**Out of scope:** Video rooms (Phase 4 — different bandwidth + abuse posture), recording (Phase 4), screen sharing (Phase 4), background noise suppression beyond the SDK default (Phase 4), spatial audio (never).

---

## T58 — Feature flags + staged rollout admin

**Goal:** A self-serve feature-flag system. Every Phase 3 task ships behind a flag. We can ramp 0 → 10 → 50 → 100% from the admin UI without redeploying. Cohort targeting by org, by user role, by user uid list.

**Files:**
- New collection `feature_flags/{flagKey}` — `{ enabled, rolloutPercentage, cohorts: { orgIds[], roles[], uids[] }, updatedBy, updatedAt, description }`
- `firestore.rules` — read for any signed-in user (so the client can self-evaluate); write for platform admins only
- `backend/app/services/flags.py` — server-side evaluator (consistent with client via the same hashing function)
- `frontend/lib/flags.ts` — `useFlag(key)` hook + `evaluateFlag(key, ctx)` for SSR
- `mobile/lib/flags.ts` — mobile parity
- `frontend/app/admin/flags/page.tsx` — admin UI to view + toggle flags, see audit history
- `audit_log` — every flag change writes a row
- `docs/runbooks/feature-flags.md` — naming convention, cleanup policy ("any flag at 100% for 30 days is a candidate for removal")

**Behavior:**
- Flag evaluation: deterministic hash of (uid + flagKey) modulo 100 vs `rolloutPercentage`. Cohort overrides win (in `cohorts.uids` → always on; in cohorts.orgIds with the user's primary org → always on).
- Client subscribes to the `feature_flags` collection via a single listener (small collection, all-clients-subscribe is fine until ~ 1000 flags).
- Admin UI: list flags, toggle on/off, set percentage, add/remove cohorts. Every change writes an audit row.
- A flag at `100%` for > 30 days surfaces in the admin UI as "Candidate for cleanup" — feature-flag debt is real.
- Backend: a small CLI in `backend/scripts/flag.py` to read/set flags from the terminal for incident response.

**Acceptance criteria:**
- Setting `mobile_native_enabled` to 50% causes ~ half of test users (large enough sample) to evaluate true; client and server agree on the same uid.
- Adding a uid to `cohorts.uids` flips that user to true regardless of percentage.
- Toggling a flag in the admin UI surfaces the change in a separate browser tab within 5s (live listener).
- Audit log entry exists for every change.
- The flag-cleanup banner appears for a flag manually back-dated to "100% since 31 days ago."

**Out of scope:** A/B test analytics (Phase 4 — overlaps with the analytics platform), per-percentile latency targeting (Phase 4 — niche), flag dependencies / kill chains (Phase 4 — adds complexity that isn't pulling weight yet).

---

## T59 — On-call rotation + incident playbook + postmortem template

**Goal:** Operationalize on-call. Right now the runbook in `docs/oncall.md` exists but there's no rotation, no escalation, no postmortem template. Phase 3 tasks (voice, AI, custom domains) all create new failure modes that a single engineer cannot triage at 3 AM without a playbook.

**Files:**
- `docs/oncall.md` — extend with rotation schedule (start with two-person rotation: primary + backup, weekly), escalation path, on-call expectations
- `docs/runbooks/incident.md` — incident playbook: severity definitions (SEV1/2/3), declaration template, comms template (Slack channel, status page, customer email), incident-commander role
- `docs/postmortem-template.md` — blameless postmortem template
- `infra/oncall/pagerduty.tf` (or `opsgenie.tf` — pick one in the ADR) — alert routing
- `docs/adr/0009-oncall-tooling.md` — vendor choice, cost, rotation cadence
- `frontend/components/admin/IncidentBanner.tsx` — admin-only banner the on-call can flip on to alert active sessions
- `infra/status-page.tf` — Cloud Status (Uptime Kuma or StatusPage.io — decide in ADR)

**Behavior:**
- Two-person rotation, weekly handoff. Documented in `oncall.md`.
- Existing alerts (Sentry, uptime checks from T15, voice-room failures, AI quota exceeded) route to the on-call via PagerDuty / Opsgenie. SEV3 → ticket; SEV2 → page during business hours; SEV1 → page 24/7.
- Status page: public, hosted, with planned-maintenance and incident-update flows. Subscribers get email updates.
- Postmortem template: every SEV1/2 produces a postmortem within 5 business days. Template covers timeline, contributing factors, action items, what went well.
- Incident banner: the on-call can flip a `active_incidents/{incidentId}` doc with `{ severity, message, displayUntil }`; the frontend (and mobile) show it at the top of the screen.

**Acceptance criteria:**
- The first two on-call rotations are scheduled and documented (committed in the PR).
- A synthetic SEV1 alert (a fake `sentry-test` exception tagged sev1) reaches the on-call's phone in dev.
- The status page is live and reachable at `status.jacob.app` (or equivalent — decide in ADR).
- A test postmortem fills out the template end-to-end.
- The incident banner renders on the home page when activated; clears when `displayUntil` passes.

**Out of scope:** Chaos engineering / fault injection (Phase 4 — premature for a young product), 24/7 paid support tier (Phase 4), automated runbook execution (Phase 4 — manual is fine for now).

---

## T60 — Group-health dashboard for leaders/pastors

**Goal:** Extend T29's leader analytics into a richer dashboard: engagement trends, retention curves (cohort: members who joined in week N still active in week N+4), event attendance (T49), prayer-request response rates, sentiment trend (rolling). Org admins (T54) see the same dashboard aggregated across their groups.

**Files:**
- `infra/bigquery/views.sql` — extend with: `engagement_weekly`, `member_retention_cohort`, `event_attendance_weekly`, `prayer_response_weekly`, `sentiment_weekly` (sentiment from T20 + T43 scores)
- `backend/app/routers/analytics.py` — extend with `GET /api/orgs/{orgId}/analytics` and richer per-group payload
- `frontend/app/groups/[gid]/analytics/page.tsx` — extended
- `frontend/app/orgs/[orgId]/analytics/page.tsx` — new
- `frontend/components/analytics/RetentionChart.tsx`, `EngagementTrendChart.tsx`, `SentimentChart.tsx`, `EventAttendanceChart.tsx`, `PrayerResponseChart.tsx`
- `docs/runbooks/leader-analytics.md` — what each metric means, what's actionable, what's not

**Behavior:**
- Cohort retention: for each weekly join cohort, week-N retention = (% of cohort members who posted, reacted, or RSVPd in week N).
- Sentiment trend: rolling 7-day average of moderation scores (lower = more contentious). Surface only as a trend, not a per-message score (avoid weaponizing the data against members).
- Event attendance: % RSVP'd-going who actually checked in (T49). Cross-event averages.
- Prayer response: from T47 (and direct counts: per prayer-tagged message, count of "praying for" commits).
- Org-level: sums across groups; per-group breakdown ranked by activity.
- Refresh cadence: the daily BigQuery load from T29 is now extended with the new tables. Dashboard data is up to 24h stale; banner says so.
- Privacy: no per-member sentiment scores are surfaced. No per-member retention; only cohort aggregates.

**Acceptance criteria:**
- A leader sees retention curves for each weekly cohort that joined since their group's creation.
- An org admin sees aggregated charts across the org's groups.
- Per-member sentiment is never surfaced — verified by code-search assertion in tests (no field with `<uid>.sentiment` in any payload).
- Prayer response numbers match a hand-counted tally on a fixture.
- Runbook explains what each chart means and explicitly lists what *not* to use it for ("retention dropping in week 3 is not a sign that a member should be removed").

**Out of scope:** Predictive analytics ("this member is likely to churn") — Phase 4 (privacy concern), per-member action recommendations to leaders — never (this app does not push leaders to act on individual members), platform-wide cross-org analytics — Phase 4.

---

## T61 — i18n foundation — en + es seed, RTL-ready, locale routing

**Goal:** Internationalize the frontend and mobile with English and Spanish (es is the second-largest pilot ask). Wire up RTL support so adding Arabic later is config-only. No translation memory, no human review pipeline — just the foundation.

**Files:**
- `frontend/lib/i18n/` — `next-intl` setup, `messages/en.json`, `messages/es.json`
- `frontend/app/[locale]/` — locale-prefixed routes (`/en/...`, `/es/...`); middleware redirect from `/...` to user-preferred locale
- `mobile/lib/i18n/` — `i18n-js` (or `react-intl`), parity messages
- `users/{uid}.locale` — `en | es` (default `en`); user can set in profile settings
- `backend/app/services/email.py` — pick template by recipient's locale
- `backend/app/templates/email/` — `*.es.html.j2` for each existing template
- `tailwind.config.ts` — add `dir-rtl:` variant scaffolding (no styles depend on it yet)
- `docs/i18n.md` — translation contribution flow, pluralization rules, how to add a new locale

**Behavior:**
- Locale detection: URL prefix > user preference > `Accept-Language` header > default.
- Every existing user-facing string moves to a message catalog. Strings authored in `en.json`; `es.json` is filled by initial human translation (committed in this PR for the first 200 strings; the rest fall back to English with a `[ES]` marker until translated).
- RTL: every flex / margin / padding utility uses logical properties (`ms-`, `me-`, `ps-`, `pe-`) where the codebase has them; document the convention.
- Email: templates per locale; recipient's stored locale wins.
- Date / time formatting: `Intl.DateTimeFormat` with the user's locale; document the `tz` behavior.

**Acceptance criteria:**
- Switching the URL from `/en/groups` to `/es/groups` re-renders the page in Spanish.
- A new email (T18) goes out in Spanish to a user with `locale: "es"`.
- A test scaffolding an RTL locale (e.g., a fake `ar`) does not break the layout — all logical properties resolve correctly.
- Untranslated strings render with `[ES]` prefix in dev (so we see them) and fall back to English in prod.
- Mobile (T40) honors locale.

**Out of scope:** Full Spanish translation parity (initial 200 strings only — the rest get translated incrementally), Arabic / RTL launch (foundation only — no Arabic content), translation memory / human-review pipeline (Phase 4), per-message language detection (Phase 4 — overlaps with T20 multi-language moderation).

---

## T62 — Accessibility deepening — chat screen-reader, switch control

**Goal:** Bring the chat surface, sticker picker, reactions (T26), and offline cache (T36) to a real screen-reader-usable bar. Switch-control friendly: every interactive element reachable in linear order with a sane focus loop. Voice-control friendly: every clickable has a unique label.

**Files:**
- `frontend/components/chat/MessageList.tsx` — ARIA `log` role with `aria-live="polite"`, message group headings
- `frontend/components/chat/MessageItem.tsx` — proper labelling of reactions, mentions, threads
- `frontend/components/stickers/StickerPicker.tsx` — keyboard nav, ARIA roles
- `frontend/components/chat/ReactionPicker.tsx` — ditto
- `frontend/lib/a11y.ts` — focus-trap helper, skip-to-content link
- `frontend/app/layout.tsx` — skip-link, `lang` attribute (from T61)
- `mobile/components/chat/` — equivalent VoiceOver / TalkBack labels
- `docs/a11y.md` — testing checklist, supported AT versions, known gaps
- `frontend/tests/a11y/` — `axe-core` integration tests on key pages, fail CI on violations of impact `serious` / `critical`

**Behavior:**
- Screen reader announces new messages without repeating the entire log; uses `aria-live` with `aria-relevant="additions"` and groups by author.
- Switch control: tab order on the chat page is `header → messages (one stop, sub-stops via screen-reader navigation) → input → send`. Focus does not get trapped in the sticker picker.
- Voice control: every button has a unique accessible name (no two "More" buttons in the same view).
- Color contrast: WCAG AA (4.5:1) verified by `axe-core` in the test suite. Existing design tokens (T01-era) updated where they fail.
- Reduced motion: `prefers-reduced-motion` honored — reaction animations and presence flicker disable.

**Acceptance criteria:**
- A screen-reader user (tested with VoiceOver on Mac and NVDA on Windows; documented in PR) can: read the message log, reply, send a sticker, react.
- `axe-core` reports zero `serious`/`critical` violations on `/groups/[gid]/chat`, `/discover`, `/admin/queue`.
- Switch-control demo (recorded video in PR description, or detailed step-by-step) shows tab order makes sense.
- Reduced-motion mode disables the typing-indicator animation (T48) and the reaction-bar pulse.
- Mobile VoiceOver navigates the chat screen end-to-end.

**Out of scope:** WCAG AAA contrast (overshooting for v1), full voice-control end-to-end testing on every page (Phase 4 — we cover the core), braille-display testing (Phase 4 — no pilot user has asked).

---

## T63 — NCMEC formal reporting workflow

**Goal:** Wire the existing CSAM hash-match path (T10) into a formal NCMEC CyberTipline report. When a CSAM match fires, the system files an automatic report (with operator approval gate) and preserves evidence per legal retention requirements.

**Use Opus. Legal compliance, irreversible external action, evidence chain-of-custody. The implementation must fail closed (block uploads if the reporting path is broken) and must be operator-approved before the first real fire.**

**Files:**
- `backend/app/services/ncmec.py` — NCMEC CyberTipline API client (the `submit_report` SOAP/HTTP endpoint, depending on which NCMEC API is approved at implementation time)
- `backend/app/routers/ncmec.py` — `GET /api/admin/ncmec/pending` (admin queue), `POST /api/admin/ncmec/{caseId}/submit` (admin-approved submit), `POST /api/admin/ncmec/{caseId}/escalate` (system-side flag)
- New collection `ncmec_cases/{caseId}` — `{ matchedAt, hashSource, evidence: { gcsPath, sha256, sizeBytes }, status: "pending|submitted|withdrawn", submittedBy?, ncmecReportId?, retainedUntil }`
- `firestore.rules` — `ncmec_cases` denied to all clients; admin SDK only
- `infra/buckets.tf` — extend the `_held/` lifecycle (H8 from the Phase 1 review; deferred to here) to satisfy NCMEC retention (90 days minimum, configurable by counsel)
- `docs/legal/ncmec.md` — the legal framework, the NCMEC operator account setup, the chain-of-custody rules, who is authorized to submit
- `docs/runbooks/csam-incident.md` — the operator playbook
- `backend/app/templates/email/ncmec_pending.html.j2` — auto-email to the on-call when a case lands in the pending queue
- `docs/adr/0010-ncmec-reporting.md` — failed-closed posture, operator-gate decision

**Behavior:**
- A CSAM hash match (the existing T10 path) writes a `ncmec_cases` doc with `status: "pending"` instead of just logging. Evidence (the original upload) is moved to `_held/` (already happens) and the GCS path + SHA-256 + size are recorded immutably. The file is **never** deleted by the regular lifecycle.
- An email fires to the on-call admin (T59) with the pending case id. The admin reviews in the queue.
- Operator approval: the admin clicks "Submit to NCMEC." Backend POSTs to the NCMEC CyberTipline API with the metadata (NCMEC requires file upload to their system; document the exact protocol).
- On success: write `submittedBy`, `ncmecReportId`, audit log. On failure: retry with backoff (3 attempts), then surface a `ncmec_submission_failed` Sentry alert.
- Withdrawal: if a case turns out to be a false positive (the operator has the option), `status: withdrawn` is recorded with reason. NCMEC withdrawal protocol followed.
- Fail-closed: if the NCMEC API is unreachable on the upload-time path (we never call it on upload — only on operator-approved submit), the operator sees a clear error and the file stays in `_held/`. The upload itself was already blocked by T10.
- Retention: `_held/` files retained for `retainedUntil` (default 90 days; operator can extend per legal advice). After that, deleted via a separate lifecycle and the case doc updated.

**Acceptance criteria:**
- A simulated CSAM match in dev creates a `ncmec_cases` pending doc, fires an email to the test admin, and surfaces in the admin queue.
- Operator clicks "Submit"; in dev (against a NCMEC sandbox or mocked endpoint), the request is sent, the response is recorded, and the case is marked `submitted`.
- A failed submit (mocked 500) retries 3x and surfaces an alert.
- The held file retention test confirms the `_held/` lifecycle does not delete a file before `retainedUntil`.
- Legal doc covers: who can submit, the chain-of-custody, NCMEC operator account ownership, periodic legal review cadence.
- Runbook walks the on-call through the first real-fire scenario.

**Out of scope:** Hash-set provider switching (separate task — vendor-by-vendor), automatic submission without operator gate (intentionally never — false-positive escalation cost is too high for a small team), photoDNA local-hashing (Phase 4 if NCMEC asks).

---

## T64 — Appeals process for moderation actions

**Goal:** Every moderation action (message hide, account ban, group archive) gets an appeal path. The user receives an email with a link, can write a one-time appeal, and a different admin (not the original actor) reviews. Outcome and reasoning are visible to the appellant.

**Use Opus. Due-process surface; the rules around who-reviews-what need to be airtight or moderation looks arbitrary.**

**Files:**
- New collection `appeals/{appealId}` — `{ subject: { type, ref }, appellantUid, originalActorUid, originalActionAt, submittedAt, body, decision: "pending|upheld|reversed", decidedBy?, decidedAt?, reasoning? }`
- `firestore.rules` — appeals: read by appellant + admin; write by appellant (one per `(subject, appellantUid)`); decision by admin only via backend
- `backend/app/routers/appeals.py` — `POST /api/appeals` (submit), `GET /api/appeals/{appealId}` (read own), `GET /api/admin/appeals` (admin queue), `POST /api/admin/appeals/{appealId}/decide`
- `backend/app/services/appeals.py` — enforces "different admin" rule
- `backend/app/templates/email/moderation_action.html.j2` — extends existing moderation emails with an "Appeal this decision" link (signed JWT in URL)
- `frontend/app/appeals/[appealId]/page.tsx` — appellant UI (write appeal, see status)
- `frontend/app/admin/appeals/page.tsx` — admin queue
- `docs/community-guidelines.md` — extend with appeals policy and SLA
- `audit_log` — every decision writes a row with the reviewer and reasoning

**Behavior:**
- On any moderation action that affects a user (message hide, ban, group archive that took down their content), an email goes out: "Action taken. If you disagree, appeal here." Link is signed (JWT, 14-day expiry).
- One appeal per (subject, appellant). A second submission returns 409.
- "Different admin" rule: the original actor cannot decide their own appeal. The backend enforces and refuses with 403 if the only admin in the system is the original actor (in dev / single-admin setups, document the override path).
- Decision: `upheld` (action stays) or `reversed` (action undone — message un-hidden, ban lifted, archive un-done; the backend performs the reversal as a transaction with the decision write).
- Reasoning is visible to the appellant in the email and in the appeal page.
- SLA: 7 calendar days. A daily job surfaces overdue appeals on the admin page with a banner.

**Acceptance criteria:**
- A user whose message was hidden (T20) receives an appeal email; clicking the link opens the appeal page; submitting writes the doc.
- An admin (different from the original actor) can decide; on `reversed`, the message un-hides and the user is notified.
- The original actor cannot decide their own appeal (403 from the backend; UI hides the button).
- An appeal past 7 days surfaces a "OVERDUE" banner on the admin queue.
- All decisions write `audit_log` rows.
- A second appeal on the same subject by the same user returns 409.

**Out of scope:** Multi-stage appeals (Phase 4 if pilot data shows we need it), appeals for AI auto-flags that never resulted in a member-visible action (the action is the trigger — auto-flag alone is not an action), public appeal-outcome reports (covered by T65).

---

## T65 — Quarterly transparency report + audit-log export

**Goal:** Generate a quarterly transparency report — moderation actions taken, reports received, appeals decided, NCMEC submissions, takedowns. Org admins (T54) get a per-org version. All redacted; no per-member identifying detail.

**Files:**
- `infra/scheduled/transparency_report.py` — quarterly Cloud Run job (1st of Jan / Apr / Jul / Oct)
- `backend/app/services/transparency.py` — assembles the redacted aggregates from `moderation_queue`, `bans`, `appeals`, `ncmec_cases`, `audit_log`
- New collection `transparency_reports/{reportId}` — `{ period: "2026-Q3", scope: "platform|orgId", payload, generatedAt, publishedAt? }`
- `frontend/app/transparency/page.tsx` — public-facing report list (most recent published)
- `frontend/app/orgs/[orgId]/transparency/page.tsx` — per-org version (org-admin-only)
- `backend/app/routers/transparency.py` — `GET /api/transparency/latest`, `POST /api/admin/transparency/{reportId}/publish`
- `docs/runbooks/transparency-report.md` — review checklist before publish (privacy, accuracy)

**Behavior:**
- Job aggregates the prior quarter into bucketed counts: reports received by category, actions taken (hide / ban / archive), appeals decided (upheld / reversed), NCMEC reports filed, account-deletion requests, data-export requests (T38). All redacted — no uids, no group ids, no message ids.
- Org-level scope: per-org variant with the same shape, scoped to the org's groups.
- Draft generated quarterly; a platform admin reviews and clicks Publish. Publish makes the report readable at the public URL.
- Audit-log export: a separate path — admins can export the platform audit log for a date range (CSV). Used internally and during third-party audits. Not public.
- Privacy guard: a unit test asserts no uid, group id, or message id appears in any published report payload (regex check).

**Acceptance criteria:**
- A draft for the current quarter is generated by the scheduled job and visible to platform admins.
- The "Publish" action makes it readable on the public page.
- Per-org version generates correctly for a test org with 3 groups.
- Privacy-guard test passes (no PII / identifiers leak through).
- Audit-log export covering a date range produces a CSV that opens in Excel without quoting issues.
- Runbook checklist captures the review-before-publish steps.

**Out of scope:** Real-time public dashboard (Phase 4 — risk of leaking ongoing moderation patterns), third-party transparency frameworks like the Santa Clara Principles (Phase 4 — audit them when the volume justifies), per-quarter A/B comparison narratives written by AI (Phase 4 — overlaps with T44 risks).

---

## What's intentionally not in Phase 3

- **Tithing / giving / paid courses / fundraising** → Phase 4. Trust-and-safety baseline (T63–T65) and org model (T54) need to settle first; legal / tax framing wants to settle once paid tiers are real.
- **Public third-party API + OAuth for external integrations** → Phase 4. Org model needs to stabilize before we expose external surfaces.
- **Federated moderation across orgs** → Phase 4. Per-org moderation queues are the v3 boundary.
- **Self-hosted video / Watch Party for JACOB-hosted streams** → Phase 4. T50 covers YouTube playback; hosting our own is a cost decision.
- **Translation memory / human-review translation pipeline** → Phase 4. T61 is the en+es foundation only.
- **Cross-group DMs** → still deferred. Phase 2 said "Phase 4 if at all"; that judgment stands.
- **E2EE** → never. Architectural decision unchanged: server-side encryption only.
- **Multi-region data residency** → Phase 4. Stay in `nam5`.
- **Web3 / on-chain anything** → never.
- **Predictive analytics on individual members** → never. T60 stays at the cohort level.
- **AI-authored anything that becomes the canonical record without leader edit** → never. T44 sets the architectural pattern: leader edit always wins.
- **SMS / phone authentication** → not in Phase 3 (T42 explicitly skips it for SIM-swap reasons).
- **Tournament / sermon RSS auto-import** → Phase 4 partner-by-partner.
- **Custom CSS / theme injection per org** → Phase 4 (XSS surface).

If a Sonnet plan starts touching anything in this list, stop it and check.
