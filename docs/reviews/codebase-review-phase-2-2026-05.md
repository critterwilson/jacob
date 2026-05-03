# JACOB codebase review — Phase 2 (T19–T39)

**Date:** 2026-05-02
**Branch reviewed:** `main` @ `b197829` (T39: Foundation cleanup + deferred pickup)
**Reviewer:** Claude (automated review)
**Scope:** PRs #65, #66, #67, #68, #69, #70, #71, #72, #76, #78, #80, #81, #82, #84, #85, #86, #87, #88, #89, #90, #91, #92, #93, #94, #95 — verifying both that each task lands what it claimed and that the cumulative shape of the codebase has not regressed against the Phase 1 baseline (`docs/reviews/codebase-review-2026-05.md`).

Phase 2 is a *much* bigger surface than Phase 1: in 25 PRs the app picks up a moderation Cloud Function, a Typesense sidecar, BigQuery analytics, FCM push, board forums, full-text search, group discovery, multi-leader hierarchy, an invites subcollection, image variants, a PWA shell, GDPR data export, and a weekly email digest. The good news is that the Phase 1 hardening *largely held* — security rules now have shape validation, the CSAM check fails closed, frontend Sentry initialises, Workload Identity Federation has replaced the SA key, Firestore index drift is mostly gone, and dedicated SAs are in place. The new findings cluster in three places: (1) **operational fragility** — several Cloud-Run-job and Cloud-Function paths run queries that need indexes that nobody added (discover, weekly digest, stale-device cleanup, T25 invite lookup), so they will throw `FAILED_PRECONDITION` the first real time they fire; (2) **idempotency gaps in the new triggers** — the Phase 1 fix to `onMessageWrite` was copied for the counter logic but not for the new fan-out and `moderation_queue.add()` paths, so retries cause duplicate notifications and duplicate moderation rows; and (3) **a handful of cross-task semantic bugs** that no single PR's tests would catch — the export bundle reads the wrong notification-prefs path and silently truncates reactions, invite codes are not globally unique even though the consume query is global, and the `H6` admin-search prefix bug from Phase 1 is *still* unfixed.

---

## TL;DR — top 5

1. **T28 search is wired but the backend cannot reach the Typesense Cloud Run service** (`infra/typesense.tf:54-112`). The service has no `ingress` setting and no `roles/run.invoker` IAM binding for the API SA, so a default Cloud Run v2 deploy denies every request. Either the search endpoint silently 503s in production (acceptable, because `JACOB_SEARCH_ENABLED` defaults to false), or someone configured `--allow-unauthenticated` out of band — which is a bigger problem because the only auth left is the Typesense API key. **Pre-Phase-3 blocker.**

2. **Five cross-task Firestore queries will fail in prod with FAILED_PRECONDITION because the indexes are missing.** T30 discover (`backend/app/routers/discover.py:76-89`), T25 invite consume (`backend/app/services/invites.py:131-137`), T34 stale-device cleanup (`infra/scheduled/cleanup_stale_devices.py:51-53`), T35 weekly-digest user enumeration (`infra/scheduled/weekly_digest.py:42-46`), and T20/T32 hidden-message filtering for boards posts (`firestore/firestore.rules:476-483`) all need composite or CG indexes that are absent from `firestore/firestore.indexes.json`. PR descriptions claim some of these were added; they were not. Each one breaks a user-visible feature or scheduled job the first time it runs. **Pre-Phase-3 blocker.**

3. **Invite codes are unique within a group but consumed globally.** `services/invites.generate_invite_code` checks for collisions only inside `groups/{gid}/invites` (`backend/app/services/invites.py:60-67`), but `consume_invite` runs `collection_group("invites").where("code","==",code)` (`backend/app/services/invites.py:131-137`). The invite alphabet is 36 chars × 8 length, so birthday collisions across the whole DB are inevitable past a few tens of thousands of invites. When two groups have the same code, joining with that code lands the user in the *first* arbitrary match — not necessarily the group that issued the invite they followed. **Pre-Phase-3 blocker.**

4. **The T38 export bundle reads notification preferences from the wrong path and silently caps the user's reactions at 10 000 docs.** `services/export._notification_state` reads `users/{uid}/private/notifications` (`backend/app/services/export.py:268-272`), but T34's prefs live at `users/{uid}/notificationPrefs/main` — every export currently emits an empty `notificationPreferences` block. Separately, `_reactions` walks `collection_group("users")` with a 10 000-doc cap (`backend/app/services/export.py:218-227`); a user who reacted to >10k messages gets a partial bundle, which is non-compliant for a GDPR Art. 15 DSAR. **Pre-Phase-3 blocker because GDPR was the entire motivation for T38.**

5. **Triggers added in Phase 2 inherit the Phase-1 idempotency pattern only for the counter increments, not for the new side-effects.** `onMessageWrite` re-fanning reply notifications outside the `_events` transaction (`functions/src/onMessageWrite.ts:138-176`), `onMessageCreate` and `onBoardPostCreate` calling `moderation_queue.add(...)` without an event-id dedup (`functions/src/onMessageCreate.ts:222-234`, `functions/src/onBoardPostCreate.ts:182-194`), and `mentionFanout` writing notifications via unconditional `add()` (`functions/src/services/mentionFanout.ts:46-55`) all duplicate output on the at-least-once retried event. The Cloud Function platform retries idle within seconds; the user-visible blast radius is "duplicate moderation queue rows" and "double-pinged FCM mentions." **Trackable as a Phase 3 task; not blocking.**

---

## Critical

### C1 — Backend has no IAM/ingress permission to call the Typesense Cloud Run service
- **Where:** `infra/typesense.tf:54-117`. No `ingress` setting (defaults to `INGRESS_TRAFFIC_ALL` permission-wise but auth-required) and no `google_cloud_run_v2_service_iam_member` granting `roles/run.invoker` to the `jacob-api` SA, the Cloud Function SA, or `allUsers`.
- **Evidence:** Searching `infra/` for any IAM-binding referencing the Typesense service returns zero results: `grep -rn "google_cloud_run_v2_service_iam\|typesense.*invoker" infra/` is empty. `backend/app/services/search.py:121-123` calls Typesense over HTTP with only `X-TYPESENSE-API-KEY` set — no GCP OIDC token.
- **Why it matters:** As deployed via this Terraform, every search request from the backend to the Typesense service will return HTTP 403 (Cloud Run default-deny). The frontend gracefully degrades because `JACOB_SEARCH_ENABLED` is false by default, but the moment that flag flips, search is dead. Worse: if an operator works around it by running `gcloud run services add-iam-policy-binding ... allUsers run.invoker` to make the service public, the only auth left is the Typesense admin API key, which lives in Secret Manager but is sent over the public internet on every search. The infra spec in ADR 0005 calls for the backend to reach Typesense over the GCP internal network, not the public one.
- **Fix:** Add `ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"` (or `INTERNAL_LOAD_BALANCER`) on the `google_cloud_run_v2_service.typesense` resource, and add `google_cloud_run_v2_service_iam_member` resources granting `roles/run.invoker` to the `jacob-api` SA and the Cloud Function default SA. Document the access pattern in `docs/runbooks/search.md`.

### C2 — Five Firestore queries will fail in prod because their indexes are missing
- **Where:**
  - `backend/app/routers/discover.py:76-89` — `groups`-collection query with `where("isPrivate","==",false)` + `order_by("memberCount","desc")` + `order_by("createdAt","desc")` + optional `where("audience","==",x)` needs composite indexes that are not in `firestore.indexes.json`. The PR #86 description claims the index was added; it was not.
  - `backend/app/services/invites.py:131-137` — `collection_group("invites")` with `where("code","==",code)` and `where("revokedAt","==",None)` needs a CG composite index. PR #80 description claims it was added; it was not.
  - `infra/scheduled/cleanup_stale_devices.py:51-53` — `collection_group("devices")` with `where("lastSeenAt","<",cutoff)` needs a CG single-field DESC index. The file's own comment says "see firestore.indexes.json"; no such index exists.
  - `infra/scheduled/weekly_digest.py:42-46` — `collection_group("notificationPrefs")` with `where("digest","==",true)` needs a CG single-field index. Not present.
  - The boards `posts` rule's hidden-state filter for non-author readers (`firestore/firestore.rules:476-483`) requires the rules engine to read `moderation.state` on every doc; this is a rules cost, not an index cost, but it blows the per-query 10-doc-get budget on any non-trivial board.
- **Evidence:** `firestore/firestore.indexes.json` has only `messages.parentMessageId+createdAt`, four `moderation_queue` indexes, and seven `fieldOverrides` (`members.uid`, `messages.authorUid`, `messages.mentions`, `audit_log.actorUid`, `audit_log.targetRef`, `exports.startedAt`, `users.createdAt`, `groups.createdAt`). No index for `groups` ordered by `(memberCount,createdAt)`, no CG index on `invites.code`, `devices.lastSeenAt`, or `notificationPrefs.digest`.
- **Why it matters:** Each of these queries throws `9 FAILED_PRECONDITION: The query requires an index` the first time it runs in prod. For the discover endpoint and invite consume that's a user-visible 500. For the scheduled jobs that's a silent failure of weekly digest send and stale-device cleanup. The error log will tell you the exact `gcloud firestore indexes` URL to click; the wider risk is that the deploy pipeline and the test harness don't catch this — the rules emulator does NOT enforce composite-index existence (queries succeed against an unbounded result set).
- **Fix:** Add the missing entries to `firestore/firestore.indexes.json` and run `firebase deploy --only firestore:indexes`. Verify each query against staging before un-flagging the corresponding feature.

### C3 — Invite codes can collide across groups; consumer query is global
- **Where:** `backend/app/services/invites.py:56-74` (uniqueness scoped to a single group), `backend/app/services/invites.py:131-137` (consume query is `collection_group("invites")` with no `gid` filter).
- **Evidence:**
  ```python
  # generate_invite_code
  existing = list(
      db.collection("groups").document(gid).collection("invites")
      .where("code", "==", code).limit(1).stream()
  )
  ...
  # consume_invite
  hits = list(
      db.collection_group("invites")
      .where("code", "==", code).where("revokedAt", "==", None)
      .limit(1).stream()
  )
  ```
  The alphabet is 36 chars × length 8 → ~2.8 × 10¹² possible codes, but the birthday bound on a globally-unique check at ~10⁵ codes is ~0.01% — and the per-group uniqueness only protects against same-group collisions. Across groups, two leaders rotating codes can independently land on the same code. The consume query then returns whichever doc Firestore enumerates first.
- **Why it matters:** A user clicking an invite link `https://jacob.app/join?code=ABC12345` may be added to a *different* group than the one that issued the invite. There's no UX surface that confirms "you joined Foo Group" before the join completes — `consume_invite` just returns the gid. Audit log will show the wrong group.
- **Fix:** Either generate longer codes (12+ chars; cuts probability ~10⁶× for a fixed corpus) AND require collision-check across the CG before write, or change the consume API to take `(gid, code)` so the lookup is `gid`-scoped. The latter is simpler and defends against this category outright. The frontend already knows the gid of the invite link's URL (it's embedded in the URL the leader shares).

### C4 — T38 export reads notification preferences from the wrong Firestore path; reactions silently truncated past 10 k
- **Where:** `backend/app/services/export.py:268-272` (wrong prefs path), `backend/app/services/export.py:210-244` (reactions cap).
- **Evidence:**
  ```python
  prefs_snap = (
      db.collection("users").document(uid)
        .collection("private").document("notifications").get()
  )
  ```
  T34 stores prefs at `users/{uid}/notificationPrefs/main` (`firestore/firestore.rules:143-153`, `frontend/app/(authed)/settings/notifications/page.tsx`), not at `users/{uid}/private/notifications`. The export's `notificationPreferences` field is therefore always empty. Independently:
  ```python
  _REACTION_SCAN_CAP = 10_000
  ...
  for snap in query.stream():
      scanned += 1
      if scanned > _REACTION_SCAN_CAP:
          logger.warning("export_reactions_cap_hit ...")
          break
  ```
  The query is `collection_group("users")` with no filter — it walks every reaction doc in the database (one per user reaction). At 10 000 docs scanned across all groups, the reaction list truncates *before* the user's own docs are exhausted. There is no index on `users.{some-key}` that would let the query filter by uid (the doc IDs are the uid, and CG queries on doc-id are not supported).
- **Why it matters:** The whole point of T38 is GDPR Art. 15. An export that omits the user's notification preferences and silently truncates their reactions is non-compliant — it claims to be "all data" but isn't. The wrong-path bug is the bigger red flag: a CI test that asserted the bundle's `notificationPreferences` reflected what the user set on the notifications page would have caught it (the existing tests assert the *shape* but not the *plumbing* — see `backend/tests/test_export.py`).
- **Fix:**
  - Read the prefs from `users/{uid}/notificationPrefs/main`, plus the device list from `users/{uid}/devices/*` (already correct).
  - Replace the `collection_group("users")` scan with an explicit per-group walk: iterate the user's memberships from `_memberships`, then for each gid walk `groups/{gid}/messages/{*}/reactions/*/users/{uid}`. This is bounded by the user's group count and the messages-per-group, not by the global reaction volume.
  - Add an integration test that creates ≥3 reactions in ≥2 groups + sets prefs ≠ defaults and asserts both shape and content of the resulting bundle.

### C5 — Cloud Function fan-out paths re-fire on retry (idempotency only covers counters)
- **Where:**
  - `functions/src/onMessageWrite.ts:138-176` — reply-notification fan-out runs *outside* the `_events` transaction guard. The transaction returns early on duplicate, but the function continues past the `try` block.
  - `functions/src/onMessageCreate.ts:222-234` — `db.collection("moderation_queue").add(...)` writes a brand-new doc on every event firing. No event-id dedup.
  - `functions/src/onBoardPostCreate.ts:182-194` — same pattern for board posts.
  - `functions/src/services/mentionFanout.ts:46-55` — `add(...)` per recipient, no idempotency.
  - `functions/src/onNotificationCreate.ts` — no `collapse_key` on the FCM payload despite the comment claiming "FCM deduplicates within 4 h via collapse_key."
- **Evidence:** Search `functions/src` for `_events` markers — only `onMessageWrite`, `onMemberWrite`, `onReactionWrite`, `onMessageIndex`, and `onBoardPostWrite` use them. The triggers added in Phase 2 for *fan-out* (`onMessageCreate`, `onBoardPostCreate`, `onNotificationCreate`) and the helper `mentionFanout` do not.
- **Why it matters:** Cloud Functions v2 events are at-least-once. A retried event causes:
  1. A duplicate row in `moderation_queue` (visible in the admin queue, increments the count, double-counts in any future analytics query).
  2. Duplicate `users/{uid}/notifications/{nid}` docs for mentions and replies, each of which fires its own FCM push via `onNotificationCreate`. The user gets two push notifications for the same mention.
  3. The reply-fan-out path runs even when the transactional guard has already caught a duplicate — the early return inside the transaction callback does not exit the outer arrow function.
- **Fix:** Wrap the moderation-queue and notification writes in the same `_events` transaction shape used by `onMessageWrite`'s counter increment. For mentions, key on `event.id + recipientUid`. For `onNotificationCreate`, set `webpush.headers["Topic"]` = `${kind}-${nid}` so the platform deduplicates within FCM's collapse window.

---

## High

### H1 — H6 from Phase 1 (admin search prefix bug) was never fixed
- **Where:** `backend/app/routers/admin.py:325-327, 451-453`.
- **Evidence:** `db.collection("users").where("displayName",">=",q).where("displayName","<=",q + "")` — `q + ""` evaluates to `q`, so this is exact-match, not prefix. The Phase 1 review (finding H6) explicitly called this out and recommended `q + ""`. PR #54 ("Address Medium and Low findings from Phase 1 review") did not include this — it was a High finding, scoped to PR #21, which also missed it.
- **Why it matters:** Admin search returns *only* exact-name matches. An admin searching "ali" still cannot find "Alice."
- **Fix:** One-line change to `q + ""` in both call sites. Add a backend test that creates "Alice" and "Bob" and asserts a search for "Al" returns Alice.

### H2 — `boards/{boardId}/posts/{*}` allows any signed-in user to read hidden posts and replies
- **Where:** `firestore/firestore.rules:466-471, 519-520, 558-563`.
- **Evidence:**
  ```
  match /boards/{boardId} {
    allow read: if isSignedIn();
    match /posts/{postId} {
      allow read: if isSignedIn();
      ...
      match /replies/{replyId} {
        allow read: if isSignedIn();
      ...
      match /reactions/{stickerSlug}/users/{uid} {
        allow read: if isSignedIn();
  ```
  The PR #88 description says "Hidden posts remain readable to author so that the moderation banner renders correctly" — but the rule grants read to *anyone signed-in*, not the author. There is no equivalent of the group-message rule's `moderation.state != 'hidden'` filter for non-members.
- **Why it matters:** The whole point of T20-style auto-moderation is that flagged content does not render to general users. On boards it does — every signed-in user can fetch the post body via the SDK and bypass the client-side filter. This is the same finding we did NOT have on group messages because the group rule does the filter for non-members.
- **Fix:** Tighten the boards posts read rule:
  ```
  allow read: if isSignedIn() && (
    resource.data.deletedAt == null
    && (resource.data.get('moderation', null) == null
        || resource.data.moderation.get('state', null) != 'hidden')
  ) || resource.data.authorUid == request.auth.uid
    || (request.auth.token.admin == true);
  ```
  Same shape on replies. Add three rules-tests: anonymous deny, hidden-by-others deny, hidden-by-author allow.

### H3 — Group leader hierarchy mutations are not transactional
- **Where:** `backend/app/routers/groups.py:204-303` (promote / demote), `backend/app/routers/groups.py:469-562` (announce_message reads pinnedMessageIds outside txn).
- **Evidence:** `_require_leader` reads the group + member docs, then `target_ref.update({"role": ...})` writes — no transaction. The leaderless guard is enforced by *the Firestore rule*, but the rule reads `groups/{gid}.leaderCount` which is *eventually consistent* with `onMemberWrite`. Two concurrent demotes by two leaders both see `leaderCount > 1` (e.g. 2), both succeed, the trigger fires twice asynchronously, and the group lands at `leaderCount == 0`. The rule prevents *self-leave* under that condition but says nothing about backend-mediated role flips.
- **Why it matters:** With three leaders, two of them can race-demote each other and one of the survivors. Chance is small but non-zero, and the failure mode is "group bricked" — no leader can rotate the invite code, edit metadata, archive, or unarchive.
- **Fix:** Run promote / demote inside a Firestore transaction that re-reads `leaderCount` after the role flip and aborts if it would go below 1. Add a backend test that simulates two concurrent demotes and asserts the second one 409s.

### H4 — Reply notifications skip the parent message's author
- **Where:** `functions/src/onMessageWrite.ts:114-118, 138-176`.
- **Evidence:** Line 117 does `participants: FieldValue.arrayUnion(afterData.authorUid)` — the *reply*'s author. The original message author is NOT added to `participants` until they themselves reply in the thread. The fan-out at line 144 reads `participants` — so the original author is not notified of replies to their message.
- **Why it matters:** This is a feature-level bug in T34: T34 promised "reply notifications to thread participants." The original author is the *first* participant in any sane mental model. Today they get nothing until they themselves engage. T22's announcement fan-out covers leader-pushed announcements but not normal replies.
- **Fix:** Initialise `participants: [authorUid]` on parent message create (the `onMessageWrite` create branch is for the *reply*, not the parent — needs a separate trigger or a backfill of the parent on first reply). Alternative: in the reply create branch, `arrayUnion(parentSnap.data.authorUid, replyAuthorUid)` so the parent's author always lands in the set.

### H5 — `tryReserveFcmQuota` is called once per notification but FCM is sent N times (one per device)
- **Where:** `functions/src/onNotificationCreate.ts:126-160`.
- **Evidence:** `tryReserveFcmQuota()` is called once before the device loop (line 126), but the loop at lines 137-160 calls `sendFcm` once per device. A user with 3 devices counts as 1 quota slot but consumes 3 actual FCM dispatches.
- **Why it matters:** The quota counter is meant to prevent runaway FCM cost. Underrun by Nx for users with many devices makes the cap meaningless on the right tail. For a user with 5 devices the cap is effectively 5x.
- **Fix:** Move the quota reservation inside the per-device map, or reserve `devicesSnap.size` slots up-front in a single transaction.

### H6 — `onNotificationCreate` overwrites `failedAt` with `deliveredAt` on the same notification
- **Where:** `functions/src/onNotificationCreate.ts:147-162`.
- **Evidence:** Line 153-156 sets `failedAt: serverTimestamp(), failureReason: ...` inside the `catch`. Line 162 then unconditionally sets `deliveredAt: serverTimestamp()` *after* `Promise.allSettled`, regardless of whether any send failed.
- **Why it matters:** A notification doc whose only device fails to send ends up with both `failedAt` and `deliveredAt` populated. Any consumer that branches on `if data.deliveredAt` (the obvious read pattern) treats it as delivered. The state machine is unclear and observability is broken.
- **Fix:** Track success count in the loop. If success > 0, write `deliveredAt`; else (only failures), don't overwrite `failedAt`. Also write `delivered: count`, `failed: count` so admin tooling can distinguish "1 of 3 devices delivered" from "all 3 delivered."

### H7 — `digest.assemble_user_payload` enumerates *all* groups per user
- **Where:** `backend/app/services/digest.py:81-91`.
- **Evidence:**
  ```python
  for snap in db.collection("groups").stream():
      member = db.collection("groups").document(snap.id).collection("members").document(uid).get()
      if member.exists:
          ...
  ```
  This is N+1 reads per user, and N is *all groups in the system* — not the user's groups. With 10 000 groups and 1 000 digest-opted-in users, that's 10⁷ Firestore reads per Sunday.
- **Why it matters:** Cost (~$0.06 per million reads → \$60 per Sunday at that scale, growing linearly with both N and M), latency (digest job stretches from minutes to hours), and reliability (the longer the loop, the more likely an instance restart aborts mid-batch).
- **Fix:** Use the M11 CG query: `db.collection_group("members").where("uid","==",uid).stream()`. The CG index is already configured (`firestore.indexes.json:50-55`).

### H8 — `mentionFanout` writes notification docs without the message body
- **Where:** `functions/src/services/mentionFanout.ts:46-55`, `functions/src/onMessageCreate.ts:247-272`.
- **Evidence:** The fan-out helper writes:
  ```typescript
  await db.collection("users").doc(recipientUid).collection("notifications").add({
      ...payload,           // {kind, messageRef, groupId|boardId}
      fromUid: authorUid,
      createdAt: ...,
      readAt: null,
  });
  ```
  No `body` field. `onNotificationCreate.buildPayload` then reads `notif.body ?? ""` and the FCM push body is empty. Compare with `onMessageWrite`'s reply fan-out (line 142-167), which *does* include a body: `String(afterData?.body ?? "").slice(0, 100)`.
- **Why it matters:** Mention pushes are silent — "@you was mentioned" with no preview. The user can't tell if it's worth opening the app. Same on board mentions.
- **Fix:** Pass a `body` snippet in the `MentionNotificationPayload` and write it on the notification doc. Cap at 100 chars (matches reply fan-out and `onNotificationCreate.truncate`).

### H9 — `digest.py:65` uses `os.environ.get` (regression of CLAUDE.md "no scattered env reads")
- **Where:** `backend/app/services/digest.py:65`, `backend/app/services/verse.py:89, 93`.
- **Evidence:** `if os.environ.get("JACOB_DIGEST_ENABLED", "false")...` and `os.environ.get("BIBLE_API_BASE", ...)`. The same names are defined as `Settings` fields (`backend/app/config.py:42-44, 49-50`), so the codebase has both shapes. The CLAUDE.md "Things to never do" rule explicitly forbids this: *"Never use `os.environ.get(...)` scattered through the backend — load env via a single `Settings` pydantic-settings class in `backend/app/config.py`."*
- **Why it matters:** Two sources of truth for the same flag. Tests that monkey-patch `os.environ` work; tests that override `Settings` (the documented pattern) don't. A misconfigured prod that sets `Settings.jacob_verse_disabled=True` *via secrets manager* won't actually disable the verse fetch because the code reads `os.environ` directly.
- **Fix:** Replace each call site with `get_settings().jacob_digest_enabled` / `.jacob_verse_disabled` / `.bible_api_base`. Add a lint rule that fails CI on `os.environ.get(` outside `app/config.py`.

### H10 — Admin moderation/user/group LIST endpoints have no rate limit
- **Where:** `backend/app/routers/admin.py:123-205, 313-362, 442-472`.
- **Evidence:** `list_moderation_queue`, `search_users`, `search_groups` carry no `@limiter.limit(...)` decorator. Only the mutation endpoints (`/resolve`, `/bulk-resolve`, `/ban`, `/unban`, `/groups/{gid}/moderation-policy`) are limited.
- **Why it matters:** Phase 1 finding M3 explicitly recommended a global "10/min" on `/api/admin/*`. The mutation paths got it; the read paths didn't. A compromised admin token can pull the entire moderation queue (paginated, but the limit/cursor is admin-controlled) or enumerate all users/groups via repeated calls.
- **Fix:** Apply `@limiter.limit("60/minute")` to every `/api/admin/*` GET. Mutation paths can stay at the existing tighter limit.

### H11 — Boards reactions are readable by *anyone signed in*, not just board readers
- **Where:** `firestore/firestore.rules:558-563`.
- **Evidence:** `match /reactions/{stickerSlug}/users/{uid} { allow read: if isSignedIn(); ... }`. The group analogue (lines 384-407) gates reactions on `isGroupMember(gid)` — boards are public so that's defensible — but the read predicate doesn't filter on the post's `deletedAt` or `moderation.state`. A user can enumerate every reaction on every soft-deleted or hidden post.
- **Why it matters:** Reactions are an information leak. A hidden post's reaction list reveals which users found the (hidden) content compelling — useful for moderators to know, harmful for the public. Same for soft-deleted posts.
- **Fix:** Either gate reactions on the parent post being non-deleted/non-hidden via a `get()` (extra read cost), or accept that reactions on a hidden post are a known leak and document it explicitly. Recommend the former.

### H12 — `_unique_invite_code` and slug uniqueness on board create are racy
- **Where:** `backend/app/routers/boards.py:107-116`, `backend/app/routers/groups.py:62-72`, `backend/app/services/invites.py:56-74`.
- **Evidence:** Each does read-then-write outside a transaction. Two concurrent admins creating boards with the same slug, two leaders rotating their group invite, or two parallel POSTs to `/api/groups` can race and produce duplicates.
- **Why it matters:** Boards: if two boards have the same slug, the URL `/boards/{slug}` matches arbitrarily. Group invite: collision is rare per H/T1 above. Group create: gid is a UUID so no collision.
- **Fix:** For boards slugs, use `boards/{slug}` as the doc id (slug becomes the natural primary key) — enforce uniqueness at the Firestore level. For invites, see C3.

### H13 — `set_moderation_policy` is mounted under `/api/admin` but accepts non-admin leaders
- **Where:** `backend/app/routers/admin.py:483-533`.
- **Evidence:** The endpoint is on the admin router (`prefix="/api/admin"`) but inline-checks `is_platform_admin` and falls through to a leader check. The route requires `Depends(get_current_user)` not `Depends(require_admin)`.
- **Why it matters:** Mounting non-admin endpoints on `/api/admin/*` confuses the rate-limit / auth boundary. A future change that adds "all `/api/admin` paths require admin" via a global dependency would silently break this. It also means the H10 rate-limit fix above must explicitly carve out this path.
- **Fix:** Move to `/api/groups/{gid}/moderation-policy` to match the `/api/groups/...` shape used by archive/announce. Or rename the dep to `require_admin_or_leader_of(gid)` and apply globally.

### H14 — `onNotificationCreate` lacks `collapse_key` despite the docstring promising one
- **Where:** `functions/src/onNotificationCreate.ts:7-13` and `functions/src/services/fcm.ts:88-101`.
- **Evidence:** Comment says "Retried delivery re-sends, but FCM deduplicates within 4 h via `collapse_key`." `sendFcm`'s message payload has no `collapse_key`, no `webpush.headers["Topic"]`. So nothing actually deduplicates.
- **Why it matters:** Combined with C5, retried events produce duplicate FCM pushes that the platform doesn't dedupe.
- **Fix:** Set `webpush.headers["Topic"]` = `${kind}-${nid}` (or pass the notification doc id). FCM dedupes within the topic on push servers.

### H15 — Discover endpoint does not filter archived groups
- **Where:** `backend/app/routers/discover.py:76-88`.
- **Evidence:** Query filters on `isPrivate == false` and optionally `audience`, but not on `archivedAt`. Archived groups appear in `/discover` and can be join-requested.
- **Why it matters:** A user requesting to join an archived group hits a `/api/groups/{gid}/join-requests` endpoint that doesn't check `archivedAt` either — the join flow may succeed and add the user to a dead group.
- **Fix:** Add `.where("archivedAt", "==", None)` to the query (requires a composite index — see C2). Same for `create_join_request`.

---

## Medium

### M1 — `digest.archived_at.datetime < cutoff` uses a non-existent attribute
- **Where:** `backend/app/services/digest.py:88-90`.
- **Evidence:** `if hasattr(archived_at, "datetime") and archived_at.datetime < cutoff` — Firestore Timestamp objects don't expose `.datetime`. They expose `.ToDatetime()` or comparison via `>=` directly. The branch never fires; archived groups are never excluded from the digest.
- **Fix:** Use `archived_at if isinstance(archived_at, datetime) else archived_at.ToDatetime(tzinfo=UTC)` and compare against `cutoff`.

### M2 — `reject_join_request` is not transactional
- **Where:** `backend/app/routers/discover.py:354-398`.
- **Evidence:** Read `jr_snap.exists` + `status == 'pending'`, then `jr_ref.update({"status": "rejected", ...})`. No transaction, no re-check inside. The `approve` path (lines 308-339) *does* use a transaction.
- **Why it matters:** Two leaders simultaneously rejecting + approving the same request can both succeed; whichever lands second wins, but the audit log shows two events. Not a security risk, but inconsistent with `approve`.
- **Fix:** Run inside a transaction that re-reads `status == 'pending'`.

### M3 — `consume_invite` validates expiry/maxUses outside the transaction
- **Where:** `backend/app/services/invites.py:152-172`.
- **Evidence:** Expiry check happens outside the transaction; only `useCount` is re-checked inside. An invite that expires *between* the outer check and the transaction commits as if not expired.
- **Why it matters:** Edge case, narrow window. A user joining at the moment of expiry could squeeze through. Not a security gap (they were eligible until then) but the `expires_at` test guarantee is weak.
- **Fix:** Move the expiry comparison inside the `_run` transaction body using the txn-read invite data.

### M4 — `announce_message` reads members all at once for fan-out
- **Where:** `backend/app/routers/groups.py:535-548`.
- **Evidence:** `members_snaps = ...members.stream()` then iterated to a list. For a 1 000-member group: 1000 Firestore reads + 1000 block-check reads (`bulk_write_notifications`) on the request's critical path. Cloud Run timeout is typically 60s; this can blow it.
- **Fix:** Move the fan-out to a Cloud Function trigger keyed on `announcedAt` setting (so the response returns immediately), or paginate the announce + write the audit row from the trigger instead.

### M5 — `find_in_flight` race lets two concurrent POSTs both create export jobs
- **Where:** `backend/app/services/export.py:369-413`.
- **Evidence:** Read-then-write. `find_in_flight` returns None for both calls before either commits the new job doc. Rate limit `1/hour` masks this in practice but doesn't *enforce* it.
- **Fix:** Wrap in a transaction that re-checks for an in-flight job before writing.

### M6 — `process_one._claim` documents a "single-instance Cloud Run Job" assumption that nothing enforces
- **Where:** `backend/app/services/export.py:591-606`.
- **Evidence:** Comment says "Cloud Run job runs single-instance per scheduler tick (see `infra/scheduler.tf`: retry_count=1, no parallelism)" — but the scheduler config doesn't set Cloud Run *task parallelism*; the *retry config* limits retries, not concurrent runs. A scheduler that fires twice in quick succession (e.g. UI manual run + cron) plus the 5-minute interval can produce two parallel processor instances each picking up the same `find_pending_jobs` rows.
- **Fix:** Make `_claim` a Firestore transaction that asserts `startedAt is None` and writes it atomically.

### M7 — `onBoardPostCreate` duplicates `onMessageCreate`'s `runModeration` verbatim
- **Where:** `functions/src/onMessageCreate.ts:106-245` vs `functions/src/onBoardPostCreate.ts:81-204`.
- **Evidence:** ~120 lines of drift-prone copy: tryReserveQuota, decisionFor, hidden/flagged/scored state machine, and the `moderation_queue.add(...)` shape are repeated. A future change to one (e.g. CW from M9 below, or the per-board policy in T32 phase 3) is unlikely to land in both.
- **Fix:** Extract `runTextModeration({ resourceRef, resourceType, eventId, body, policyResolver, db })` into `services/textModeration.ts`; both triggers call it.

### M8 — `mediaRefs` allows `data:` and `javascript:` URIs (Phase 1 L9 unresolved)
- **Where:** `firestore/firestore.rules:284-285` (group messages), `firestore/firestore.rules:481-485` (board posts).
- **Evidence:** Both rules check `mediaRefs is list && size() <= 4` but never validate each element. A leader (per the rules) can write `mediaRefs: ["javascript:alert(1)"]`. The frontend `PhotoView.tsx` renders `<img srcset>` with the URL substituted — `<img>` ignores `javascript:`, but `data:image/svg+xml` SVGs can carry XSS in some sandboxing contexts.
- **Fix:** Pin the URL prefix in the rule:
  ```
  && request.resource.data.mediaRefs.toSet().hasOnly([])
     || request.resource.data.mediaRefs[0].matches('^https://storage\\.googleapis\\.com/jacob-media-public-.*')
  ```
  (Iterating list elements in CEL is awkward; the simpler alternative is to validate at write time on the backend and never let the client write `mediaRefs` directly.)

### M9 — Sticker validation on reactions reads the `stickers` doc but boards reactions don't validate the sticker exists *for the board's stickerSet*
- **Where:** `firestore/firestore.rules:399-407, 558-571`.
- **Evidence:** Both reaction rules check `exists(/databases/.../stickers/$(stickerSlug))` — but a sticker is in the `general` audience and a board allows it regardless of its own audience. Boards have no `stickerSet` field today; group's `stickerSet` (e.g. `"christian"`) is checked nowhere either.
- **Why it matters:** A user can react with any sticker that exists. Acceptable for v1; flag for Phase 3.

### M10 — Reaction *delete* (`firestore/firestore.rules:402-403`) lacks `notBanned()`
- **Where:** `firestore/firestore.rules:402-403`.
- **Evidence:** `allow delete: if isUser(uid)` — no ban check. Comment says "removing a reaction is a neutral action we don't need to block on ban."
- **Why it matters:** Inconsistent with the other rules. A banned user can flip back and forth on a reaction (delete + recreate not possible — recreate is blocked — so this is just delete). Cosmetic but the policy is non-uniform.
- **Fix:** Either drop `notBanned` everywhere it's used for "neutral" actions or add it here. Recommend adding for consistency.

### M11 — `users/{uid}` create rule allows `role` field but defines no upgrade path
- **Where:** `firestore/firestore.rules:64-66, 71`.
- **Evidence:** Create allows `role` if it equals `'member'`. Update locks it: `changedKeys().hasOnly(['displayName','photoURL','isMinor'])`. The only way a user becomes admin is via the Admin SDK setting the `admin` *custom claim*, not the `role` field.
- **Why it matters:** The `role` field on `users/{uid}` is therefore vestigial and confusing. It's allowed at creation but never modifiable, and never read by any rule. Document it as deprecated or drop it from the create allow-list.

### M12 — `useUser.ts` cookie `jacob-has-profile` lacks `Secure` and `HttpOnly`
- **Where:** `frontend/lib/hooks/useUser.ts:51-53, 58-59`.
- **Evidence:** `document.cookie = "jacob-has-profile=1; path=/; SameSite=Lax";` — no `Secure`, no `HttpOnly` (HttpOnly impossible from JS, but Secure is). Sent over HTTP in non-prod.
- **Fix:** Append `; Secure` when `location.protocol === 'https:'`. Better still: set the cookie server-side via a `/api/session` route so the client doesn't depend on `document.cookie` for routing.

### M13 — `onMessageIndex.classifyIndexAction` has unreachable "skip" branch
- **Where:** `functions/src/onMessageIndex.ts:97-106`.
- **Evidence:** `if (!afterExists) return "delete"; if (afterDeletedAt != null) return "delete"; if (!beforeExists || afterExists) return "upsert"; return "skip";` — once the first two `return`s are passed, `afterExists` is true (otherwise we'd have returned `"delete"`), so `(!beforeExists || afterExists)` is always true. `"skip"` is unreachable.
- **Why it matters:** Dead code is rarely *only* dead code — it usually means someone intended a guard that doesn't work. Safe to remove, but flag the file for re-review.
- **Fix:** Drop the unreachable branch. Rename `IndexAction` to `"upsert" | "delete"`.

### M14 — `bulk_resolve_moderation_items` doesn't dedup `body.itemIds`
- **Where:** `backend/app/routers/admin.py:256-307`.
- **Evidence:** Loop iterates each id; if the same id appears twice in the request, the first call resolves, the second returns "already resolved" → in `skipped`. Caller can't distinguish "id was bad" from "id was duplicated."
- **Fix:** `seen = set(); for item_id in body.itemIds: if item_id in seen: skipped.append(item_id); continue; seen.add(item_id); ...`

### M15 — `requestedAt` ordering tie-break in `useExportStatus.deriveStatus` uses `>=`
- **Where:** `frontend/lib/hooks/useExportStatus.ts:85-95`.
- **Evidence:** `if (t >= latestTs) { latestTs = t; latest = ...; }` — for two jobs with the same timestamp (e.g. created in the same Firestore second), this picks the *last* enumerated, which is non-deterministic across snapshots. Causes the status panel to flicker between two jobs.
- **Fix:** Use `>` and break ties on `id` lexicographically.

### M16 — `__events` and `_reaction_events` markers grow unbounded
- **Where:** `functions/src/onMessageWrite.ts:106`, `functions/src/onMemberWrite.ts:77`, `functions/src/onReactionWrite.ts:35`, `functions/src/onMessageIndex.ts:215-217`.
- **Evidence:** Each idempotency marker is a permanent doc under the parent. After a year of activity, every message has a `_events` subcollection with one doc per write event. Cost is small (~100 bytes per doc) but unbounded. Listing children for an export will iterate them.
- **Fix:** Add a TTL using Firestore's per-document TTL feature on `processedAt + 7 days`. Document in `docs/data-model.md`.

### M17 — `user.claims.get("admin") is True` does not match the rule's `request.auth.token.admin == true`
- **Where:** `backend/app/routers/admin.py:498`, `firestore/firestore.rules:516, 524`.
- **Evidence:** Backend checks Python `claims["admin"] is True`. The rule checks `request.auth.token.admin == true`. Firebase ID tokens with `"admin": "yes"` would pass the backend's `is True` check (no it wouldn't — `is True` is identity, "yes" != True), but `request.auth.token.admin == true` only true if the literal boolean `True` was set. Tight on both sides — no actual bug, but the code uses `is` and the rule uses `==`. Use `claims.get("admin") == True` for clarity.
- **Fix:** Standardise on `==`. Add a comment in the admin script (`backend/scripts/grant_admin.py`) that the value MUST be the boolean `True`, not `"true"` / `"yes"` / `1`.

---

## Low / nits

### L1 — `verse.py` blocks the daily-verse Cloud Run Job for up to 30 s on a flaky API
- **Where:** `backend/app/services/verse.py:97-101`.
- **Evidence:** 3 retries × 10 s timeout × 2^attempt backoff (1, 2, 4) → up to ~30 s of CPU plus blocking I/O. Cloud Run Jobs default to 10-minute timeouts so this isn't fatal, but long sleep loops in a once-daily job are wasteful.
- **Fix:** Drop the timeout to 5 s.

### L2 — `frontend/lib/firebase.ts` `apiKey: "missing-api-key"` is a footgun
- **Where:** `frontend/lib/firebase.ts:58-65`.
- **Evidence:** Server prerender would receive `"missing-api-key"` and never throw. The `if (isBrowser)` guard catches it on the client, but a server-side Firebase SDK call (any path that reaches `firestore` or `auth` from a server component) would silently 401.
- **Fix:** Don't initialise the SDK with placeholder values; fail loudly on server-side configuration miss.

### L3 — `isMember: () => true` for boards mention fan-out lets users mention non-existent UIDs
- **Where:** `functions/src/onBoardPostCreate.ts:247-248`, `functions/src/services/mentionFanout.ts:44`.
- **Evidence:** Board mention bypass is intentional (boards have no membership), but the fan-out then writes to `users/<bogus>/notifications/<id>`. Firestore Admin SDK accepts the write — there's no integrity check.
- **Why it matters:** Garbage docs accumulate under `users/{nonexistent}/notifications/`. Won't be cleaned up until someone signs in with that uid.
- **Fix:** Cheap mitigation: `getDoc(users/{uid})` and skip if absent. Adds 1 read per mention but avoids garbage.

### L4 — `ban_user` payload `previousExpiresAt` may be a Firestore Timestamp object, not a string
- **Where:** `backend/app/routers/admin.py:399-401`.
- **Evidence:** `audit_payload["previousExpiresAt"] = _ts_to_str(existing_expires)` — `_ts_to_str` returns `str | None`, but Firestore stores datetime. Audit log payload is heterogeneous; not strictly broken, just messy.
- **Fix:** Standardise on ISO strings in audit_log payloads.

### L5 — `notifications.body` truncates at 200 with `[:200].replace("\n", " ")`, can split mid-emoji
- **Where:** `backend/app/services/notifications.py:46, 100`.
- **Evidence:** Slicing a Python str at byte index can split a multi-byte UTF-8 sequence (Python str is unicode, but emoji are often multi-codepoint). Cosmetic.
- **Fix:** Use `body[:200]` (Python is unicode-safe), drop the comment about emoji split — or use `textwrap.shorten(body, 200)`.

### L6 — `boards/{bid}` rule `read: if isSignedIn()` exposes archived boards too
- **Where:** `firestore/firestore.rules:447`.
- **Evidence:** Backend `list_boards` filters `archivedAt is None` (`backend/app/routers/boards.py:73-76`), but a signed-in client reading the doc directly via SDK sees archived boards. Acceptable since posts are archive-gated, but inconsistent.
- **Fix:** Add `(resource.data.get('archivedAt', null) == null || isPlatformAdmin())` to the read predicate, or document that archived boards ARE readable.

### L7 — `useGroupMessages` caches *hidden* messages to IndexedDB
- **Where:** `frontend/lib/hooks/useGroupMessages.ts:90-103`.
- **Evidence:** Snapshot writes the full `msgs` array to IDB without filtering on `moderation.state`. Hidden messages live in plaintext on the user's device.
- **Why it matters:** A user viewing a moderated message could open DevTools and read the body from IDB even if the UI hid it. Mitigation: clearCache on sign-out + offline cap of 50 messages.
- **Fix:** Filter `msgs.filter(m => m.moderation?.state !== 'hidden')` before `cacheMessages`.

### L8 — `daily_verse.fetch_verse_for_today` mutates `_calendar_cache` global with a non-atomic pattern
- **Where:** `backend/app/services/verse.py:78-85`.
- **Evidence:** Standard `if cache is None: cache = load()`. Race-safe in CPython due to GIL, but Cloud Run can run multiple async workers per process.
- **Fix:** Use a `functools.lru_cache` instead.

### L9 — `frontend/components/SentryInit.tsx` calls `initSentry()` inside `useEffect`, so SSR-time exceptions still aren't captured
- **Where:** `frontend/components/SentryInit.tsx:7-9`.
- **Evidence:** `useEffect` only runs on the client, after hydration. Server-render errors and the first paint's render errors aren't captured by Sentry.
- **Why it matters:** This was the original C3 from Phase 1; the fix is correct for client errors but doesn't extend to server. App Router server components can throw too.
- **Fix:** Add `instrumentation.ts` or `sentry.server.config.ts` per @sentry/nextjs guidance to capture server-side exceptions.

### L10 — `onMessageIndex.shouldReindex` JSON-stringifies arrays for compare; non-stable iteration order on objects
- **Where:** `functions/src/onMessageIndex.ts:84-92`.
- **Evidence:** `JSON.stringify(before[f] ?? null)` for arrays is OK; for objects (none currently in the indexed-fields list) it would be order-sensitive. Future-proofing risk.
- **Fix:** Use `lodash.isEqual` or a proper deep-equal.

### L11 — `infra/typesense.tf:64` pins `typesense/typesense:0.27.0` by mutable tag
- **Where:** `infra/typesense.tf:18`.
- **Evidence:** No digest pin. M5 from Phase 1 fixed the backend Dockerfile but not third-party container images in TF.
- **Fix:** Pin to `typesense/typesense@sha256:...` and let Dependabot bump.

### L12 — `frontend/public/firebase-messaging-sw.js` self-inits via `swReg.active?.postMessage` race
- **Where:** `frontend/lib/push.ts:51-55`.
- **Evidence:** `swReg.active?.postMessage(...)` — `swReg.active` is null until the SW is "activated." On first registration, `swReg.installing` or `swReg.waiting` is set instead, and the message is silently dropped. The SW then has no Firebase config when the first push arrives.
- **Fix:** Wait for `swReg.installing.state === "activated"` (or use `navigator.serviceWorker.ready`) before posting.

### L13 — `infra/scheduled/process_export_jobs.py` doesn't enforce `JACOB_EXPORT_DISABLED`
- **Where:** `infra/scheduled/process_export_jobs.py:48-72`.
- **Evidence:** The processor reads pending jobs unconditionally. The kill switch only blocks new requests at the router level. Existing queued jobs continue to process.
- **Why it matters:** Operator turning off the feature mid-flight still bills for the in-flight bundles.
- **Fix:** Check `get_settings().jacob_export_disabled` at the top of `main()` and exit cleanly.

### L14 — `_held/` quarantine prefix has SetStorageClass but no Delete lifecycle
- **Where:** `infra/buckets.tf:101-110`.
- **Evidence:** Comment says "Manual deletion requires legal-counsel sign-off" — fine — but the SetStorageClass to COLDLINE at age 365 is the only lifecycle. Without an end-state Delete (even at 7+ years), Coldline retention costs accumulate forever.
- **Fix:** Document the 7-year retention policy and add a Delete rule at age 2557 days.

### L15 — `_KNOWN_REASONS` set in admin.py contains a comment but no entries for legacy free-text values
- **Where:** `backend/app/routers/admin.py:110-119`.
- **Evidence:** Comment says "legacy free-text reasons (T12 reports). Filtering by these is a no-op but the queue page still surfaces them." But the validator only checks `reason in _KNOWN_REASONS` for filter parameters, so a queue row whose `reason` is "free-text whatever" is invisible to filters even though it renders in the unfiltered list. Operator confusion.
- **Fix:** Either add a "legacy" filter option, or write a one-shot migration to normalise old reasons.

### L16 — `frontend/lib/mentions.ts` `extractMentionedUids` is order-sensitive on overlapping display names
- **Where:** `frontend/lib/mentions.ts:7-19`.
- **Evidence:** Iterates `members` in array order and tests pattern; the *first* member matching the regex wins. Two users with overlapping names ("Alice" and "Alice B") + body "@Alice B" → matches "Alice" first because the regex is `@Alice(?:\s|$)` and "Alice B" ends with " B", which is a word-boundary fail. So actually `extractMentionedUids` does work for that case. But two users named "Alice" return only the first.
- **Fix:** Use the longest-display-name-first sort that `renderBodyWithMentions` already does. Or switch to UID-prefixed mention storage (`@uid:abc123`) and render display names client-side.

### L17 — `_unique_invite_code` retries 5 times then raises 500
- **Where:** `backend/app/routers/groups.py:62-72`, `backend/app/services/invites.py:56-74`.
- **Evidence:** A user-facing 500 on collision has zero actionable message. With H/T1 above this is also a wrong-on-collision call.
- **Fix:** Higher retry budget AND better error code (`code_generation_failed` is informative; the HTTP 500 is not).

---

## Verifications that the Phase 1 fixes still hold

- ✅ **C2 (CSAM fail-open)** — `backend/app/services/moderation.py:85-91` raises `RuntimeError` when `JACOB_HASH_SERVICE_URL` is unset.
- ✅ **C3 (frontend Sentry init)** — `frontend/components/SentryInit.tsx` calls `initSentry()` inside `useEffect`. (See L9 for a residual.)
- ✅ **C4 (Google Form placeholder)** — `frontend/lib/report-url.ts` was deleted in PR #65; `useReport` posts to `/api/reports`.
- ✅ **C5 (deploy SA key → WIF)** — `infra/wif.tf` plus `permissions: id-token: write` in deploy job.
- ✅ **C1 (chat shows raw UIDs)** — `firestore/firestore.rules:61` widens the user read rule to `allow read: if isSignedIn()`.
- ✅ **H1 (onMessageWrite idempotency for counters)** — `_events` markers in place.
- ✅ **H3 (rule shape validation)** — every create/update predicate has `keys().hasOnly(...)` plus per-field type/length checks. (One residual on `mediaRefs` element validation — see M8.)
- ✅ **H4 (deletedAt pinning)** — `firestore/firestore.rules:300-301` pins `request.resource.data.deletedAt == request.time && resource.data.deletedAt == null`.
- ✅ **H5 (public bucket listability)** — custom role `publicObjectReader` grants only `storage.objects.get`.
- ✅ **H7 (admin createdAt DESC indexes)** — present in `firestore.indexes.json:96-110`.
- ✅ **H8 (quarantine lifecycle scoped to `uploads/`)** — `infra/buckets.tf:88-98`.
- ✅ **H10 (deploy branch protection)** — environment `production` defined; reviewer-required configured per repo settings (cannot verify in source).
- ✅ **H11 (dependency / SAST scanning)** — `.github/dependabot.yml` exists; CI dropped CodeQL but PR #74 commit message explains it was redundant with the GitHub-managed default.
- ✅ **H12 (groupIds drift)** — backend stopped writing it (`backend/app/routers/groups.py:117-119` notes M11 explicitly), CG members query in place.
- ✅ **L7 (Terraform remote state)** — `infra/backend.tf` GCS backend, `infra/versions.tf` provider pins, `.terraform.lock.hcl` committed.
- ✅ **L4 (default deny)** — still present.
- ✅ **M14 (`frontend/.env.example`)** — exists.
- ❌ **H6 (admin search prefix bug)** — *not fixed.* See H1 above.
- ⚠️ **M5 (Dockerfile pinned by digest)** — backend Dockerfile yes; `infra/typesense.tf` Typesense image not. See L11.
- ⚠️ **M6 (functions lockfile)** — `functions/package-lock.json` committed; deploy still runs `firebase deploy --only functions` which may run npm install separately. Lockfile presence improves consistency but the deploy path is not visibly using `npm ci`.
- ⚠️ **M9 (frontend integration tests)** — `frontend/tests/integration/messages.emulator.test.ts` exists with 3 specs. Not exhaustive — only message read/write paths covered.

---

## Phase-3 blockers vs. trackable

**Must land before opening Phase 3 (regressions or new pre-launch issues):**

- **C1** — Typesense Cloud Run IAM/ingress (search broken under default config)
- **C2** — five missing Firestore indexes (discover, invites, devices cleanup, digest enumeration, archived filter)
- **C3** — global invite-code uniqueness (wrong-group join)
- **C4** — export PII bundle correctness (notification prefs path; reaction cap)
- **C5** — fan-out idempotency on `onMessageCreate` / `onBoardPostCreate` / `mentionFanout` (duplicate moderation rows + duplicate FCM)
- **H1** — admin search regression
- **H2** — boards hidden-content read leak
- **H7** — digest enumerates all groups per user (cost / latency disaster)
- **H8** — mention notifications without body
- **H9** — `os.environ.get` regression in digest/verse (CLAUDE.md violation; kill-switch can desync)
- **H14** — `collapse_key` missing on FCM payload
- **H15** — discover doesn't filter archived

**Trackable as Phase 3 tasks (don't block, but should be on the board):**

- H3 — leader hierarchy transactional safety
- H4 — reply notifications miss original author
- H5 — FCM quota undercount
- H6 — `failedAt`/`deliveredAt` race
- H10 — admin LIST endpoints unrate-limited
- H11 — boards reactions visible signed-in
- H12 — slug/invite collision races
- H13 — moderation-policy endpoint mounted under `/api/admin`
- M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M15, M16, M17
- All Low/nits

**Severity totals:** Critical 5 · High 15 · Medium 17 · Low 17 = **54 findings.**

---

## Files reviewed

Backend: `app/main.py`, `config.py`, `limits.py`, every router under `app/routers/`, every service under `app/services/`, every model under `app/models/`, `app/middleware/`, every test under `backend/tests/`, `Dockerfile`, `pyproject.toml`, `.env.example`, scripts under `backend/scripts/`.

Frontend: `app/layout.tsx`, every page under `app/(authed)/` and `app/(auth)/`, every hook under `lib/hooks/`, `lib/{firebase,sentry,offline-cache,push,mentions,search-snippet,auth-context}.ts`, every component under `components/{auth,chat,boards,moderation,nav,onboarding,home,search,discover,admin,analytics,stickers,account}/`, `app/sw.ts`, `tests/setup.ts`, every `tests/*.test.tsx`.

Firestore: `firestore.rules` (646 lines), `firestore.indexes.json`, every `firestore/tests/*.rules.test.ts`, `firestore/seed/stickers.ts`.

Functions: `src/index.ts`, every trigger (`onMessageWrite`, `onMessageCreate`, `onMemberWrite`, `onReactionWrite`, `onMessageIndex`, `onBoardPostCreate`, `onBoardPostWrite`, `onBoardReplyWrite`, `onBoardReactionWrite`, `onNotificationCreate`, `onPhotoUploadFinalize`), every `services/` (`circuitBreaker`, `fcm`, `imageVariants`, `mentionFanout`, `textModeration`, `typesense`), every `__tests__/`.

Infra: `backend.tf`, `versions.tf`, `wif.tf`, `service_accounts.tf`, `scheduler.tf`, `buckets.tf`, `bigquery.tf`, `exports.tf`, `typesense.tf`, `uptime-checks.tf`, every `infra/scheduled/*.py`, every `infra/scripts/*.py`, `infra/seed/verse_calendar.json`.

CI/CD: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`, `firebase.json`, `frontend/apphosting.yaml`.

Docs: `README.md`, `CLAUDE.md`, `DEV_PLAN.md`, `docs/phase-2-impl-spec.md`, `docs/phase-2-dev-plan.md`, `docs/phase-3-dev-plan.md`, `docs/oncall.md`, `docs/gdpr.md`, `docs/moderation-pipeline.md`, `docs/moderation-runbook.md`, `docs/data-model.md`, `docs/email-templates.md`, `docs/design-tokens.md`, `docs/adr/0001-rate-limit-strategy.md`, `docs/adr/0003-collection-group-memberships.md`, `docs/adr/0004-invite-collection.md`, `docs/adr/0005-search-sidecar.md`, `docs/runbooks/restore.md`, `docs/runbooks/search.md`, `docs/runbooks/bigquery-export.md`, `docs/runbooks/text-moderation-tuning.md`, `docs/follow-ups/phase-1-deferred.md`.
