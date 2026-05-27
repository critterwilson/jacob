# OPUS_REVIEW — fresh-eyes deep review

**Date:** 2026-05-27
**Reviewer:** Opus, single session, adversarial pass over `main` at `8875168`
**Scope:** architecture, recent push/SSE/scheduled-jobs work, delegated membership safety, default-deny enforcement, CSAM/NCMEC, production readiness

This is the verdict and the punch list. Inline fixes for the two unambiguous **P0s** ship in the same PR. Everything **P1+** documents itself here and waits for Christopher to decide.

---

## TL;DR — what Christopher should actually care about

1. **Two minor-safety bypasses in the delegated-membership model (ADR 0015).** Both are fixed inline in this PR.
   1. `PATCH /api/users` lets a user flip their own `isMinor` flag. Sign up truthfully as a minor → PATCH `isMinor=false` → invite/join flows treat you as an adult forever.
   2. The "open" join-mode self-join (`POST /api/groups/{gid}/join-requests` when `group.joinMode == "open"`, which is the default) skips the minor-escalation check entirely. A minor can self-join any open-mode group with one POST, owner never sees it.

2. **The minor-escalation safety rule is single-path.** Even after fixing #1, the *only* gate is `users/{uid}.isMinor` being true. There is no DOB-derived re-validation at decision points, and the DOB lives in `users/{uid}/private/profile` where the open/join/invite endpoints never look. If `isMinor` is ever wrong on the user doc, every downstream check is wrong. Recommend: read `dob` from the private profile and re-derive `isMinor` in the minor-decision endpoints (compute_age is already on hand). This is one extra read per decision, not per request.

3. **Leader applications don't surface `isMinor` to the owner.** A minor can `POST /api/leader-applications`. The owner queue UI shows displayName/proposed group/etc., but nothing tells the owner the applicant is a minor. The owner would have to know the applicant personally. Add `isMinor` to the listing (and refuse minor leader applications at submit time — leadership is an adult role).

4. **Production project is empty and the cutover path is undocumented.** `apphosting.yaml` is hardcoded to `jacob-staging-494515`. CI deploys are environment-aware but Terraform has only been applied to staging; no Cloud Run Jobs / BigQuery dataset / GCS buckets exist in `jacob-494515`. There is no production-cutover runbook. Estimated work: 1–2 focused days, mostly Terraform + Secret Manager + a fresh apphosting backend.

5. **SSE listener-attach failure strands subscribers.** If `_attach_listener` throws (network blip on the Admin SDK), `_groups.pop(gid)` clears the state but the queue object handed back to the SSE generator stays alive — the client gets heartbeats forever and never sees messages. They never know the stream is dead unless they reload. Polling fallback still works on reconnect, but the broken-stream UX persists for as long as the connection stays open. Push an error sentinel into surviving queues before popping.

6. **Open-mode is the default `joinMode`.** Combined with the lazy `searchTokens` backfill (no historical messages are searchable) and the fact that leaders can change `joinMode` per group, "open" being the default means every group Christopher creates by hand is currently a minor-self-join vector. This is unrelated to the open-mode bypass fix in #1; it's a default-choice call. Recommend: default new groups to `"request"` mode.

7. **The legacy fcmToken-only dedup branch in `register_device` is still live.** Any client that doesn't send `installationId` (older PWA installs from before that field landed) takes the legacy path — every token rotation spawns a fresh device doc, no sweep. Push fan-out then sends to every stale token in parallel. The dedup fix only helps clients that have re-registered with `installationId`. Force-bump the SW version to push every install through the new path, OR add a backend back-compat sweep that prunes legacy docs >N days idle.

8. **Doc drift in CLAUDE.md / firestore.rules / Dockerfile after the verse removal and ADR-0015 supersession.**
   - `backend/Dockerfile:32` references `daily_verse.py` which no longer exists.
   - `firestore/firestore.rules:235-242` references "ADR 0014" where it means ADR 0015 (ADR 0014 is push notifications).
   - `CLAUDE.md` mentions Typesense in places that no longer apply.

---

## Findings (sorted by severity)

### P0 — fix immediately

#### P0-1 — `PATCH /api/users` lets a user flip their own `isMinor` flag — bypasses minor-escalation safety
**File:** `backend/app/models/users.py:89`, `backend/app/routers/users.py:385-386`
**Status:** FIXED INLINE in this PR.

`UpdateProfileRequest` includes `isMinor: bool | None`. The handler writes it verbatim. A user can:
1. Onboard as a minor with a truthful DOB → `users/{uid}.isMinor = true`, `dob` persisted on private subcollection.
2. `PATCH /api/users` with `{isMinor: false}` → public flag is now false.
3. Every minor-routing code path (invite consume, request-to-join, open join) reads `users/{uid}.isMinor` and treats the user as an adult.

ADR 0015 § 8 acknowledges "an adult could lie about their DOB" at signup. That's the documented threat model. **What the model does NOT accept is lying *after* signup, when the truthful DOB is already on file.** This endpoint silently permits exactly that.

**Fix applied:** dropped `isMinor` from `UpdateProfileRequest`, removed the corresponding handler branch. The only legitimate `isMinor` change is the owner-admin "approve minor join" flow, which doesn't touch the field on the user doc anyway. If a true age transition needs to happen (a minor turns 18), that's an admin-mediated correction — not a self-service PATCH.

#### P0-2 — Open-mode self-join skips the minor-escalation check
**File:** `backend/app/routers/discover.py:172-214`
**Status:** FIXED INLINE in this PR.

`POST /api/groups/{gid}/join-requests` resolves the group's `joinMode` (default: `"open"`). If `open`, the code runs a transactional self-join with no `isMinor` check. A minor can:
1. Onboard truthfully as a minor.
2. Visit any group with `joinMode == "open"` (the default).
3. Hit the join-request endpoint → instant membership, no owner review, no audit anchor.

ADR 0015 § 4 is explicit: minor decisions are owner-only. This branch bypasses that for the entire open-mode population.

**Fix applied:** the open-mode self-join branch now checks `users/{uid}.isMinor`. If true, it falls through to the request-mode codepath, which writes a `joinRequests` doc with `requiresOwnerReview: true` regardless of the group's `joinMode`. The leader queue continues to hide minor rows; the owner queue picks them up. Symmetric to the invite-consume minor branch in `groups.py:join_group`.

### P1 — high priority, design call needed

#### P1-1 — `isMinor` is the single source of truth, but the DOB is on hand
**File:** `backend/app/routers/discover.py:235-238`, `backend/app/routers/groups.py:194-198`, `backend/app/routers/users.py:305-345`

Every minor-escalation branch reads `users/{uid}.isMinor`. The real ground truth — `dob` — lives on `users/{uid}/private/profile`. If `isMinor` drifts (e.g. via a yet-to-be-discovered write path, a backfill bug, a future PATCH-shaped vector like P0-1), every downstream check silently approves the wrong thing.

Belt-and-braces fix: in the minor-decision endpoints (invite consume, request-to-join), read `users/{uid}/private/profile.dob` and re-derive `isMinor` with `compute_age`. One extra read per decision, not per request. Costs nothing if the user doc is already correct; saves the next P0 if it isn't.

#### P1-2 — Leader applications accept minors silently
**File:** `backend/app/routers/leader_applications.py:47-120`, `backend/app/routers/admin.py:896-1080`

`POST /api/leader-applications` has no `isMinor` check. The admin list / approve endpoints don't surface `isMinor` in the response either. The owner sees displayName + proposed group + motivation, with no signal that the applicant is 14.

ADR 0015 frames leader applications as the "register your gym" path. That's an adult call. Recommend:
- Refuse minor leader applications at submit-time (422 `minor_cannot_lead`).
- For the legacy queue: surface `isMinor` on `LeaderApplicationView` so the owner can reject obviously-wrong applications without having to drill into the user doc.

#### P1-3 — SSE listener-attach failure strands the SSE generator
**File:** `backend/app/services/stream_hub.py:140-176`

If `_attach_listener` raises (transient Firestore Admin SDK error, IAM blip, network), the code clears `self._groups[gid]` so future subscribers retry from scratch. But the **current** subscriber's queue object is already in the generator's loop, still alive, never to receive anything because no listener is bound to it. The generator emits heartbeats forever; the client UX is a silent broken stream until the user reloads.

Fix: before `self._groups.pop`, broadcast a sentinel event (e.g. `{"type": "attach_failed"}`) onto every queue in the lost state and have `_stream_event_generator` interpret that as "close the response so the client falls back to polling". Polling fallback is already the always-on safety net per ADR 0013 — just need to fail-fast here instead of hanging.

#### P1-4 — Legacy fcmToken-only dedup path still spawns duplicate device docs
**File:** `backend/app/routers/users.py:525-548`

Clients without `installationId` (any pre-PR-#332 install that hasn't reloaded) hit the legacy `where("fcmToken", "==", ...)` branch. Every token rotation creates a fresh doc because the old token doesn't match. No sweep, no dedup. Push fan-out then sends to every stale token on a single physical device.

For a fresh app this is moot — but Christopher's iPhone PWA likely went through several rotations during the SW debug sprints. There may already be stale device docs in staging from that period. Recommend:
- A one-shot sweep against staging Firestore: delete `devices` docs older than 30 days that have no `installationId`. Safe by construction.
- Either drop the legacy branch entirely (all clients should now send `installationId`) or land a back-compat sweep that prunes stale legacy docs the same way the post-install-id branch does.

#### P1-5 — Production project is empty; no cutover runbook
**Files:** `infra/*.tf`, `frontend/apphosting.yaml`, `.github/workflows/deploy.yml`, `.firebaserc`

The `production` Firebase alias points at `jacob-494515` and CI is environment-aware (`secrets.GCP_PROJECT_ID` per-environment). But:
- `frontend/apphosting.yaml` hard-codes every `NEXT_PUBLIC_FIREBASE_*` value to `jacob-staging-494515`. Building from this file for production would point the frontend at staging Firebase.
- No Terraform state for `jacob-494515`. Cloud Run Jobs, GCS buckets, BigQuery dataset, Service Accounts — none exist in prod.
- Secret Manager not populated in prod (`SENDGRID_API_KEY`, `JWT_UNSUBSCRIBE_SECRET`, `JACOB_HASH_PROVIDER`, etc.).
- The first prod deploy would build a backend image and try to deploy it, but `gcloud run deploy` would fail (the service doesn't exist, env vars don't exist, IAM doesn't exist).
- No production App Hosting backend connected to GitHub.

A production-cutover runbook would walk through (1) creating the App Hosting backend with prod env vars, (2) running Terraform against `jacob-494515`, (3) seeding Secret Manager, (4) setting up the prod Firebase Authentication providers, (5) data migration (none, since prod is empty), (6) DNS + custom domain. Roughly 1–2 days of focused work.

#### P1-6 — Open-mode is the default `joinMode`
**Files:** `backend/app/routers/discover.py:172`, `backend/app/routers/groups.py` (group create)

`group.get("joinMode") or "open"` — the default is unconditionally "open". Combined with the open-mode minor bypass (now fixed) and the fact that Christopher creates most groups manually, this means every group ships with an "anyone signed in can join" gate by default.

Defensive default: `"request"`. A leader who wants open mode can opt in; a leader who didn't think about it gets the safer behavior.

### P2 — medium

#### P2-1 — `cleanup_stale_devices` doesn't catch devices with missing `lastSeenAt`
**File:** `infra/scheduled/cleanup_stale_devices.py:51-53`

`where("lastSeenAt", "<", cutoff)` skips documents where `lastSeenAt` is unset. Any pre-migration device doc without `lastSeenAt` is therefore immortal. Today `register_device` always writes the field, but old test docs / scripted writes may not have. Sweep these explicitly:
```py
for snap in db.collection_group("devices").stream():
    if snap.to_dict().get("lastSeenAt") is None:
        snap.reference.delete()
```
or add a sentinel and only sweep documents that have been read at least once.

#### P2-2 — Devotional slug race on simultaneous title submission
**File:** `backend/app/services/devotional_paths.py:132-160`, `backend/app/routers/devotionals.py:535-562`

`next_available_slug(exists=...)` is called outside a transaction. Two callers picking the same title at the same second both see `exists(slug)=False`, both write the same doc id. The second write wins. Probability is tiny for a ministry app, but the fix is small: use `Firestore.document(id).create()` (which fails 6 ALREADY_EXISTS) inside the slug-exists loop, and bump on conflict.

#### P2-3 — `infra/scheduled/cleanup_stale_devices.py:49` dead variable
`users_ref = db.collection("users")` is set but never used. Tiny cleanup.

#### P2-4 — `_sweep_legacy_devices_without_installation_id` is unbounded
**File:** `backend/app/routers/users.py:551-571`

Iterates `devices_col.stream()` with no `.limit()`. For a user with hundreds of stale device docs (worst case: aggressive token rotation over months on legacy clients) this single request could fan out a Firestore scan + many deletes. Add a `.limit(50)` and let subsequent registrations clean up further docs.

#### P2-5 — `onMessageWrite.ts` warns on "undelete observed — possible rule gap" but does nothing
**File:** `functions/src/onMessageWrite.ts:99`

If an undelete is genuinely a rule gap, this log alone is the only signal. Either wire up a Sentry alert specifically for this string or accept that an undelete is now legitimate (it isn't, post-M6 — there's no API path that undeletes). At minimum, change `warn` to `error` so it's surfaced more visibly.

#### P2-6 — `firestore.rules` comment drift
**File:** `firestore/firestore.rules:235, 242`

Two lines reference "ADR 0014 deprecates this collection" / "delegated leader applications (ADR 0014)". ADR 0014 is *group_message push notifications*; ADR 0015 is delegated membership. Replace with the right ADR number.

#### P2-7 — `backend/Dockerfile:32` references a deleted file
The comment mentions `python /app/scheduled/daily_verse.py` — feature was removed in PR #350. Replace with one of the still-extant scheduled scripts (e.g. `finalize_deletions.py`).

#### P2-8 — Public default of `MIN_AGE` is 13 but not surfaced in privacy docs
**File:** `backend/app/routers/users.py:248`

Under-13 is hard-blocked at signup, which is the right COPPA-aware default. Worth a sentence in `frontend/content/legal/privacy.md` (haven't read it; this is a hint to verify).

### P3 — nits

#### P3-1 — `backend/app/routers/groups.py:274-280` uses inline role check instead of `require_leader`
The dep is declared in `app/deps.py`; using it would auto-compose `require_not_banned`. The current inline check skips that and lets a banned leader rotate invites.

#### P3-2 — `frontend/app/firebase-messaging-sw.js/route.ts:33` pins SDK to `10.12.2`
Lockstep with `frontend/package.json` is policy. A CI lint that asserts the strings match would catch the drift mechanically.

#### P3-3 — No structured log on FCM `quota_exceeded` other than the warn
**File:** `functions/src/onNotificationCreate.ts:192-198`
A daily quota hit is a real ops signal. Add Sentry breadcrumb + an alert on the log message.

#### P3-4 — `DEV_PLAN.md` references parts that no longer apply post-M6
The file header even calls this out. Worth a pruning pass — the current shape misleads any new contributor (or new Claude session) reading top-down.

---

## Production readiness verdict

**Can JACOB run a real ministry of 30–100 members tomorrow?** Almost. The architecture is solid, the rate limits are real, default-deny is genuinely default-deny, the SSE chat + polling fallback is well thought-out, idempotency markers exist where they need to, push notifications work, CSAM/NCMEC paths are wired correctly.

But — until P0-1 and P0-2 are merged (this PR), **a minor can bypass owner review on any open-mode group**. That's not a "small ministry, low risk" trade-off; that's a one-bug-away-from-an-incident posture for a Christian small-group app with stated parental-consent requirements. **Do not start onboarding minors before this PR merges.**

Once P0-1 and P0-2 are in, P1-1 (DOB re-derivation) is the next thing to land. It's belt-and-braces, takes maybe an hour, and means the next P0 in this area requires a write to the *private* subcollection — much harder to slip in by accident.

P1-5 (production cutover) is the big one for "actually flip the switch": empty prod project, hardcoded staging in apphosting.yaml, no Terraform applied, no secrets, no DNS. 1–2 days of focused work and a runbook.

After that, the app is genuinely ready for 30–100 real users. The scale headroom (~$1/mo) is comfortable; the abuse surfaces are gated; the moderation pipeline is real; the ops story (Cloud Logging + Sentry + a small set of scheduled jobs) is appropriately small.

---

## What's fixed inline in this PR

1. **P0-1** — `isMinor` removed from `UpdateProfileRequest`; PATCH handler no longer writes the field.
2. **P0-2** — open-mode self-join branch checks `isMinor` and falls through to the request-mode (owner-escalation) path when the caller is a minor.
3. **P2-3** — dead `users_ref` removed from `cleanup_stale_devices.py`.
4. **P2-6** — `firestore.rules` comment fixed to reference ADR 0015 not ADR 0014.
5. **P2-7** — `Dockerfile` comment updated to reference a script that still exists.

Plus tests: a regression test on the minor self-join, and a regression test confirming `PATCH /api/users {isMinor: ...}` is rejected as an unknown field.

---

## What's deferred for Christopher

Everything **P1** above (1-1 through 1-6) plus **P2** items 1, 2, 4, 5, 8 and the P3 nits. The P1 items are design calls; the P2 items mostly need a quick scoping decision; the P3s are quality polish.

The single most important deferred item is **P1-5 (production cutover)** — there's no work that can replace "decide to go to prod, apply Terraform, populate Secret Manager, point the frontend at the right Firebase project, walk through the first end-to-end smoke test in prod." That's the real shipping risk.
