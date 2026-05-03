# JACOB data-layer migration plan

**Browser → Firestore (direct) → Browser → FastAPI → Firestore (Admin SDK).**

**Author:** Claude (planning pass)
**Date:** 2026-05-03
**Status:** Draft, not yet implemented. Squash-merged to `main` so subsequent phase PRs can reference stable section anchors.
**Branch this plan was authored on:** `claude/data-layer-migration-plan` off `main` @ `9cdd800`.

---

## 1. TL;DR

JACOB's frontend currently talks to Firestore directly via the Firebase JS SDK. Every realtime listener, profile read, sticker fetch, message write, reaction toggle, and board-post create reaches `firestore.googleapis.com` from the browser. uBlock Origin, AdGuard, Brave Shields, and Privacy Badger all block that hostname by default — `firestore.googleapis.com` appears in the EasyPrivacy and Brave-default tracker lists because Google Analytics and Firebase share the `googleapis.com` netblock. The user-visible failure is silent: `onSnapshot` never fires, `getDoc` rejects with `unavailable`, and the app sits forever on a loading skeleton. Affected users hit the bug on first onboarding, before any of our error toasts or Sentry have a frame to render. We have evidence (and at least one in-the-wild reproduction) that this is breaking the app for a meaningful slice of the target audience, exactly the slice most likely to install adblockers.

The fix is to route all Firestore I/O through the existing FastAPI backend (which already has a stable `/api/` prefix that no adblocker touches because it's served from the same origin as the Next.js app via Firebase App Hosting), and to replace `onSnapshot` with **Server-Sent Events on `/api/streams/*`** — see Section 8 for the SSE-vs-WebSocket decision. Ad blockers do not block same-origin first-party `/api/*` paths because doing so would break every site on the web; the cost of false positives is too high, so the rule lists explicitly avoid it.

The migration is staged in six phases (M1–M6), ordered by risk and dependency. **Phase A (M1)** ports stickers and the daily verse — small, low-traffic, validates the fetch + SWR pattern. **Phase B (M2)** ports profile / user / notification-prefs reads and moves the `jacob-has-profile` cookie bootstrap server-side, fixing the immediate onboarding-blocked symptom. **Phase C (M3)** ports groups + memberships (the `useGroups`, `useGroup`, `useMembers`, pinned-messages reads). **Phase D (M4)** ports all writes — message create, edit, soft-delete, reactions, profile update, mutes, blocks, board posts, board reactions — and adds rate limits and audit log entries that don't exist today. **Phase E (M5)** introduces SSE on `/api/streams/groups/{gid}` and `/api/streams/notifications` and rebuilds `useGroupMessages`, `useThreadMessages`, `usePinnedMessages`, `useReactions`, `useNotifications` to consume the stream + fall back to polling when SSE is denied. **Phase F (M6)** removes `firebase/firestore` from the frontend bundle entirely, deletes the now-dead client-side rule predicates that have moved into FastAPI guards, and tightens Firestore security rules to default-deny everything that's no longer read directly from the browser.

The migration is **safe to land incrementally**: each phase's PR is independently shippable, each backwards-compatible with the previous, and any single phase can be reverted in isolation without manual data cleanup. The two non-obvious risks are (1) the `users/{uid}` cookie-bootstrap race (M2 must move it server-side without breaking the existing middleware contract — see §7.M2.5) and (2) the chat realtime path's reconnect/backfill semantics, which need to be exactly right or we'll silently drop messages on transient disconnects (see §6.4 and §7.M5.7).

The plan does not commit to new paid infrastructure beyond what is already running. SSE fanout across Cloud Run instances does want Redis Pub/Sub eventually, but Phase E ships a **single-instance** SSE implementation first, which works because Cloud Run's `min_instances=0` plus `max_instances=1` is a viable configuration for the chat backend during M5 validation; M5.10 lays out the path to multi-instance Redis fanout when traffic justifies it. Open questions, including whether to keep Firestore listeners alive on the admin tooling routes (where we control the network and adblockers don't apply), are catalogued in §12 with `DESIGN-OPEN` markers.

---

## 2. Inventory

**Methodology.** Two grep sweeps:

1. `grep -rn "from \"firebase/firestore\"" frontend/` — every file that imports the SDK at all (44 hits across hooks, components, App Router pages, and tests). Test files are excluded from the migration scope but kept on a dedicated cleanup list in §7.M6.
2. `grep -rn "onSnapshot\|getDoc\|getDocs\|setDoc\|addDoc\|updateDoc\|deleteDoc\|runTransaction\|writeBatch\|collectionGroup" frontend/` — every operation site. This second sweep catches files that re-export through helpers and is the source of truth for the call-shape inventory below.

The inventory is grouped by collection path so the endpoint map (§4) can mirror it 1:1. Frequency tier is editorial: **hot** = called on every group view (chat, board, member list); **warm** = called on every page load that touches the relevant feature; **cold** = called once per onboarding or rare admin action.

### 2.1 Headline counts

| Surface | Files using `firebase/firestore` |
|---|---|
| Hooks (`frontend/lib/hooks/`) | 19 of 29 hook files |
| Components (`frontend/components/`) | 7 (chat × 3, groups × 3, boards × 2, onboarding × 1) |
| App Router pages (`frontend/app/`) | 6 (groups: chat, settings, settings/invites, members, analytics; authed: settings/notifications) |
| Library (`frontend/lib/`) | 2 (`firebase.ts` initializer; `push.ts` device token writes) |
| Tests (`frontend/tests/`) | 8 — out of migration scope until M6 cleanup |
| Total non-test files writing or reading Firestore | **34** |

Twenty-nine new endpoints are needed to cover the gaps (counted in §4). Ten existing endpoints already cover what the client used to do via the SDK and just need their callers switched. Three operations (sticker fetch, daily verse, FCM device registration) are trivial and become the Phase A pilot.

### 2.2 Per-collection inventory

The schema below is dense on purpose so the endpoint map (§4) and the rules port (§5) can cite individual rows.

| Tier | Path / Hook | Op | RT? | Where/order/limit | Calling component(s) | grep evidence |
|---|---|---|---|---|---|---|
| **`/users/{uid}`** | | | | | | |
| warm | `useUser` (hook) | `onSnapshot(doc)` | Y | none | `app/(authed)/layout.tsx`, every authed page transitively | `frontend/lib/hooks/useUser.ts:37-69` |
| cold | `ProfileForm` (component) | `setDoc(doc)` | N | one-shot create | `app/onboarding/page.tsx` | `frontend/components/onboarding/ProfileForm.tsx` |
| cold | `useDeletionStatus` (hook) | `onSnapshot(doc)` | Y | none, watches `deletionRequestedAt` | `app/(authed)/settings/account/page.tsx` | `frontend/lib/hooks/useDeletionStatus.ts` |
| **`/users/{uid}/private/profile`** | | | | | | |
| cold | (none today; PII reads happen server-side via `/api/account/*`) | n/a | n/a | n/a | n/a | rules-only — `firestore.rules:108-111` |
| **`/users/{uid}/mutes/{otherUid}`** | | | | | | |
| hot | `useMutes` (hook) | `onSnapshot(coll)` | Y | none — full set | every chat render (membership predicate) | `frontend/lib/hooks/useMutes.ts` |
| warm | `useMutes` (hook) | `setDoc(doc)` | N | `{mutedAt: serverTimestamp()}` | `MessageItem` mute action | same |
| warm | `useMutes` (hook) | `deleteDoc(doc)` | N | n/a | same | same |
| **`/users/{uid}/blocks/{otherUid}`** | | | | | | |
| hot | `useBlocks` (hook) | `onSnapshot(coll)` | Y | none — full set | every chat render | `frontend/lib/hooks/useBlocks.ts` |
| warm | `useBlocks` (hook) | `setDoc(doc)` | N | `{blockedAt: serverTimestamp()}` | `MessageItem` block action | same |
| warm | `useBlocks` (hook) | `deleteDoc(doc)` | N | n/a | `app/(authed)/settings/blocked/page.tsx` | same |
| **`/users/{uid}/devices/{deviceId}`** | | | | | | |
| cold | `frontend/lib/push.ts` | `setDoc(doc)` | N | one-shot create with `lastSeenAt: serverTimestamp()` | `usePushSetup` hook called on first FCM permission grant | `frontend/lib/push.ts` |
| **`/users/{uid}/notificationPrefs/main`** | | | | | | |
| cold | `app/(authed)/settings/notifications/page.tsx` | `getDoc(doc)` | N | one-shot read | settings page | direct usage |
| cold | same | `setDoc(doc)` | N | full doc replace with toggles | save button | same |
| **`/users/{uid}/notifications/{nid}`** | | | | | | |
| warm | (no current hook; NotificationsBell pulls from FCM payloads, not Firestore today — see Phase 2 review C5) | n/a | n/a | n/a | NotificationsBell | rules-only — `firestore.rules:653-661` |
| **`/users/{uid}/exports/{jobId}`** | | | | | | |
| cold | `useExportStatus` (hook) | `onSnapshot(coll)` | Y | `orderBy("requestedAt","desc"), limit(5)` | `app/(authed)/settings/account/export-panel.tsx` | `frontend/lib/hooks/useExportStatus.ts` |
| **`/groups/{gid}`** | | | | | | |
| hot | `useGroup` (hook) | `onSnapshot(doc)` | Y | none | every group page (chat, settings, members, analytics) | `frontend/lib/hooks/useGroup.ts` |
| warm | `usePinnedMessages` (hook) | `onSnapshot(doc)` | Y | reads `pinnedMessageIds` only | chat header pinned-banner | `frontend/lib/hooks/usePinnedMessages.ts` |
| cold | `usePinnedMessages` (hook) | `updateDoc(doc)` | N | `{pinnedMessageIds: [...]}` | leader pin/unpin action | same |
| cold | `GroupSettingsForm` | `updateDoc(doc)` | N | `{name, description, isPrivate, joinMode, audience, stickerSet}` | settings page form submit | `frontend/components/groups/GroupSettingsForm.tsx` |
| cold | `GroupAvatarUpload` | `updateDoc(doc)` | N | `{avatarUrl: <publicURL>}` | settings page after upload finalize | `frontend/components/groups/GroupAvatarUpload.tsx` |
| **`/groups/{gid}/members/{uid}`** | | | | | | |
| hot | `app/groups/[gid]/members/page.tsx` | `onSnapshot(coll)` | Y | none — full member list | members page | direct usage |
| hot | `app/groups/[gid]/chat/page.tsx` | `onSnapshot(doc)` | Y | self only — role gate | chat page | direct usage |
| warm | `app/groups/[gid]/settings/page.tsx` | `onSnapshot(doc)` | Y | self only — leader gate | settings page | direct usage |
| warm | `app/groups/[gid]/analytics/page.tsx` | `onSnapshot(doc)` | Y | self only — leader gate | analytics page | direct usage |
| warm | `useMembers` (hook) | `onSnapshot(coll)` | Y | none | mention picker | `frontend/lib/hooks/useMembers.ts` |
| **collection-group `members`** | | | | | | |
| warm | `useGroups` (hook) | `onSnapshot(collectionGroup("members"))` | Y | `where("uid","==",me)` | nav drawer, group switcher | `frontend/lib/hooks/useGroups.ts:57-60` |
| warm | `useGroups` (hook, derived) | `getDoc(groups/{gid})` per match | N | one read per group the user is in | same | same |
| **`/groups/{gid}/messages/{mid}`** | | | | | | |
| **hot** | `useGroupMessages` (hook) | `onSnapshot(query)` | Y | `where("parentMessageId","==",null), orderBy("createdAt","desc"), limit(50)` | `app/groups/[gid]/chat/page.tsx` (every chat view) | `frontend/lib/hooks/useGroupMessages.ts:83-118` |
| **hot** | `useGroupMessages.loadOlder` | `getDocs(query)` | N | as above + `startAfter(cursor)` | scroll-up pagination | `frontend/lib/hooks/useGroupMessages.ts:120-146` |
| **hot** | `useThreadMessages` (hook) | `onSnapshot(query)` | Y | `where("parentMessageId","==",pid), orderBy("createdAt","desc"), limit(50)` | thread drawer | `frontend/lib/hooks/useThreadMessages.ts` |
| warm | `useThreadMessages.loadOlder` | `getDocs(query)` | N | as above + `startAfter` | thread drawer scroll | same |
| warm | `useRecentMessages` (hook) | `getDocs(query)` per group | N | `orderBy("createdAt","desc"), limit(5)` per group user is in | home dashboard "recent activity" | `frontend/lib/hooks/useRecentMessages.ts` |
| **hot** | `MessageInput` (component) | `addDoc(coll)` | N | `{authorUid, body, stickerIds, mediaRefs, parentMessageId, threadReplyCount: 0, mentions, deletedAt: null, editedAt: null, createdAt: serverTimestamp()}` | every chat message | `frontend/components/chat/MessageInput.tsx` |
| **hot** | `ThreadReplyInput` (component) | `addDoc(coll)` | N | as above with `parentMessageId` set | every thread reply + optional repost as new top-level | `frontend/components/chat/ThreadReplyInput.tsx` |
| warm | `MessageItem` (component) | `updateDoc(doc)` | N | `{body, editedAt}` (within 15min) or `{deletedAt}` (soft-delete) | edit / delete menu | `frontend/components/chat/MessageItem.tsx` |
| **`/groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`** | | | | | | |
| **hot** | `useReactions.react` | `setDoc(doc)` | N | `{reactedAt: serverTimestamp()}` | every reaction tap | `frontend/lib/hooks/useReactions.ts:38` |
| **hot** | `useReactions.unreact` | `deleteDoc(doc)` | N | n/a | every reaction toggle off | `frontend/lib/hooks/useReactions.ts:59` |
| | (read of own reactions is intentionally skipped — counts are denormalised on the message) | | | | | |
| **`/groups/{gid}/joinRequests/{uid}`** | | | | | | |
| cold | (already backend-mediated for create/list; client-side hook for status?) | n/a | n/a | n/a | discover flow | already-server-side: `backend/app/routers/discover.py` |
| **`/groups/{gid}/invites/{inviteId}`** | | | | | | |
| warm | `useInvites` (hook) | `onSnapshot(coll)` | Y | `orderBy("createdAt","desc")` | `app/groups/[gid]/settings/invites/page.tsx` | `frontend/lib/hooks/useInvites.ts` |
| **`/stickers/{sid}`** | | | | | | |
| cold | `useStickers` (hook) | `getDocs(query)` | N | `orderBy("order")` (one-shot, module-level cached) | every chat / reaction picker | `frontend/lib/hooks/useStickers.ts` |
| **`/boards/{boardId}`** | | | | | | |
| cold | `useBoards` (hook) | `onSnapshot(coll)` | Y | `where("archivedAt","==",null), orderBy("order")` | `app/boards/page.tsx` | `frontend/lib/hooks/useBoards.ts` |
| **`/boards/{boardId}/posts/{postId}`** | | | | | | |
| **hot** | `useBoardPosts` (hook) | `onSnapshot(query)` | Y | `where("deletedAt","==",null), orderBy("pinnedAt","desc"), orderBy("createdAt","desc"), limit(50)` | `app/boards/[bid]/page.tsx` | `frontend/lib/hooks/useBoardPosts.ts:42-50` |
| warm | `useBoardPost` (hook) | `onSnapshot(doc)` | Y | none | `app/boards/[bid]/posts/[pid]/page.tsx` | `frontend/lib/hooks/useBoardPost.ts` |
| **hot** | `NewPostForm` (component) | `addDoc(coll)` | N | full post shape (body, stickerIds, mediaRefs, mentions, reactionCounts: {}, replyCount: 0) | board page | `frontend/components/boards/NewPostForm.tsx` |
| warm | (post edit / soft-delete via `MessageItem`-equivalent inline editor on `BoardPostCard`) | `updateDoc(doc)` | N | `{body, editedAt}` or `{deletedAt}` | board post page | `frontend/components/boards/BoardPostCard.tsx` |
| **`/boards/{boardId}/posts/{postId}/replies/{replyId}`** | | | | | | |
| warm | `useBoardPost` (or sibling hook) | `onSnapshot(coll)` | Y | `where("deletedAt","==",null), orderBy("createdAt","asc"), limit(50)` | post detail page | `frontend/lib/hooks/useBoardPost.ts` |
| warm | `NewReplyForm` (component) | `addDoc(coll)` | N | reply shape | post detail page | `frontend/components/boards/NewReplyForm.tsx` |
| **`/boards/{boardId}/posts/{postId}/reactions/{slug}/users/{uid}`** | | | | | | |
| warm | `useBoardPostReactions` (hook) | `setDoc` / `deleteDoc` | N | mirror of `useReactions` | board post page | `frontend/lib/hooks/useBoardPostReactions.ts` |
| **`/daily_verse/{day}`** | | | | | | |
| cold | `useDailyVerse` (hook) | `getDoc(doc)` | N | doc id = today's date in `YYYY-MM-DD` | home dashboard | `frontend/lib/hooks/useDailyVerse.ts` |
| **`/groups/{gid}/analytics`** *(if exists; verify in §7.M3)* | | | | | | |
| cold | `useAnalytics` (hook) | already-backend via `/api/groups/{gid}/analytics` | N | n/a | analytics page | `frontend/lib/hooks/useAnalytics.ts` |
| **No-Firestore (already API)** | | | | | | |
| - | `useAnnounce` | `POST /api/groups/{gid}/messages/{mid}/announce` | | | | `frontend/lib/hooks/useAnnounce.ts` |
| - | `useReport` | `POST /api/reports` | | | | `frontend/lib/hooks/useReport.ts` |
| - | `useUploadPhoto` | `POST /api/uploads/photos` + `/finalize` | | | | `frontend/lib/hooks/useUploadPhoto.ts` |
| - | `useDiscoverGroups` | `GET /api/discover/groups` | | | | `frontend/lib/hooks/useDiscoverGroups.ts` |
| - | `useSearch` | `GET /api/search` | | | | `frontend/lib/hooks/useSearch.ts` |
| - | `useMaintenanceBanner` | `GET /api/system/maintenance` (or static) | | | | `frontend/lib/hooks/useMaintenanceBanner.ts` |
| - | `usePWAInstall` | browser `beforeinstallprompt` only | | | | `frontend/lib/hooks/usePWAInstall.ts` |
| - | `usePushSetup` | calls `lib/push.ts` which writes to Firestore (caught above) | | | | `frontend/lib/hooks/usePushSetup.ts` |

### 2.3 Cross-cutting observations

The inventory tells us five things that shape the rest of the plan.

**(a) The `onSnapshot` count is the migration's actual cost.** Eleven hooks register a realtime listener. That's eleven streams the SSE replacement needs to cover. Of those, only one — `useGroupMessages` — is on the chat critical path; the other ten are either low-frequency (mute lists, block lists, deletion status) or could degrade to polling at 30-60s intervals without anyone noticing. The plan exploits this asymmetry: chat gets a true SSE stream in M5; everything else gets either a one-shot fetch with manual refetch (mutes, blocks, members, group doc) or a polling SWR hook (board posts, notifications, deletion status). See §6 for the per-listener decision.

**(b) There is exactly one `collectionGroup` query** — `useGroups` doing `collectionGroup("members") where uid == me`. Its replacement is a single new endpoint, `GET /api/users/me/groups`, which the backend already has the index for (`firestore.indexes.json` has the `members.uid` field override per Phase 2 review H/M11). This simplifies a worry I had on the brief.

**(c) There are no client-side transactions or `writeBatch` calls.** Every write is a single-doc `setDoc` / `addDoc` / `updateDoc` / `deleteDoc`. The backend already runs transactions inside the existing `/api/groups` mutations, so porting message create / edit / delete preserves transaction boundaries server-side without losing anything. **The single exception I want to be careful about** is the bootstrap path on group create: today's flow is "client `addDoc` to `groups`, then client `setDoc` to `groups/{gid}/members/{uid}` with `role: leader`" — already backend (`POST /api/groups`) per `backend/app/routers/groups.py:79`. So the only client-side bootstrap left is `users/{uid}` first-write on onboarding (`ProfileForm`), which becomes `POST /api/users/me` in Phase B.

**(d) The `jacob-has-profile` cookie is set client-side from inside `useUser.ts`.** This is the single load-bearing side effect of the entire `useUser` realtime listener: middleware redirects on its absence (`frontend/middleware.ts:14-16`). A naive M2 that just turns the listener into a fetch will break onboarding, because the cookie will no longer get set. The fix is to set the cookie server-side from a new `GET /api/users/me/bootstrap` endpoint (or, better, on every `/api/*` response that the authed user hits; see §7.M2.5). **This is the single subtlest part of the migration. Get it right.**

**(e) Optimistic UI is already minimal.** `useReactions` keeps an in-memory `myReactionsRef: Set<string>` for "did I react to this?" but doesn't depend on Firestore offline cache. `useGroupMessages` writes successful snapshots to IndexedDB via `lib/offline-cache.ts` for offline read fallback (Phase 2 review L7 noted this leaks hidden message bodies). The IndexedDB cache survives the SDK removal — the cache module imports nothing from `firebase/firestore` directly — so this layer is migration-neutral. Optimistic-UI-on-write is currently absent: when you send a message, the message appears in the chat only when Firestore's local commit fires, which happens before the server roundtrip. After migration, the round-trip is server-mediated, which adds one network hop of latency (~80-150ms p50 over a warm Cloud Run). Section 9 covers the optimistic-write rebuild.

### 2.4 Components and pages with direct Firestore imports

These are the non-hook call sites. M2-M4 will rewrite each of them to call hooks that wrap the new API. None of them should retain any `firebase/firestore` import after M6.

| File | Imports from firebase/firestore | What it does | Replaced by |
|---|---|---|---|
| `frontend/components/chat/MessageInput.tsx` | `addDoc, collection, serverTimestamp` | post a top-level message | M4 + `useSendMessage(gid)` calling `POST /api/groups/{gid}/messages` |
| `frontend/components/chat/ThreadReplyInput.tsx` | `addDoc, collection, serverTimestamp` | post a thread reply (+ optional repost) | M4 + same hook with `parentMessageId` |
| `frontend/components/chat/MessageItem.tsx` | `doc, updateDoc, serverTimestamp` | edit body / soft-delete | M4 + `useEditMessage`, `useDeleteMessage` |
| `frontend/components/groups/GroupSettingsForm.tsx` | `doc, updateDoc` | edit group metadata | M3 + `PATCH /api/groups/{gid}` |
| `frontend/components/groups/GroupAvatarUpload.tsx` | `doc, updateDoc` | save avatar URL after upload | M3 + same `PATCH` |
| `frontend/components/groups/InviteList.tsx` | `collection, onSnapshot, orderBy, query` | list invites | M3 + `GET /api/groups/{gid}/invites` (already exists; just switch caller) |
| `frontend/components/boards/NewPostForm.tsx` | `addDoc, collection, serverTimestamp` | create board post | M4 + `POST /api/boards/{bid}/posts` |
| `frontend/components/boards/NewReplyForm.tsx` | `addDoc, collection, serverTimestamp` | create board reply | M4 + `POST /api/boards/{bid}/posts/{pid}/replies` |
| `frontend/components/onboarding/ProfileForm.tsx` | `doc, setDoc, serverTimestamp` | first-time profile create | M2 + `POST /api/users/me` |
| `frontend/app/groups/[gid]/chat/page.tsx` | `doc, onSnapshot` | group doc + own membership | M3 (group: `GET /api/groups/{gid}`) + M3 (membership: `GET /api/groups/{gid}/me`) |
| `frontend/app/groups/[gid]/settings/page.tsx` | `doc, onSnapshot` | own membership + group doc | same as above |
| `frontend/app/groups/[gid]/settings/invites/page.tsx` | `collection, onSnapshot, orderBy, query` | invite list | same as `InviteList.tsx` |
| `frontend/app/groups/[gid]/members/page.tsx` | `collection, doc, getDoc, onSnapshot` | full member list + group meta | M3 + `GET /api/groups/{gid}/members` |
| `frontend/app/groups/[gid]/analytics/page.tsx` | `doc, onSnapshot` | own membership | M3 + `GET /api/groups/{gid}/me` |
| `frontend/app/(authed)/settings/notifications/page.tsx` | `doc, getDoc, setDoc` | prefs read/write | M2 + `GET/PUT /api/users/me/notification-prefs` |
| `frontend/lib/firebase.ts` | `getFirestore, connectFirestoreEmulator, type Firestore` | exports `firestore` singleton | M6 — delete the export, delete the emulator hookup |
| `frontend/lib/push.ts` | `doc, setDoc, serverTimestamp` | register FCM device token | M2 + `POST /api/users/me/devices` |
| `frontend/middleware.ts` | (no firestore imports — only reads cookie) | redirect unauthed | M2 cookie-bootstrap rewrite (no SDK changes) |

### 2.5 Operations the inventory rules out

A few patterns I checked for and didn't find:

* **No `firebase/firestore/lite`** anywhere. Good — we don't have a parallel non-listener SDK shipping bytes too.
* **No client-side `writeBatch` or `runTransaction`**. The hardest writes (announce, archive, founder transfer, leader promote/demote, group create) are already on the backend.
* **No `enableMultiTabIndexedDbPersistence` / `enableIndexedDbPersistence`** calls. We are NOT relying on Firestore's offline cache for any user-facing feature. (`lib/offline-cache.ts` is a custom IDB layer that's unrelated.)
* **No `connectFirestoreEmulator` from anywhere except `lib/firebase.ts`**, which is the documented Pattern.
* **No fork of the SDK in node_modules.** `frontend/package.json` pins `firebase` directly.

The lack of offline persistence and the lack of client transactions together mean the migration is a straight call-site swap rather than a paradigm shift. That's a happy outcome.

---

## 3. Target architecture

### 3.1 Diagram

```
                     ┌──────────────────────────────────────────────────┐
                     │  Firebase App Hosting (Next.js — same origin)    │
                     │  - frontend/ static + RSC                         │
                     │  - frontend/middleware.ts (cookie redirect only)  │
                     └────────────────────┬─────────────────────────────┘
                                          │  same-origin /api/* fetch
                                          │  (HTTP/2; SSE on /api/streams/*)
                                          ▼
                     ┌──────────────────────────────────────────────────┐
                     │  FastAPI on Cloud Run (existing)                  │
                     │  ┌────────────────────────────────────────────┐  │
                     │  │ middleware: request-id, structured-logging │  │
                     │  │ middleware: rate-limit (slowapi)           │  │
                     │  │ middleware: NEW — auth (verify ID token)   │  │
                     │  │ middleware: NEW — cookie set 'has-profile' │  │
                     │  └────────────────────────────────────────────┘  │
                     │  routers/                                         │
                     │   account.py    groups.py    boards.py            │
                     │   admin.py      invites.py   reports.py           │
                     │   discover.py   search.py    uploads.py           │
                     │   analytics.py  debug.py                          │
                     │   NEW: users.py (profile + prefs + devices +      │
                     │                  mutes + blocks + bootstrap)      │
                     │   NEW: messages.py (chat read + write + edit +    │
                     │                  delete + reactions)              │
                     │   NEW: members.py (group members read)            │
                     │   NEW: stickers.py (read sticker set)             │
                     │   NEW: verse.py (today's verse)                   │
                     │   NEW: notifications.py (list + mark-read)        │
                     │   NEW: streams.py (SSE: /api/streams/*)           │
                     │  services/                                        │
                     │   firebase.py (Admin SDK singleton)               │
                     │   audit.py     moderation.py  notifications.py    │
                     │   storage.py   email.py       ...                 │
                     │   NEW: realtime.py (Firestore listener → SSE)     │
                     └────────────────────┬─────────────────────────────┘
                                          │  Admin SDK (server-trusted)
                                          ▼
                     ┌──────────────────────────────────────────────────┐
                     │  Firestore (Native mode, nam5)                   │
                     │  rules: tighten to default-deny everything       │
                     │  the client used to read directly (M6).           │
                     └──────────────────────────────────────────────────┘
                                          ▲
                                          │ (existing) Firestore triggers
                                          │
                     ┌──────────────────────────────────────────────────┐
                     │  Cloud Functions for Firebase (functions/src/)   │
                     │  onMessageWrite, onMemberWrite, onReactionWrite, │
                     │  onMessageCreate, onBoardPostCreate, ...         │
                     │  NEW: realtime fan-out emit                       │
                     │   (publish to backend SSE bus — see §6.5)        │
                     └──────────────────────────────────────────────────┘
```

### 3.2 Principles

The architecture is the Phase-1 architecture's logical extension, not a rewrite. CLAUDE.md's stated rule of thumb already split operations between "client SDK + rules" (trusted reads/writes) and "FastAPI + Admin SDK" (server-trusted writes). This migration moves the dial entirely toward the second column. CLAUDE.md will be updated in M6 to reflect the new defaults; no architectural ADR is required because nothing about Phase 1's deployment topology changes.

The principles below are constraints the implementation should hold to.

**P1. Same-origin API only.** The frontend talks to `/api/*` on the same hostname Next.js serves, never to `firestore.googleapis.com`, never to `firebaseio.com`, never to a CORS-needing third-party. Co-tenanting the API and the static app on Firebase App Hosting is what makes this true today (Phase 1 already did this — `firebase.json` rewrites). The rule means the migration cannot accidentally introduce a `fetch("https://...firestore.../v1/...")` shortcut.

**P2. Auth flows through one token, verified once.** Every `/api/*` request carries `Authorization: Bearer <Firebase ID token>`, verified by `get_current_user` (`backend/app/deps.py`). The token is the same one the Firebase JS SDK already mints for sign-in; we never re-derive credentials. No session cookies for auth — the existing `jacob-has-profile` cookie is a UX-only marker, not an auth boundary, and stays that way.

**P3. Pydantic in, Pydantic out.** Every request body is a Pydantic v2 model; every response is a Pydantic model. No raw `dict` returns. Mirrors `backend/app/models/*` patterns already in use. The validators in those models are how the migrated rule predicates from §5 become enforced.

**P4. Rules stay as defense-in-depth.** Even when every write goes via Admin SDK (which bypasses rules), we keep the rule files updated. M6 tightens them to default-deny everything that's no longer client-readable, so any future regression that re-introduces a client SDK call gets denied immediately rather than silently working in dev and failing in adblock-prod. Rules tests stay green throughout.

**P5. Firestore triggers stay as triggers.** Counters, reaction rollups, search indexing, mention fan-out, photo-upload finalisation — all of these stay in `functions/src/` as Firestore triggers. Their input is a doc write (Firestore is still the system of record); their output is more docs (sometimes) plus a side-channel (FCM push, BigQuery export). The migration does NOT rewrite triggers as router-invoked functions — that would be a much bigger change and would conflate "data plane" with "reactivity plane." Instead, M5 adds a new `realtime` side-channel from triggers to backend SSE clients (§6.5).

**P6. SSE for one-way push, polling SWR for low-frequency reads, request/response for everything else.** §8 defends the SSE choice in detail. The principle is that we don't introduce a third communication style for one specific feature; if the SSE path doesn't fit, polling is the fallback, never a one-off WebSocket.

**P7. No new paid infrastructure in M1-M5.** Redis Pub/Sub, Pub/Sub fan-out, sticky-session load balancers — all out of scope until traffic justifies them. M5 ships a single-instance SSE backend that uses Admin SDK Firestore listeners directly (Firestore SDK works in Python and pushes events server-side; this is exactly what the JS SDK does, except the listener lives in our backend). M5.10 documents the path to multi-instance fanout. See §9 for cost reasoning.

### 3.3 Auth, sessions, cookies

Authentication does not change. Firebase Auth on the frontend issues an ID token; the backend verifies it on every protected request via the existing `get_current_user(authorization: Header)` dep. Custom claims (`admin: true`) continue to gate `require_admin` endpoints exactly as today.

The `jacob-has-profile` cookie does change. Today (`frontend/lib/hooks/useUser.ts:52-56`) the cookie is written from the browser as a side effect of the realtime listener. After M2 the cookie is set by the backend in two places:

* On `POST /api/users/me` (profile create) — server sets `Set-Cookie: jacob-has-profile=1; Path=/; SameSite=Lax; Secure` (Secure conditional on `request.url.scheme == "https"` so dev still works).
* On every `/api/users/me/bootstrap` (called by `app/(authed)/layout.tsx` once per session) — the response sets the cookie if the profile exists, clears it (`Max-Age=0`) if it doesn't.

The middleware does not need to change. It still reads `jacob-has-profile` and redirects on miss. We've just moved who writes it. Because the cookie is set server-side from a real auth-verified profile lookup, it now actually means what it claims to mean — Phase 2 review M12 noted the cookie was a UX cookie, not a security boundary; that's still true, but it's no longer racy.

### 3.4 Where pagination lives

Three current hooks paginate: `useGroupMessages.loadOlder`, `useThreadMessages.loadOlder`, and `useExportStatus` (which is implicitly bounded). Today's pagination uses Firestore `startAfter(QueryDocumentSnapshot)`. After migration:

* The SSE stream is the realtime channel; pagination is independent.
* `GET /api/groups/{gid}/messages?cursor=<opaque>&limit=50` returns top-level messages older than `cursor`. The cursor is a server-minted opaque base64 of `{createdAt, id}`, so the client doesn't have to keep a `QueryDocumentSnapshot` around.
* The hook's contract becomes `({messages, loadOlder, hasMore, loading, loadingOlder})` — same as today.

This is a bigger contract change than it sounds. Today's `useGroupMessages` returns *and refreshes* the same array — when a new message arrives, the array length grows. After M5 the hook merges three sources: (a) a paginated history fetch, (b) the SSE stream, (c) optimistic local writes for messages we sent ourselves. §6.4 covers the merge.

### 3.5 Error contract

Already in place: `backend/app/exceptions.py` raises `APIError(status_code, code, message, details)` and the global handler emits `{error: {code, message, details}}`. The migration uses the same shape. The frontend gets a typed error union via a single `lib/api.ts` client (introduced in M1) so every hook can pattern-match on `error.code` rather than re-parsing strings.

### 3.6 What does NOT change

* The Firebase JS SDK stays installed for **`firebase/auth` and `firebase/storage`** — auth tokens are still minted client-side, and uploads still use signed URLs from `/api/uploads/*` to GCS. Only `firebase/firestore` leaves the bundle.
* Cloud Functions stay as Cloud Functions. They still trigger on Firestore writes; they still write back to Firestore.
* The `firestore/firestore.rules` file stays — it just gets tighter (M6).
* Cloud Run's deployment topology stays. Firebase App Hosting stays.
* Sentry, structured logging, the request-ID middleware, the slowapi rate limiter — all untouched.

---

## 4. Endpoint map

The endpoint map below is the **inventory translated to API**, one row per current Firestore call site. For each endpoint I give: REST shape, request and response Pydantic model names (so M-phases can implement against a clear contract), rate limit, audit-log behaviour, the rules predicate it replaces, and notable failure modes. Implementation is staged by phase (§7) — this section is the contract, not the order.

The endpoint map covers **40 endpoints** total. 11 already exist (they're listed for the inventory mapping; they don't need new code, just new callers). 29 are new — that count drives the per-phase scope estimates.

Naming convention:

* The user's own resources are addressed under `/api/users/me/...`. We never put `{uid}` in a path that the client would have to fill in itself. Server resolves "me" from the verified ID token.
* Group-scoped resources stay under `/api/groups/{gid}/...` and use the existing `_require_leader` and `_require_member` helpers (introduced in M3 — today only `_require_leader` exists inline in `groups.py`).
* Streams live under `/api/streams/...` and are documented in §6.

### 4.1 Stickers (`/api/stickers`)

**4.1.1 `GET /api/stickers` — list stickers**

* Status: NEW (Phase A, M1).
* Auth: `get_current_user`. Stickers are auth-restricted today (`firestore.rules:444-447`). Match the rule.
* Request: query params `?audience=christian|bjj|general` (optional; defaults to all) and `?since=<lastUpdated>` for cache-busting.
* Response: `StickerListResponse` = `{ stickers: list[Sticker], etag: str, expiresAt: datetime }`. `Sticker` mirrors the existing Firestore doc shape: `{slug, name, audience, order, retiredAt, imageUrl}`.
* Rate limit: none. (Read-mostly, cached.)
* Audit log: none.
* Rule predicate replaced: `firestore.rules:444-447` `allow read: if isSignedIn();` — keep auth gate at endpoint level.
* Caching: backend caches the sticker doc list in process for 5 minutes (`functools.lru_cache(maxsize=1)` keyed on `audience`). Frontend hook caches in module-level `Map` like today.
* Failure modes: 401 on missing/invalid token, 503 on Firestore unavailable (return last cached payload + `Cache-Control: stale-if-error=300`).

**4.1.2 `GET /api/stickers/{slug}` — single sticker**

* Status: NEW (M1, optional). Realistically the list endpoint suffices because the frontend never resolves a single sticker by slug independently — every sticker is rendered from the cached list. **Skip unless we find a caller.**

### 4.2 Daily verse (`/api/daily-verse`)

**4.2.1 `GET /api/daily-verse?day=YYYY-MM-DD`**

* Status: NEW (Phase A, M1).
* Auth: `get_current_user`. (`firestore.rules:646` is `allow read: if isSignedIn();`.)
* Request: optional `?day=YYYY-MM-DD` (defaults to today in `America/Los_Angeles`, matching the Cloud Run Job's day key — verify in `backend/app/services/verse.py`).
* Response: `DailyVerseResponse = { day: str, reference: str, text: str, version: str, attribution: str | None }`.
* Rate limit: none.
* Audit log: none.
* Rule predicate replaced: `firestore.rules:646`.
* Failure modes: 404 if today's verse doc hasn't landed yet (Cloud Run Job is daily; client should silently hide the panel on 404).

### 4.3 Users — me (`/api/users/me`)

**4.3.1 `GET /api/users/me/bootstrap`**

* Status: NEW (Phase B, M2). **The cookie-fix endpoint** — see §3.3 and §7.M2.5.
* Auth: `get_current_user`.
* Request: none.
* Response: `BootstrapResponse = { profile: UserProfile | None, hasProfile: bool, claims: { admin: bool }, deletionRequestedAt: datetime | None }`.
* Side effect: `Set-Cookie: jacob-has-profile=1; Path=/; SameSite=Lax; Secure` if `hasProfile`; else `Set-Cookie: jacob-has-profile=; Path=/; Max-Age=0; SameSite=Lax`.
* Rate limit: 60/minute per uid (high; bootstrap is called on every session start).
* Audit log: none.
* Rule predicate replaced: `firestore.rules:71` (`allow read: if isSignedIn();` for self).

**4.3.2 `POST /api/users/me` — create profile**

* Status: NEW (M2).
* Auth: `get_current_user`. Requires the user not to have an existing profile (returns 409 if they do).
* Request: `CreateProfileRequest = { displayName: str (1..100), photoURL: HttpUrl | None (≤500), isMinor: bool }`.
* Response: `UserProfile` plus the cookie set side-effect.
* Rate limit: 5/hour per uid.
* Audit log: yes — `account.create_profile`.
* Rule predicates replaced: `firestore.rules:73-86` — keys allow-list, displayName length, photoURL length, schemaVersion=1, createdAt=request time. Pydantic validators handle all of these.

**4.3.3 `PATCH /api/users/me` — update profile**

* Status: NEW (M2).
* Auth: `get_current_user`, plus `require_not_banned` (new dep — see §5).
* Request: `UpdateProfileRequest = { displayName?: str, photoURL?: HttpUrl | None, isMinor?: bool }` (all optional; only the supplied keys are written).
* Response: `UserProfile`.
* Rate limit: 30/hour per uid.
* Audit log: yes — `account.update_profile`, payload `{changedKeys: [...]}`.
* Rule predicates replaced: `firestore.rules:91-100` — `changedKeys().hasOnly([...])` becomes Pydantic field-presence; ban check becomes the dep.

**4.3.4 `GET /api/users/me/private`**

* Status: NEW (M2). Not strictly used by the frontend today (no hook reads `users/{uid}/private/profile`) — stub it but defer the body until M2.
* Auth: owner-only (`get_current_user`, uid resolves to self).
* Use case: settings page may want to display server-stored email + login methods later. **DESIGN-OPEN: defer to M2 evaluation; cut from scope if no consumer.**

### 4.4 Notification preferences (`/api/users/me/notification-prefs`)

**4.4.1 `GET /api/users/me/notification-prefs`**

* Status: NEW (M2).
* Auth: `get_current_user`.
* Request: none.
* Response: `NotificationPrefs = { mentions: bool, replies: bool, announcements: bool, digest: bool, schemaVersion: int }`. If no doc exists, returns the defaults inferred from `firestore.rules:155-165`.
* Rate limit: none.
* Rule predicate replaced: `firestore.rules:156` — `allow read: if isUser(uid);`.

**4.4.2 `PUT /api/users/me/notification-prefs`**

* Status: NEW (M2).
* Auth: `get_current_user` + `require_not_banned`.
* Request: `NotificationPrefs` (entire doc, since the rule allows full overwrite of these specific keys).
* Response: stored `NotificationPrefs`.
* Rate limit: 30/hour per uid.
* Audit log: no (low-value mutation).
* Rule predicates replaced: `firestore.rules:157-164` — keys allow-list and types via Pydantic.

### 4.5 FCM device registration (`/api/users/me/devices`)

**4.5.1 `POST /api/users/me/devices`**

* Status: NEW (M2). Replaces `frontend/lib/push.ts` direct `setDoc`.
* Auth: `get_current_user`.
* Request: `RegisterDeviceRequest = { fcmToken: str (≤4096), platform: Literal["web","ios","android"], userAgent: str (≤256), appVersion: str | None }`.
* Response: `DeviceResponse = { deviceId: str, registeredAt: datetime }`.
* Rate limit: 20/hour per uid (clients usually register once; allow re-register on token rotation).
* Audit log: no.
* Rule predicates replaced: `firestore.rules:140-152`.
* Side effects: Backend writes `users/{uid}/devices/{deviceId}` with `lastSeenAt: server time`. Backend deduplicates on `fcmToken` — if the same token already exists for this uid, returns the existing deviceId rather than creating a duplicate. (Today's client rule allows duplicates; the backend gets to be smarter.)

**4.5.2 `DELETE /api/users/me/devices/{deviceId}`**

* Status: NEW (M2). For "log out of all devices" flow + future device list UI.
* Auth: `get_current_user`. Owner-only.
* Rate limit: none.
* Audit log: no.
* Rule predicates replaced: `firestore.rules:151`.

### 4.6 Mutes (`/api/users/me/mutes`)

**4.6.1 `GET /api/users/me/mutes`**

* Status: NEW (M2 read; M4 write).
* Auth: `get_current_user`.
* Request: none.
* Response: `MutesResponse = { mutedUids: list[str] }`.
* Rate limit: 60/minute per uid (consulted on chat render — high read frequency).
* Caching: response is stable and small; ETag based on max(`mutedAt`).
* Rule predicate replaced: `firestore.rules:119`.

**4.6.2 `POST /api/users/me/mutes/{otherUid}`**

* Status: NEW (M4).
* Auth: `get_current_user` + `require_not_banned`.
* Request: empty body. Path param `otherUid` must `!= self`.
* Response: `MuteResponse = { uid: str, mutedAt: datetime }`.
* Rate limit: 30/minute per uid.
* Audit log: no (per-user privacy actions don't go to audit log; they could go to a separate `user_actions` collection if we want).
* Rule predicates replaced: `firestore.rules:120-123`.

**4.6.3 `DELETE /api/users/me/mutes/{otherUid}`**

* Status: NEW (M4).
* Auth: `get_current_user` (note: rule allows unmute even when banned — `firestore.rules:124`).
* Rate limit: 30/minute per uid.

### 4.7 Blocks (`/api/users/me/blocks`)

Mirror structure of mutes. Three endpoints: `GET`, `POST /{otherUid}`, `DELETE /{otherUid}`. Same Pydantic shape and validators. Rule predicates: `firestore.rules:128-136`. All move in M2 (read) / M4 (write).

### 4.8 Notifications (`/api/users/me/notifications`)

**4.8.1 `GET /api/users/me/notifications`**

* Status: NEW (M2). The frontend doesn't currently pull this collection, but the bell icon will once `useNotifications` is built — see Phase 2 review for context.
* Auth: `get_current_user`.
* Request: query `?cursor=<opaque>&limit=50&unreadOnly=true|false`.
* Response: `NotificationsListResponse = { items: list[Notification], nextCursor: str | None }`.
* Rate limit: 60/minute per uid.
* Rule predicate replaced: `firestore.rules:654`.

**4.8.2 `POST /api/users/me/notifications/{nid}/read`**

* Status: NEW (M4).
* Auth: `get_current_user`.
* Idempotent: setting `readAt` on an already-read notification is a no-op (return 200 with the existing doc).
* Rule predicates replaced: `firestore.rules:655-658` — `onlyChanges(['readAt'])`, `readAt == request.time`, `resource.data.readAt == null` for first-time-only. Backend transactionally enforces the last predicate.

### 4.9 Account deletion exports (`/api/account/*`)

Already exists per `backend/app/routers/account.py`. The `useExportStatus` and `useDeletionStatus` hooks today read `users/{uid}/exports/...` and `users/{uid}.deletionRequestedAt` directly. After M2 they switch to:

* `GET /api/account/delete/status` (already exists, returns `{ deletionRequestedAt, deletionScheduledFor, ... }`).
* `GET /api/account/export/status` (already exists, returns latest 5 jobs).

No new endpoints. Just switch the hook callers in M2.

### 4.10 Groups — read (`/api/groups`)

**4.10.1 `GET /api/users/me/groups`**

* Status: NEW (M3). Replaces `useGroups`'s `collectionGroup("members") where uid == me` query.
* Auth: `get_current_user`.
* Request: query `?archived=include|exclude` (default exclude).
* Response: `MyGroupsResponse = { groups: list[GroupSummary] }` where `GroupSummary = { gid, name, description, avatarUrl, isPrivate, archivedAt, role: Literal["member","leader"], joinedAt, memberCount, lastMessageAt: datetime | None }`.
* Rate limit: 30/minute per uid.
* Backend implementation: runs the existing CG query with the existing index. Joins each membership doc against the group doc with a single `getAll([...refs])` Admin SDK call.
* Rule predicate replaced: `firestore.rules:438-441` (collection-group `members` read).

**4.10.2 `GET /api/groups/{gid}`**

* Status: NEW (M3). Replaces `useGroup`.
* Auth: `get_current_user` + `require_member_or_public(gid)` (new dep — see §5.6).
* Response: `GroupDetail = { gid, name, description, isPrivate, joinMode, audience, stickerSet, avatarUrl, archivedAt, archivedBy, archiveReason, pinnedMessageIds: list[str], memberCount, leaderCount, founderUid, createdBy, createdAt }`.
* Rate limit: 60/minute per uid.
* Rule predicate replaced: `firestore.rules:174-175`.

**4.10.3 `GET /api/groups/{gid}/me`**

* Status: NEW (M3). Replaces the per-page "is the current user a leader?" Firestore reads in `chat/page.tsx`, `settings/page.tsx`, `analytics/page.tsx`.
* Auth: `get_current_user` + `require_member(gid)`.
* Response: `MyMembership = { gid, uid, role, joinedAt }`.
* Rate limit: 60/minute per uid.

**4.10.4 `GET /api/groups/{gid}/members`**

* Status: NEW (M3). Replaces `useMembers` and the members page.
* Auth: `get_current_user` + `require_member(gid)`.
* Response: `MembersListResponse = { members: list[Member] }` where `Member = { uid, role, joinedAt, displayName, photoURL }` (display name and avatar joined from `users/{uid}` server-side).
* Rate limit: 60/minute per uid.
* Pagination: limit 200 (member count is bounded by group size, usually < 50); over 200 we paginate via `?cursor=` (cursor = last `joinedAt`).
* Rule predicate replaced: `firestore.rules:261`.

**4.10.5 `GET /api/groups/{gid}/pinned-messages`**

* Status: NEW (M3). The frontend reads `groups/{gid}.pinnedMessageIds` then fetches each message individually. Move both to one endpoint.
* Auth: `get_current_user` + `require_member(gid)`.
* Response: `PinnedMessagesResponse = { messages: list[Message] }` (full message doc shape, in pinned order).
* Rate limit: 60/minute per uid.
* Implementation: `getAll([...pinnedMessageIds map to refs])` — single Admin SDK call.

**4.10.6 `GET /api/groups/{gid}/invites`**

* Already exists at `backend/app/routers/invites.py:85`. M3 just switches `useInvites` to call it.

### 4.11 Groups — write (`/api/groups`)

**4.11.1 `PATCH /api/groups/{gid}`**

* Status: NEW (M4). Replaces `GroupSettingsForm` and `GroupAvatarUpload`'s direct `updateDoc` calls.
* Auth: `get_current_user` + `require_leader(gid)` + `require_not_banned`.
* Request: `UpdateGroupRequest = { name?: str (1..100), description?: str (≤500) | None, isPrivate?: bool, joinMode?: Literal["open","request","invite"], stickerSet?: str, avatarUrl?: HttpUrl (must match GCS public bucket) | None, pinnedMessageIds?: list[str] (≤5) }`.
* Response: `GroupDetail`.
* Rate limit: 30/minute per leader.
* Audit log: yes — `group.update`, `payload = {changedKeys: [...]}`.
* Rule predicates replaced: `firestore.rules:217-247`. The `archivedAt` transitions remain on the dedicated `/archive` and `/unarchive` endpoints; this endpoint refuses to touch `archivedAt` (returns 422 if supplied).
* Implementation note: pinned-message validation requires verifying each id exists in `groups/{gid}/messages` before write. Add a helper `validate_pinned_messages_exist(db, gid, ids)` that runs a single `getAll` and 422s on any miss.

(Existing endpoints `POST /api/groups`, `POST /api/groups/join`, `POST /api/groups/{gid}/invite/rotate`, leadership endpoints, archive/unarchive, announce, moderation policy stay as-is. Their request/response shapes already match the Pydantic-in-Pydantic-out pattern.)

### 4.12 Messages — read (`/api/groups/{gid}/messages`)

**4.12.1 `GET /api/groups/{gid}/messages`**

* Status: NEW (M3 read; M5 SSE-augmented).
* Auth: `get_current_user` + `require_member_or_public_top_level(gid)` — public-group non-members can read top-level non-deleted non-hidden messages (`firestore.rules:314-320`).
* Request: query `?cursor=<opaque>&limit=50&parentMessageId=<mid|null>`. If `parentMessageId` omitted, returns top-level (matches `useGroupMessages`); if set, returns thread replies (matches `useThreadMessages`).
* Response: `MessagesListResponse = { messages: list[Message], nextCursor: str | None }`.
* `Message` shape: every field today's frontend uses — `{id, authorUid, body, stickerIds, mediaRefs, mentions, parentMessageId, threadReplyCount, createdAt, editedAt, deletedAt, announcedAt, announcedBy, reactionCounts, moderation, repostOfThread}`. PII (e.g. `participants`) NOT included in the response.
* Rate limit: 60/minute per uid (high — pagination scrollback).
* Server filtering: hidden messages (`moderation.state == "hidden"`) are returned to the **author** only, with the body redacted. To everyone else they're omitted entirely. (This is stricter than the current rule, which allows the author to see their own hidden messages via the SDK; the backend can do the same with cleaner UX — see §6.3.)
* Pagination cursor: opaque base64 of `{createdAt: int_microseconds, id: str}`. Server signs it with HMAC over `JACOB_CURSOR_SECRET` so clients can't forge a cursor pointing into another group.
* Rule predicates replaced: `firestore.rules:314-320`.

**4.12.2 `GET /api/groups/{gid}/messages/{mid}`**

* Status: NEW (M3). Single-message fetch, used for pinned-message resolution and for permalink rendering.
* Auth: `get_current_user` + `require_member(gid)`.
* Response: `Message`.

### 4.13 Messages — write (`/api/groups/{gid}/messages`)

**4.13.1 `POST /api/groups/{gid}/messages`**

* Status: NEW (M4). Replaces `MessageInput` and `ThreadReplyInput` `addDoc`.
* Auth: `get_current_user` + `require_member(gid)` + `require_not_banned` + `require_not_archived(gid)`.
* Request: `CreateMessageRequest = { body: str (1..4000), stickerIds: list[str] (≤5), mediaRefs: list[HttpUrl] (≤4, each matching GCS public bucket), parentMessageId: str | None, mentions: list[str] (≤10), repostOfThread: str | None }`.
* Response: `Message`.
* Rate limit: 60/minute per uid; 600/hour per uid (T17 caps).
* Audit log: no (chat is high-volume; audit goes via Firestore triggers if needed).
* Side effects: writes the message doc with server timestamp; trigger `onMessageWrite` fires for counter updates and thread fan-out.
* Rule predicates replaced: `firestore.rules:323-347` — keys allow-list, types, lengths via Pydantic; archived check via dep; parent-exists check inline (`db.collection("groups").document(gid).collection("messages").document(parent_mid).get().exists`).
* SSE fanout: after the write commits, push to the group's SSE bus (§6.5). This is the M5 work; M4 ships without SSE and the frontend re-fetches on reload.

**4.13.2 `PATCH /api/groups/{gid}/messages/{mid}`**

* Status: NEW (M4).
* Auth: `get_current_user` + `require_member(gid)` + `require_not_banned`.
* Request: `EditMessageRequest = { body: str (1..4000) }`. Editing only the body; `editedAt` is server-set.
* Response: `Message`.
* Rate limit: 30/hour per uid.
* Audit log: no.
* Rule predicates replaced: `firestore.rules:353-357` — author check + 15-minute window. Backend computes `request.time - resource.createdAt < 15m` server-side; returns 409 `edit_window_expired` past the window.

**4.13.3 `DELETE /api/groups/{gid}/messages/{mid}` — soft-delete**

* Status: NEW (M4).
* Auth: `get_current_user` + `require_member(gid)` + `require_not_banned` + author-or-leader.
* Request: empty.
* Response: `Message` (with `deletedAt` set; body redacted to empty string).
* Rate limit: 60/hour per uid.
* Audit log: yes — `message.delete`, `payload = {gid, mid, deleter_role}`.
* Rule predicates replaced: `firestore.rules:358-361`.

(Existing endpoint `POST /api/groups/{gid}/messages/{mid}/announce` stays as-is.)

### 4.14 Reactions (`/api/groups/{gid}/messages/{mid}/reactions`)

**4.14.1 `POST /api/groups/{gid}/messages/{mid}/reactions/{slug}`**

* Status: NEW (M4). Replaces `useReactions.react`.
* Auth: `get_current_user` + `require_member(gid)` + `require_not_banned` + `require_not_archived(gid)`.
* Validation: `require_message_not_deleted(gid, mid)`, `require_sticker_exists(slug)`.
* Request: empty.
* Response: `ReactionResponse = { uid, slug, reactedAt, reactionCounts }` (full reaction-counts map for the message returned for client merge).
* Rate limit: 120/minute per uid (reaction toggling is rapid).
* Audit log: no.
* Rule predicates replaced: `firestore.rules:406-412`.

**4.14.2 `DELETE /api/groups/{gid}/messages/{mid}/reactions/{slug}`**

* Status: NEW (M4). Replaces `useReactions.unreact`.
* Auth: `get_current_user` + `require_not_banned`.
* Response: `{ reactionCounts: dict }`.
* Rate limit: 120/minute per uid.

### 4.15 Boards (`/api/boards`)

The `boards` router already exists (`backend/app/routers/boards.py`). It currently only has admin endpoints (create, archive). The migration adds:

**4.15.1 `GET /api/boards`** — list boards. Already at `backend/app/routers/boards.py:58`. M3: switch `useBoards` to it.

**4.15.2 `GET /api/boards/{boardId}/posts`**

* Status: NEW (M3).
* Auth: `get_current_user`.
* Request: `?cursor=&limit=50`.
* Response: `BoardPostsResponse = { posts: list[BoardPost], nextCursor: str | None }`. `BoardPost` field shape per inventory §2.2.
* Rate limit: 60/minute per uid.
* Server filters: deleted and hidden posts excluded (except for author); pinned posts ordered first, then by createdAt desc — matches today's client query.

**4.15.3 `GET /api/boards/{boardId}/posts/{postId}`** — single post (NEW, M3).

**4.15.4 `GET /api/boards/{boardId}/posts/{postId}/replies`** — replies list (NEW, M3, paginated, default `orderBy createdAt asc`).

**4.15.5 `POST /api/boards/{boardId}/posts`**

* Status: NEW (M4).
* Auth: `get_current_user` + `require_not_banned` + `require_board_not_archived(boardId)`.
* Request: `CreateBoardPostRequest = { body: str (1..4000), stickerIds: list[str] (1..5) — REQUIRED ≥1 per rules, mediaRefs: list (≤4), mentions: list (≤10) }`.
* Response: `BoardPost`.
* Rate limit: 30/hour per uid; 200/day per uid.
* Audit log: no.
* Rule predicates replaced: `firestore.rules:476-505` — keys, sticker required, types and lengths.

**4.15.6 `PATCH /api/boards/{boardId}/posts/{postId}`** — edit body (15-minute window).
**4.15.7 `DELETE /api/boards/{boardId}/posts/{postId}`** — soft-delete (author or admin).
**4.15.8 `POST /api/boards/{boardId}/posts/{postId}/pin`** — admin-only pin.
**4.15.9 `DELETE /api/boards/{boardId}/posts/{postId}/pin`** — admin-only unpin.

(Pin/unpin replace the rule's update path at `firestore.rules:523-532`.)

**4.15.10 `POST /api/boards/{boardId}/posts/{postId}/replies`** — create reply.
**4.15.11 `PATCH /api/boards/{boardId}/posts/{postId}/replies/{replyId}`** — edit reply.
**4.15.12 `DELETE /api/boards/{boardId}/posts/{postId}/replies/{replyId}`** — soft-delete reply.

**4.15.13 `POST /api/boards/{boardId}/posts/{postId}/reactions/{slug}`** — board post reaction (mirror of 4.14.1).
**4.15.14 `DELETE /api/boards/{boardId}/posts/{postId}/reactions/{slug}`** — board post unreaction.

### 4.16 Streams (`/api/streams`)

Designed in §6 in detail. Endpoints:

**4.16.1 `GET /api/streams/groups/{gid}` (SSE)**

* Status: NEW (M5).
* Auth: `get_current_user` + `require_member(gid)`. **Important:** SSE auth must use the bearer token from a custom `Authorization` header passed via fetch + `EventSource`-compat shim, because `EventSource` doesn't support custom headers natively. See §6.1.
* Content-Type: `text/event-stream`.
* Events: `message.created`, `message.updated`, `message.deleted`, `reaction.added`, `reaction.removed`, `pin.changed`, `archive.changed`, `member.changed`, `presence.heartbeat` (server keeps connection alive).
* Reconnect: client sends `Last-Event-ID` header on reconnect; server replays missed events.
* Idle timeout: 5 minutes of no events → server sends a `heartbeat` event so connection stays open through proxies.

**4.16.2 `GET /api/streams/notifications` (SSE)**

* Status: NEW (M5).
* Auth: `get_current_user`.
* Events: `notification.created`.
* Per-user; cardinality is small; fanout is single-target.

**4.16.3 `GET /api/streams/boards/{boardId}` (SSE) — DESIGN-OPEN**

* Status: deferred to post-M5. Boards are far less hot than chat; polling at 60s is probably fine. **Decide in M5 retro.**

### 4.17 Search, discover, analytics, reports, uploads, admin

Already API-mediated. No changes.

### 4.18 Endpoint count summary

| Phase | New endpoints | Existing endpoints reused | Notes |
|---|---|---|---|
| M1 (Phase A) | 2 (`stickers`, `daily-verse`) | 0 | pilot |
| M2 (Phase B) | 8 (`bootstrap`, `me` create/patch, `notification-prefs` get/put, `devices` post/delete, `notifications` list) | 2 (`account/delete/status`, `account/export/status`) | + cookie middleware |
| M3 (Phase C reads) | 8 (`my-groups`, `groups/{gid}`, `groups/{gid}/me`, `groups/{gid}/members`, `groups/{gid}/pinned-messages`, `messages` list, `messages/{mid}`, board reads) | 1 (`groups/{gid}/invites`) | |
| M4 (Phase D writes) | 11 (group patch, message create/edit/delete, reactions × 2, board post create/edit/delete + reply × 3 + reaction × 2 + pin × 2, mute/block writes) | 0 | |
| M5 (Phase E SSE) | 2 (`streams/groups/{gid}`, `streams/notifications`) | 0 | |
| M6 (Phase F cleanup) | 0 | n/a | rules tightening only |
| **Total NEW** | **31** | **3 reused** | |

(The 31 vs the 29 quoted in §1 is the addition of two stream endpoints + minor decompositions; the inventory is the source of truth, not the count.)

---

## 5. Rules → route-guard migration

The `firestore.rules` file (685 lines, `firestore/firestore.rules`) is the current source of truth for who can do what. Once the Admin SDK does the writes, rules don't get evaluated. Every non-trivial predicate has to move into a backend guard. This section enumerates them and maps each to its new home.

### 5.1 Approach

Each predicate becomes one of:

* **A FastAPI dependency** — for cross-cutting checks like membership, leadership, ban status. Returns the resolved resource (group doc, member doc) so the handler doesn't re-read.
* **A Pydantic field validator** — for shape and length checks.
* **An inline check in the handler** — for state-machine transitions (15-minute edit window, archive transitions, soft-delete idempotency).

The standard Phase 1 error shape applies: `403 forbidden` for authz misses, `409 conflict` for state-machine misses, `422 unprocessable` for shape misses, `429 too_many_requests` for rate-limit misses.

### 5.2 New FastAPI dependencies

Three new deps live in `backend/app/deps.py`. None of them currently exist.

```python
# backend/app/deps.py (new content for M2-M3)

async def require_not_banned(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """
    Predicate replaces firestore.rules `notBanned()` (lines 26-28).
    Active ban: `bans/{uid}` doc exists and `expiresAt > now`.
    Returns the same CurrentUser; raises APIError 403 banned.
    """
    db = _db()
    snap = db.collection("bans").document(user.uid).get()
    if not snap.exists:
        return user
    expires = snap.to_dict().get("expiresAt")
    if expires and expires > datetime.now(timezone.utc):
        raise APIError(
            status_code=403,
            code="banned",
            message="Account is banned.",
            details={"expiresAt": expires.isoformat()},
        )
    return user


async def require_member(
    gid: str,
    user: CurrentUser = Depends(get_current_user),
) -> MembershipContext:
    """
    Predicate replaces firestore.rules `isGroupMember(gid)` (lines 30-33).
    Returns a MembershipContext = { gid, uid, role, group_doc }.
    Raises APIError 403 not_a_member if the member doc doesn't exist.
    Raises APIError 404 group_not_found if the group doesn't exist.
    """
    db = _db()
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)
    group_snap, member_snap = await asyncio.gather(
        _async_get(group_ref), _async_get(member_ref),
    )
    if not group_snap.exists:
        raise APIError(404, "group_not_found", "Group not found.")
    if not member_snap.exists:
        raise APIError(403, "not_a_member", "Not a member of this group.")
    return MembershipContext(
        gid=gid, uid=user.uid,
        role=member_snap.get("role"),
        group=GroupDoc.from_snapshot(group_snap),
    )


async def require_leader(
    gid: str,
    membership: MembershipContext = Depends(require_member),
) -> MembershipContext:
    """
    Predicate replaces firestore.rules `isGroupLeader(gid)` (lines 35-38).
    Reuses the membership read from require_member — saves one Admin SDK round-trip.
    """
    if membership.role != "leader":
        raise APIError(403, "not_a_leader", "Not a leader of this group.")
    return membership


async def require_member_or_public_top_level(
    gid: str,
    user: CurrentUser = Depends(get_current_user),
) -> MembershipContext | PublicReadContext:
    """
    Predicate replaces firestore.rules:174-175 + :314-320 OR-branch.
    If the user is a member, returns MembershipContext.
    If the group is public and non-archived, returns a PublicReadContext
    that the messages handler uses to filter to top-level non-hidden non-deleted.
    Raises 403 if neither.
    """
    db = _db()
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)
    group_snap, member_snap = await asyncio.gather(
        _async_get(group_ref), _async_get(member_ref),
    )
    if not group_snap.exists:
        raise APIError(404, "group_not_found", "Group not found.")
    if member_snap.exists:
        return MembershipContext(...)
    if not group_snap.get("isPrivate"):
        return PublicReadContext(gid=gid, group=GroupDoc.from_snapshot(group_snap))
    raise APIError(403, "not_a_member", "Not a member of this group.")
```

The transformation of the rules helpers is mechanical. Three things to note:

1. The deps are `async`. The rest of the codebase is sync FastAPI (`backend/app/routers/groups.py` uses sync functions). M3 will need to either bridge sync handlers to async deps via `run_in_threadpool` (FastAPI does this automatically for sync deps) or convert the handlers. The simpler path is **keep sync everywhere** — Firestore Admin SDK is synchronous in Python anyway, and `asyncio.gather` over two sync reads buys little. **Preference: keep sync; the snippet above is illustrative.**
2. `MembershipContext` carries the group doc forward so handlers don't re-read it. This is a meaningful optimisation for the announce / archive / message-create paths that today re-read the group doc multiple times.
3. `require_not_banned` is composed with `require_member` / `require_leader` per-route — not as a global dep — because some endpoints (notably mute/block delete and the `/api/streams/*` reads) intentionally allow banned users.

### 5.3 Per-rule mapping table

Each row maps one predicate clause to its new home. "Origin" is `firestore.rules:LINENO`. "Destination" is the backend file or Pydantic class that owns it.

| Origin | Predicate | Destination | Notes |
|---|---|---|---|
| `firestore.rules:12-14` | `isSignedIn()` | `deps.get_current_user` (existing) | unchanged |
| `firestore.rules:16-18` | `isUser(uid)` | implicit via path being `/users/me/*` | server resolves `me` from token |
| `firestore.rules:20-28` | `isBanned()` / `notBanned()` | `deps.require_not_banned` (NEW, §5.2) | reads `bans/{uid}.expiresAt > now` |
| `firestore.rules:30-33` | `isGroupMember(gid)` | `deps.require_member` (NEW, §5.2) | |
| `firestore.rules:35-38` | `isGroupLeader(gid)` | `deps.require_leader` (NEW, §5.2) | |
| `firestore.rules:40-46` | `changedKeys() / onlyChanges(...)` | Pydantic — only-supplied-keys is the natural shape; explicit `model_config = {"extra": "forbid"}` enforces "no extra keys" | |
| `firestore.rules:48-50` | `messageExists(gid, mid)` | inline check in `messages.create` handler | one Admin SDK get |
| `firestore.rules:52-60` | `validMediaRefs(refs)` | Pydantic field validator on `mediaRefs: list[GcsPublicUrl]` | regex `^https://storage\.googleapis\.com/jacob-media-public-.*` |
| **users** | | | |
| `:71` | `read: if isSignedIn()` | endpoint auth dep | M2 |
| `:73-86` | user create predicates | `CreateProfileRequest` Pydantic | M2 |
| `:91-100` | user update predicates | `UpdateProfileRequest` + `require_not_banned` | M2 |
| `:103` | `delete: if false` | no DELETE endpoint | client never deletes; deletion is `POST /api/account/delete` |
| `:108-111` | private/profile owner-only | endpoint owner-resolved-from-token | M2 |
| `:118-126` | mutes shape + ban + self-exclude | `MuteRequest` + handler `if other == self: 422` + `require_not_banned` on POST | M4 |
| `:128-136` | blocks (mirror of mutes) | same as mutes | M4 |
| `:140-152` | devices keys + types + length | `RegisterDeviceRequest` Pydantic | M2 |
| `:155-165` | notification prefs keys + types | `NotificationPrefs` Pydantic with `extra=forbid` | M2 |
| **groups** | | | |
| `:174-175` | read: member or public | `require_member_or_public` dep | M3 |
| `:184-208` | group create predicates | `CreateGroupRequest` (already exists in `models/`) — verify it covers all keys; Pydantic validator for `name`, `inviteCode`, `pinnedMessageIds == []` on create | already-server-side; M3 verifies |
| `:217-247` | group update predicates | `UpdateGroupRequest` + `require_leader` + `require_not_banned` + state-machine validators for `archivedAt` | M4; archived-at transitions stay on the dedicated archive/unarchive endpoints |
| `:249` | `delete: if false` | no DELETE endpoint | groups archive, never delete |
| `:261` | `members read` | `GET /api/groups/{gid}/members` + dep | M3 |
| `:268-278` | members create — bootstrap or leader-add | already in `POST /api/groups` (bootstrap) and a future leader-add endpoint | M3+M4 |
| `:285` | `members update: false` | no PATCH endpoint | leader-promote/demote endpoints already exist |
| `:296-306` | members delete + leaderless guard | already in `POST /api/groups/{gid}/members/{uid}/remove` (verify exists; if not, add in M4) | M4 |
| **messages** | | | |
| `:314-320` | message read (member or public top-level) | `require_member_or_public_top_level` dep + handler filter | M3 |
| `:323-347` | message create predicates | `CreateMessageRequest` + `require_member` + `require_not_banned` + `require_not_archived` + parent-exists check | M4 |
| `:353-368` | message update — three branches (edit / soft-delete / announce) | three endpoints: `PATCH` (edit), `DELETE` (soft-delete), `POST /announce` (already exists) | M4 |
| `:371` | `delete: if false` | no DELETE endpoint that hard-deletes; soft-delete via PATCH | M4 |
| **joinRequests** | | | already on backend per `routers/discover.py` |
| **reactions** | | | |
| `:404-412` | reactions create — sticker exists, group not archived, message not deleted, shape | `POST /api/groups/{gid}/messages/{mid}/reactions/{slug}` + `require_member` + `require_not_banned` + `require_not_archived` + `require_message_not_deleted` (NEW dep) + `require_sticker_exists` (NEW dep) | M4 |
| `:414` | reactions delete — owner + not banned | endpoint + `require_not_banned` | M4 |
| **collection-group members** | | | |
| `:438-441` | CG read filtered to own uid | `GET /api/users/me/groups` | M3 |
| **stickers** | | | |
| `:444-447` | read: if isSignedIn() | `GET /api/stickers` + auth dep | M1 |
| **boards** | | | |
| `:458-460` | board read — non-archived or admin | `GET /api/boards` filter | M3 |
| `:468-474` | post read — author/admin/non-deleted-non-hidden | `GET /api/boards/{bid}/posts` filter | M3 |
| `:476-505` | post create | `CreateBoardPostRequest` Pydantic + `require_not_banned` + `require_board_not_archived` | M4 |
| `:507-533` | post update — three branches | three endpoints: PATCH (edit), DELETE (soft-delete), POST /pin (admin) | M4 |
| `:539-545` | reply read | filter | M3 |
| `:547-566` | reply create | mirror of post create | M4 |
| `:568-581` | reply update | mirror of post update | M4 |
| `:587-603` | reactions on board posts | mirror of group reactions | M4 |
| **backend-only** | | | |
| `:609-611` | moderation_queue: `false` | unchanged — admin endpoints | |
| `:612-614` | bans: `false` | unchanged — admin endpoints | |
| `:615-617` | audit_log: `false` | unchanged | |
| `:622-624` | inviteCodes: `false` | unchanged | |
| `:629-631` | uploads: `false` | unchanged | |
| `:637-640` | invites: leader read, no client write | `GET /api/groups/{gid}/invites` (already exists) — no changes | |
| `:646` | daily_verse: read if signedIn | `GET /api/daily-verse` | M1 |
| `:653-660` | notifications: owner read + readAt update | endpoints in §4.8 | M2/M4 |
| `:670-674` | exports: owner read | `GET /api/account/export/status` (already exists) | M2 switch caller |
| `:681-683` | default-deny | unchanged | |

### 5.4 Cross-doc lookups (the gnarly ones)

The Phase 2 review explicitly enumerated these. The backend implementation needs to reproduce them with Admin SDK calls. The table below pairs each lookup with the dep / handler that performs it.

| Cross-doc lookup | Used in | Where it lives now |
|---|---|---|
| `bans/{auth.uid}` (active ban check) | every write predicate | `require_not_banned` (§5.2) — single Admin SDK get per request |
| `groups/{gid}/members/{auth.uid}` exists | `isGroupMember(gid)` everywhere | `require_member` (§5.2) — joined with the group read in one `getAll` |
| `groups/{gid}/members/{auth.uid}.role == 'leader'` | `isGroupLeader(gid)` | `require_leader` (§5.2) — uses the same read |
| `groups/{gid}.createdBy == auth.uid` | members create bootstrap path | already inside `POST /api/groups` handler |
| `groups/{gid}.leaderCount > 1` | members delete leaderless guard | inside `members.remove` handler — read group doc, check `leaderCount` after the demotion would land. **Important:** Phase 2 review H3 noted this is non-transactional today; the backend should run the read-and-write inside `db.transaction()` to close that race. M4 fixes it. |
| `groups/{gid}.archivedAt == null` | message create + reaction create + announce | `require_not_archived(gid)` dep — uses the group doc already loaded by `require_member`. **No additional read.** |
| `groups/{gid}/messages/{parentMessageId}` exists | message create thread reply | inline `db.collection("groups").document(gid).collection("messages").document(parent_mid).get().exists` |
| `groups/{gid}/messages/{mid}.deletedAt == null` | reaction create | `require_message_not_deleted(gid, mid)` dep |
| `stickers/{slug}` exists | reaction create | `require_sticker_exists(slug)` dep — backed by the in-process sticker cache from §4.1.1 |
| `boards/{boardId}.archivedAt == null` | board post create + reply create + reaction create | `require_board_not_archived(boardId)` dep |
| `boards/{boardId}/posts/{postId}.deletedAt == null` | board reaction create | inline check |
| `boards/{boardId}/posts/{postId}.moderation.state != 'hidden'` | board reaction read | inline check |

### 5.5 Predicates that don't migrate (and stay in rules)

Three rule blocks intentionally stay enforced by Firestore even after the migration, because the Admin SDK never writes to them and we want a defense-in-depth wall:

* `match /moderation_queue/{itemId} { allow read, write: if false; }` — backend-only collection.
* `match /audit_log/{eventId} { allow read, write: if false; }` — backend-only collection.
* `match /bans/{uid} { allow read, write: if false; }` — admin-only collection.

These are unchanged. M6 may *tighten* the read predicates on collections that the client used to read — for example, `groups/{gid}` becomes `allow read: if false;` once the frontend never reads it directly. That's the M6 cleanup work.

### 5.6 New Pydantic field validators (catalogued)

Validators are split between built-in Pydantic constraints (`min_length`, `max_length`, `pattern`) and custom validators. The table is the per-field spec for the Pydantic models declared in §4.

| Field | Constraint | Pydantic shape |
|---|---|---|
| `displayName` | str, 1..100 | `Annotated[str, StringConstraints(min_length=1, max_length=100)]` |
| `photoURL` | URL ≤500 chars or None | `HttpUrl \| None` with `@field_validator` enforcing `len(str(v)) <= 500` |
| `body` (message + post + reply) | str, 1..4000 | `Annotated[str, StringConstraints(min_length=1, max_length=4000)]` |
| `stickerIds` | list, ≤5 (≥1 for board posts) | `Annotated[list[str], Field(max_length=5)]`; board posts override with `min_length=1` |
| `mediaRefs` | list, ≤4, each matching GCS bucket | `Annotated[list[GcsPublicUrl], Field(max_length=4)]` where `GcsPublicUrl = Annotated[str, StringConstraints(pattern=r"^https://storage\.googleapis\.com/jacob-media-public-.*")]` |
| `mentions` | list, ≤10 | `Annotated[list[str], Field(max_length=10)]` |
| `inviteCode` | str, ≥6 (≥12 per Phase 2 C3 fix) | `Annotated[str, StringConstraints(min_length=12)]` — **bump from rules-min 6 to 12 in M4 to fix Phase 2 C3** |
| `name` (group) | str, 1..100 | as displayName |
| `description` (group) | str, ≤500, optional | `Annotated[str, StringConstraints(max_length=500)] \| None` |
| `pinnedMessageIds` | list, ≤5 | `Annotated[list[str], Field(max_length=5)]` |
| `parentMessageId` | str or None | `str \| None` |
| `fcmToken` | str, ≤4096 | `Annotated[str, StringConstraints(max_length=4096)]` |
| `platform` | enum | `Literal["web","ios","android"]` |
| `isMinor` | bool | `bool` |

`extra: forbid` is set on **every** request model so the rules' `keys().hasOnly([...])` predicate is enforced at the Pydantic layer.

### 5.7 State-machine guards (inline handler logic)

Three transitions can't be expressed as simple deps because they depend on the resource's prior state. Each becomes an inline check inside a transactional handler.

**5.7.1 15-minute message edit window**

```python
# backend/app/routers/messages.py (M4)

@router.patch("/{gid}/messages/{mid}")
def edit_message(...):
    ref = db.collection("groups").document(gid).collection("messages").document(mid)

    @firestore.transactional
    def _txn(txn):
        snap = ref.get(transaction=txn)
        if not snap.exists:
            raise APIError(404, "message_not_found", "Message not found.")
        data = snap.to_dict()
        if data["authorUid"] != user.uid:
            raise APIError(403, "not_author", "Not the author.")
        if data.get("deletedAt"):
            raise APIError(409, "deleted", "Cannot edit deleted message.")
        created = data["createdAt"]
        if datetime.now(timezone.utc) - created > timedelta(minutes=15):
            raise APIError(409, "edit_window_expired", "Edit window expired.")
        txn.update(ref, {"body": body.body, "editedAt": firestore.SERVER_TIMESTAMP})
        return data | {"body": body.body, "editedAt": "<pending-server-ts>"}

    return _txn(db.transaction())
```

**5.7.2 Archive transition (`archivedAt` null → now → null)**

Already on backend in `POST /api/groups/{gid}/archive` and `/unarchive`. No change in M4 — just verify the existing handlers enforce the `null → request.time` and `non-null → null` transitions transactionally. (Phase 2 review didn't flag these as racy, so they probably already do.)

**5.7.3 Soft-delete idempotency (`deletedAt` null → now)**

Inline transactional check in `DELETE /api/groups/{gid}/messages/{mid}`:

```python
@firestore.transactional
def _txn(txn):
    snap = ref.get(transaction=txn)
    if not snap.exists:
        raise APIError(404, "message_not_found", "...")
    if snap.get("deletedAt"):
        # Idempotent: returning 200 with the existing doc is fine.
        return snap.to_dict()
    # Author or leader.
    if snap.get("authorUid") != user.uid and membership.role != "leader":
        raise APIError(403, "not_author_or_leader", "...")
    txn.update(ref, {"deletedAt": firestore.SERVER_TIMESTAMP})
    return snap.to_dict() | {"deletedAt": "<pending>"}
```

### 5.8 Things the migration *increases* the security surface on

Three caveats. These are not blockers but are worth tracking.

* **The Admin SDK bypasses rules.** A bug in a backend handler that forgets `require_not_banned` will let a banned user write. The mitigation is the standard pattern: every `POST/PATCH/DELETE` route declares `Depends(require_not_banned)` (or composes a dep that includes it). M6 will add a CI grep that fails the build if a write route is missing that dep. **DESIGN-OPEN: write the lint rule as part of M6 or as a separate pre-merge task.**
* **Cross-group leakage via path-parameter confusion.** The path `/api/groups/{gid}/messages/{mid}` does not validate that `mid` belongs to `gid` — Firestore's path is `/groups/{gid}/messages/{mid}`, so the read implicitly gates by `gid`. Good. But a future bug that loads a message via `db.collection_group("messages").document(mid)` would skip the `gid` gate. The mitigation is "never use `collection_group` in a per-message endpoint" + a lint rule.
* **Audit log coverage drops if we forget to call `write_audit_log`**. Today, leadership actions audit-log. After the migration, message-edit and message-delete actions could be audit-loggable too — this is a feature increase. M4 explicitly adds audit log writes for delete (already specified in §4.13.3) and *not* for edit (high-volume). **DESIGN-OPEN: should edit go to audit log? The Phase 1 lineage says "no, too noisy." Confirm in M4.**

---

## 6. Realtime replacement

Eleven `onSnapshot` listeners exist today. Section 6 is the per-listener migration plan and the design of the SSE transport that replaces the chat one.

### 6.1 SSE transport — the implementation

EventSource (the W3C SSE primitive) does not let you set custom headers, including `Authorization`. The standard workaround is to pass the bearer token as a short-lived query-string token, or to use a polyfill that uses `fetch` and parses the SSE wire format manually. We use the latter. The chosen library is **`@microsoft/fetch-event-source`** (small, stable, supports custom headers natively, AbortController integration). It's not strictly necessary — a 100-line custom client suffices — but the ergonomics save bugs.

The wire format is plain SSE:

```
event: message.created
id: 0001712345678901-abc123
data: {"mid":"abc123","authorUid":"u_42","body":"hi","createdAt":"2026-05-03T10:11:12Z","stickerIds":[],"mediaRefs":[],"parentMessageId":null,"reactionCounts":{}}

event: heartbeat
id: 0001712345678999-hb
data: {"t":"2026-05-03T10:11:12Z"}

event: message.updated
id: 0001712345679001-abc123
data: {"mid":"abc123","fields":{"editedAt":"2026-05-03T10:12:00Z","body":"hi (edited)"}}
```

The `id:` field is monotonic per stream, encodes `<microseconds_since_epoch>-<random_hex>` so server reconnect can decide "you've already seen everything ≤ this id." On reconnect the client sends `Last-Event-ID: <id>` (this is built into EventSource and respected by the polyfill). The server then replays events with id > last-seen, then continues live.

#### 6.1.1 Backend handler shape

```python
# backend/app/routers/streams.py (M5)

@router.get("/groups/{gid}")
async def stream_group(
    gid: str,
    request: Request,
    membership: MembershipContext = Depends(require_member),
):
    last_event_id = request.headers.get("last-event-id")

    async def event_gen():
        # 1. Replay missed events from the backfill cache (§6.2.3).
        async for event in backfill.replay(gid, since=last_event_id):
            yield event.serialize()

        # 2. Live events from the realtime bus (§6.5).
        async for event in realtime.subscribe(gid, uid=membership.uid):
            if await request.is_disconnected():
                break
            yield event.serialize()

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disables nginx buffering
            "Connection": "keep-alive",
        },
    )
```

The `X-Accel-Buffering: no` header matters: Cloud Run's frontend (Google Front End) buffers small responses by default. Setting `X-Accel-Buffering: no` tells it to flush each chunk. Verify this works against Cloud Run via M5 acceptance test "send-message-then-receive-event in <1s end to end."

The handler is `async`. This requires a small detour: today's FastAPI app uses sync routes. M5 introduces the first async route. Sync and async routes coexist fine in FastAPI; no migration of existing handlers is needed.

#### 6.1.2 Frontend client shape

```ts
// frontend/lib/streams/client.ts (M5)

import { fetchEventSource } from "@microsoft/fetch-event-source";

export type StreamEvent =
  | { type: "message.created"; data: Message }
  | { type: "message.updated"; data: { mid: string; fields: Partial<Message> } }
  | { type: "message.deleted"; data: { mid: string } }
  | { type: "reaction.added"; data: { mid: string; slug: string; uid: string; counts: Record<string,number> } }
  | { type: "reaction.removed"; data: { mid: string; slug: string; uid: string; counts: Record<string,number> } }
  | { type: "pin.changed"; data: { pinnedMessageIds: string[] } }
  | { type: "archive.changed"; data: { archivedAt: string | null } }
  | { type: "member.changed"; data: { uid: string; role: "member" | "leader" | null /* null = removed */ } }
  | { type: "heartbeat"; data: { t: string } };

export function subscribeGroupStream(
  gid: string,
  getToken: () => Promise<string>,
  onEvent: (e: StreamEvent) => void,
  onReconnect: () => void,
): () => void {
  const ctrl = new AbortController();
  let lastEventId: string | undefined;

  void (async () => {
    while (!ctrl.signal.aborted) {
      try {
        const token = await getToken();
        await fetchEventSource(`/api/streams/groups/${gid}`, {
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
          },
          onmessage(ev) {
            lastEventId = ev.id || lastEventId;
            const parsed = parseStreamEvent(ev.event, ev.data);
            if (parsed) onEvent(parsed);
          },
          onclose() {
            // server closed — reconnect with last-event-id.
            throw new Error("reconnect");
          },
          onerror(err) {
            // throw to break out of fetchEventSource's auto-retry; we do our own.
            throw err;
          },
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        onReconnect();
        await sleep(backoff());  // 1s, 2s, 4s, 10s capped
      }
    }
  })();

  return () => ctrl.abort();
}
```

The hook composition lives in `frontend/lib/hooks/streams/useGroupStream.ts`. Per-listener hooks (`useGroupMessages`, `useThreadMessages`, `useReactions`, `usePinnedMessages`, `useGroup`) all subscribe to the same SSE channel and filter the events they care about. One TCP connection per group view, not five.

### 6.2 Per-listener migration plan

Each row maps a current `onSnapshot` to its replacement strategy: SSE event subscription, polling SWR, or one-shot fetch.

| Listener | Strategy | Rationale | Phase |
|---|---|---|---|
| `useGroupMessages` (group chat) | **SSE** — events `message.created/updated/deleted`, `reaction.*`, `pin.changed`, `archive.changed` | Hot path; latency-sensitive | M5 |
| `useThreadMessages` (thread drawer) | **SSE** — same channel as `useGroupMessages`, filtered to events with `parentMessageId == ourPid` | Same channel, no extra connection | M5 |
| `useReactions` (reaction state on a message) | **SSE** — same channel; reaction state is reflected in `reactionCounts` on the message + a per-user "my reactions" map updated from `reaction.added/removed` events where `uid == me` | Same channel | M5 |
| `usePinnedMessages` (pinned-banner) | **SSE** — same channel, listens for `pin.changed` event | Same channel | M5 |
| `useGroup` (group doc — name, archive, member count) | **SSE** — events `archive.changed`, `member.changed` (for member count), and a coarse `group.updated` for metadata changes | Same channel | M5 |
| `useUser` (own profile doc) | **One-shot fetch on session start + manual refetch on profile update** | Profile changes are rare and self-driven; no realtime needed | M2 |
| `useDeletionStatus` (deletion countdown) | **Polling, 60s** | Cosmetic countdown; accuracy <60s irrelevant | M2 |
| `useExportStatus` (export job progress) | **Polling, 5s while in-flight, otherwise 60s** | Tied to job progress; bounded duration; existing pattern in `frontend/lib/hooks/useExportStatus.ts` already polls under the hood | M2 |
| `useMutes` (mute set) | **One-shot fetch on session start + invalidate on local mute/unmute write** | Mutes are self-driven; no realtime needed | M2 |
| `useBlocks` (block set) | mirror of mutes | same | M2 |
| `useMembers` (member list for mention picker) | **SSE** — `member.changed` events on the group stream | Same channel as `useGroupMessages` for chat pages | M5 |
| `useInvites` (leader's invite list) | **One-shot fetch + manual refetch on create/revoke** | Settings page; not realtime | M3 |
| `useBoardPosts` | **Polling, 30s** + on-write invalidate | Boards traffic is far lower than chat; SSE not justified | M3/M4 |
| `useBoardPost` (single post) | **Polling, 30s** | same | M3/M4 |
| `useBoards` (board list) | **One-shot fetch + 5-minute SWR** | Static-ish | M3 |
| `useDailyVerse` | **One-shot fetch** | static per-day | M1 |
| `useStickers` | **One-shot fetch + module-level cache** | static-ish | M1 |
| `usePushSetup` (FCM device register) | **One-shot POST** | one-time | M2 |

Of the 11 realtime listeners, **6 collapse onto a single SSE channel** (`useGroupMessages`, `useThreadMessages`, `useReactions`, `usePinnedMessages`, `useGroup`, `useMembers`); 4 become polling SWR (`useDeletionStatus`, `useExportStatus`, `useBoardPosts`, `useBoardPost`); 1 becomes one-shot (`useStickers` already is, kept). Connection count per active group view: **1 SSE + occasional REST**.

### 6.3 Event shape per stream

Defined precisely so clients can pattern-match and the backend can serialize. JSON keys mirror the Firestore field names.

**Group stream (`GET /api/streams/groups/{gid}`)**

| Event | Fired when | Data shape |
|---|---|---|
| `message.created` | `POST /api/groups/{gid}/messages` commits | full `Message` object |
| `message.updated` | `PATCH .../messages/{mid}` (edit) or `POST .../announce` commits | `{ mid: string, fields: Partial<Message> }` (only changed fields) |
| `message.deleted` | `DELETE .../messages/{mid}` (soft) commits | `{ mid: string }` — clients render as deleted; body redaction is server-side |
| `reaction.added` | `POST .../reactions/{slug}` commits | `{ mid, slug, uid, counts: Record<string,number> }` (full counts post-write) |
| `reaction.removed` | `DELETE .../reactions/{slug}` commits | `{ mid, slug, uid, counts }` |
| `pin.changed` | `PATCH /api/groups/{gid}` updates `pinnedMessageIds` | `{ pinnedMessageIds: string[] }` |
| `archive.changed` | `POST /api/groups/{gid}/archive` or `/unarchive` commits | `{ archivedAt: string \| null, archivedBy: string \| null }` |
| `member.changed` | member create/promote/demote/remove commits | `{ uid: string, role: "member" \| "leader" \| null, memberCount: int }` (`null` = removed) |
| `group.updated` | `PATCH /api/groups/{gid}` updates non-pinned fields | `{ fields: Partial<GroupDetail> }` |
| `heartbeat` | every 25 seconds of idle | `{ t: ISO8601 }` |

**Notifications stream (`GET /api/streams/notifications`)**

| Event | Fired when | Data shape |
|---|---|---|
| `notification.created` | `users/{uid}/notifications/{nid}` write (by trigger) | `Notification` object |
| `notification.read` | `POST /api/users/me/notifications/{nid}/read` commits | `{ nid: string, readAt: string }` |
| `heartbeat` | idle | `{ t }` |

### 6.4 Dedup and ordering

The chat stream is the place where dedup matters most. Three sources of writes can land a message into the client's view:

1. The **REST POST** the client just made (optimistic local commit, see §9 for optimistic UI).
2. The **SSE `message.created` event** for that same message, fired after the server commits.
3. The **paginated history fetch** the client may run on scroll-up.

The dedup key is the message id (`mid`). The hook keeps a `Map<mid, Message>` rather than a list:

```ts
// useGroupMessages (M5)

const messages = useMessageMap(gid);
// messages = Map<mid, Message>

// On REST POST: write {tempMid: 'optimistic_xxx', ...} into the map immediately.
// On SSE message.created with the same body+author within 5s: replace tempMid → real mid.
//   (Match by 'pendingMessage.id' that the server echoes back from the POST response — see §9.)
// On SSE message.updated: shallow-merge fields onto Map.get(mid).
// On SSE message.deleted: Map.delete(mid).
// On scroll-up paginated fetch: merge into Map; if a mid is already there, server wins.
```

Ordering is by `createdAt`. Two messages with the same `createdAt` (microsecond collision is extremely rare with Firestore server timestamps) tie-break by `mid` lexicographically. Render derives a sorted array from the Map at render time — `useMemo(() => [...map.values()].sort((a,b) => a.createdAt - b.createdAt || a.mid.localeCompare(b.mid)))`.

#### 6.4.1 Reconnect/backfill flow

Failure modes:

* Client laptop sleeps 30 min. Wakes up. EventSource reconnects.
* Client's mobile network drops. Reconnect after a minute.
* Cloud Run instance restarts (M5 single-instance topology — see §6.5). Client EventSource sees TCP RST and reconnects.

In all three cases, the client's `Last-Event-ID` header tells the server what the last event was. The server's job is to emit events strictly after that id.

Backfill source: a **Firestore listener tail query** with `where("createdAt", ">", last_event_microseconds)`. This is exactly what the JS SDK does today — a Firestore listener on `groups/{gid}/messages` ordered by `createdAt`. Our backend opens the listener with the Admin SDK (which supports listeners in Python via `on_snapshot`) and forwards events via the SSE channel.

This means **the backfill mechanism IS the live stream mechanism**: there's no separate backfill cache. The Firestore listener replays the last N events on subscribe (Firestore's `on_snapshot` API gives you the current state in the first callback) plus subsequent live events. If `last_event_id` is more than N events behind, we send a "you should refetch from the REST API" event:

```
event: backfill.gap
data: {"reason":"too_old","sinceMicros": 17123456789, "fetchUrl":"/api/groups/{gid}/messages?cursor=..."}
```

Client receives `backfill.gap`, drops to a fresh paginated fetch, then re-subscribes with no `Last-Event-ID`.

#### 6.4.2 Dedup of trigger-driven events

Cloud Functions triggers (`onMessageWrite`, etc.) are the OTHER source of writes — counter rollups and reaction counts are written by triggers, not by the API handlers. Today the trigger writes a doc and the JS SDK's onSnapshot fires. After the migration, the trigger writes a doc and the **backend's Admin SDK listener** fires. The flow is identical from the SSE-client perspective: the listener sees the trigger's write and emits a `message.updated` event with the new `reactionCounts` field.

This means **we do not need a separate trigger-to-SSE pipe**: the Firestore listener in the backend captures both the API-driven writes AND the trigger-driven writes. They're the same writes from Firestore's perspective. Section 6.5 below makes this concrete.

### 6.5 Realtime fanout: how events get from Firestore to SSE clients

The SSE handler subscribes to a Firestore listener via the Admin SDK in Python (`google-cloud-firestore` exposes `Query.on_snapshot(callback)` in sync mode and an async iterator wrapper is straightforward). Each SSE-connected client opens its own listener — N clients on a group means N listeners on `groups/{gid}/messages` and `groups/{gid}/messages/.../reactions`.

This is **deliberately not Redis** in M5. Reasons:

1. **Firestore listeners are free for the first ~1 listener-day per active query.** A modest 10 active groups × 50 average viewers = 500 listeners, each on the same query. Firestore charges per document read, so 500 listeners over the same query share the read fan-out at the Firestore side. The cost dominator is per-write events × N-listeners; for chat-grade traffic this is fine.
2. **No new infra.** Redis Pub/Sub on GCP Memorystore is ~$50/month minimum. We don't need it for v1.
3. **Single-source-of-truth.** Firestore is already the system of record; it's also the broadcaster.

The drawback is that **multi-instance Cloud Run can't share connections**. If Cloud Run scales to 2 instances and a client lands on instance B but its message-create POST landed on instance A, the SSE on B still sees the event because it's reading from Firestore — no problem. The drawback is just **listener count**: each instance opens its own listeners.

For v1 we cap Cloud Run at `max_instances=1` for the streams router (a separate Cloud Run service, see §6.6). At ~50 concurrent SSE clients per group × ~10 groups = 500 clients = 500 listeners. The existing free-tier limits accommodate this.

When traffic justifies, M5.10 swaps the Firestore listener for a Redis Pub/Sub fanout backed by a single per-group listener that each Cloud Run instance subscribes to. Migration is internal — the SSE wire format does not change.

### 6.6 Cloud Run topology for streams

The streams router becomes its own service: `jacob-streams` (deploys from `backend/` but with `streams.py` only mounted via a separate Dockerfile target). Reasons:

* SSE connections are long-lived (minutes to hours). Mixing them on the main API service means the main API has to run with a high request-timeout, which messes up the rate-limit middleware's per-instance state assumptions.
* `max_instances=1` for streams (M5 single-instance topology) but `max_instances=10` for main API (existing).
* Cloud Run timeouts can go up to 60 minutes; we set `timeout=3600s` for the streams service explicitly.

Frontend hits the same hostname; same-origin path `/api/streams/...` is rewritten by Firebase Hosting to the streams service. `firebase.json` rewrites pattern.

### 6.7 Test plan for the realtime path

The hardest tests are the reconnect/backfill ones. M5 ships these:

1. **Backend integration test** (`backend/tests/test_streams.py`): start the FastAPI app with the Firestore emulator; open an SSE connection; POST a message; assert the SSE client receives `message.created` within 1s; close the connection; POST another message; reconnect with `Last-Event-ID: <first-id>`; assert the SSE client receives the second message.
2. **Backend integration test — backfill gap**: same as above but POST 1000 messages between disconnect and reconnect; assert client receives `backfill.gap` event.
3. **Frontend integration test** (vitest emulator harness, `frontend/tests/integration/streams.test.ts`): start the backend, open a stream from the frontend hook, POST a message via REST, assert hook state updates within 1s.
4. **Frontend integration test — reconnect**: simulate network drop via abort signal; assert reconnect happens within 5s; assert no message duplicate in `useGroupMessages` output.
5. **Frontend integration test — clock skew**: client clock 2 hours ahead; assert ordering still works (server timestamps are authoritative; client never trusts its own clock for ordering).

Listener counts are verified via a load test: 100 simulated SSE clients on one group; verify backend memory and CPU stay sub-50% on the smallest Cloud Run profile (1 vCPU, 512MB).

### 6.8 Listeners to NOT migrate to SSE

Listed in §6.2 above. The principle is: only the chat path is hot enough to justify SSE. Everything else degrades to polling, fetch-on-mount, or fetch-on-write. This is conservative; it minimises the M5 blast radius.

---

## 7. Phasing

Six phases. Each phase = one PR, designed to merge cleanly to `main`. Each phase is independently revertible (§11). Each phase is acceptance-tested against criteria in §10.

The phases are ordered so the user-impact bug — first-load fails behind an adblocker — is fixed by **end of M2**. M2 ships the bootstrap-cookie + profile-read migration. After M2, the onboarding flow no longer needs Firestore SDK to succeed. The remaining phases progressively shrink the SDK surface until M6 deletes it.

A phase's scope is "what can one Sonnet implement and review in one PR." Empirically, that's ~6-12 endpoints and their callers, plus tests, plus a docs note. M3 is the largest at the boundary; M5 is the most subtle.

### 7.1 M1 — Phase A: stickers + daily verse (the pilot)

**Why first.** Two read-only, low-traffic endpoints. They validate the entire migration pattern: client API helper, backend handler skeleton, Pydantic models, hook rewrite, tests, rule tightening. If M1 is rocky, every later phase is rockier.

**Branch.** `claude/m1-stickers-verse`.

**Files touched.**

* NEW: `backend/app/routers/stickers.py` — `GET /api/stickers`.
* NEW: `backend/app/routers/verse.py` — `GET /api/daily-verse`. (Note: `backend/app/services/verse.py` exists; the new router is a thin façade.)
* NEW: `backend/app/models/stickers.py` — `Sticker`, `StickerListResponse`.
* NEW: `backend/app/models/verse.py` — `DailyVerseResponse`.
* MODIFIED: `backend/app/main.py` — register the two new routers.
* NEW: `frontend/lib/api.ts` — small typed fetch wrapper. Public surface: `apiGet<T>(path, opts)`, `apiPost<T,B>(path, body, opts)`, `ApiError` class. Handles Authorization header, error parsing, retries on 5xx.
* MODIFIED: `frontend/lib/hooks/useStickers.ts` — replace `getDocs` with `apiGet<StickerListResponse>("/api/stickers")`.
* MODIFIED: `frontend/lib/hooks/useDailyVerse.ts` — replace `getDoc` with `apiGet<DailyVerseResponse>("/api/daily-verse")`.
* NEW: `frontend/lib/hooks/__tests__/useStickers.test.ts` (vitest).
* NEW: `backend/tests/test_stickers.py`, `backend/tests/test_verse.py` (pytest).
* MODIFIED: `firestore/firestore.rules` — leave unchanged for now. M6 tightens.
* MODIFIED: `docs/data-layer-migration-plan.md` — add an "M1 retro" section with anything learned.

**`frontend/lib/api.ts` — the typed client (introduced in M1).**

```ts
import { auth } from "@/lib/firebase";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) { super(message); }
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function apiGet<T>(path: string, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const r = await fetch(path, {
    method: "GET",
    headers: { ...await authHeader(), Accept: "application/json" },
    signal: opts.signal,
  });
  if (!r.ok) throw await parseError(r);
  return (await r.json()) as T;
}

export async function apiPost<T, B = unknown>(path: string, body: B, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: {
      ...await authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok) throw await parseError(r);
  return (await r.json()) as T;
}

// PATCH and DELETE are similar.

async function parseError(r: Response): Promise<ApiError> {
  let payload: { error?: { code?: string; message?: string; details?: Record<string,unknown> } } = {};
  try { payload = await r.json(); } catch {}
  return new ApiError(
    r.status,
    payload.error?.code ?? "unknown",
    payload.error?.message ?? r.statusText,
    payload.error?.details,
  );
}
```

This single module is the foundation for every later phase. Get its retry behaviour, error shape, and AbortSignal plumbing right in M1.

**Acceptance criteria.**

* `useStickers()` returns the same data as today, with no `firebase/firestore` import in the file.
* `useDailyVerse()` ditto.
* The two hooks work behind a uBlock Origin install with default lists. **Manual verification step: install uBlock, load a chat page, confirm stickers and daily verse render.**
* `pytest backend/tests/test_stickers.py backend/tests/test_verse.py` passes, including a 401 case.
* `vitest frontend/lib/hooks/__tests__/useStickers.test.ts` passes.

**Test plan.**

* Backend: pytest. Mock `firebase_admin` at module level (existing pattern in `backend/tests/conftest.py`). Tests: 200 happy path, 401 missing token, 503 Firestore down, sticker filter by audience, ETag round-trip.
* Frontend: vitest with the `apiGet` helper mocked. Test: hook returns `{loading: true}` then `{loading: false, stickers: [...]}`. Test: error path (`ApiError`).
* Smoke: `pnpm dev` + uBlock Origin enabled, manually load `/`.

**Rollback plan.** Single revert. The two new endpoints have no callers other than the two updated hooks. Reverting the PR restores the prior `getDocs` calls. No data migration; nothing was written.

**One-line risk note.** "If M1 fails: stickers and the daily verse stop loading; the rest of the app is unaffected."

### 7.2 M2 — Phase B: profile + bootstrap (the cookie fix)

**Why next.** Fixes the immediate adblock onboarding bug. After M2 a user with uBlock can sign in, onboard, and reach `/groups/{gid}` (the chat page itself still loads via Firestore SDK until M3+M5, but the gating bootstrap no longer depends on Firestore from the browser).

**Branch.** `claude/m2-profile-bootstrap`.

**Files touched.**

* NEW endpoints (per §4.3-4.5, 4.8, 4.4):
  * `GET /api/users/me/bootstrap`
  * `POST /api/users/me`
  * `PATCH /api/users/me`
  * `GET /api/users/me/notification-prefs`
  * `PUT /api/users/me/notification-prefs`
  * `POST /api/users/me/devices`
  * `DELETE /api/users/me/devices/{deviceId}`
  * `GET /api/users/me/notifications`
* NEW: `backend/app/routers/users.py` — owns all of the above.
* NEW: `backend/app/models/users.py` — `UserProfile`, `CreateProfileRequest`, `UpdateProfileRequest`, `BootstrapResponse`, `NotificationPrefs`, `RegisterDeviceRequest`, `DeviceResponse`, `Notification`, `NotificationsListResponse`.
* MODIFIED: `backend/app/main.py` — register the new router.
* NEW: `backend/app/middleware/cookie.py` — the `Set-Cookie` middleware that sets `jacob-has-profile` on `/api/users/me/bootstrap` and on `POST /api/users/me`.
* NEW: `backend/app/deps.py` — `require_not_banned` dep added (§5.2).
* MODIFIED: `frontend/lib/hooks/useUser.ts` — drop `onSnapshot`; replace with one-shot `apiGet<BootstrapResponse>("/api/users/me/bootstrap")` on mount + manual refetch via a returned `refresh()` callback. Drop the cookie-write side effect (server now sets it).
* NEW: `frontend/lib/hooks/useNotificationPrefs.ts` — replaces the inline `getDoc`/`setDoc` in the settings page.
* MODIFIED: `frontend/app/(authed)/settings/notifications/page.tsx` — switch to `useNotificationPrefs`.
* MODIFIED: `frontend/components/onboarding/ProfileForm.tsx` — `setDoc` → `apiPost<UserProfile, CreateProfileRequest>("/api/users/me", ...)`.
* MODIFIED: `frontend/lib/push.ts` — `setDoc` → `apiPost<DeviceResponse, RegisterDeviceRequest>("/api/users/me/devices", ...)`.
* MODIFIED: `frontend/lib/hooks/useDeletionStatus.ts` — `onSnapshot(users/{uid})` → polling `apiGet<DeleteStatusResponse>("/api/account/delete/status")` every 60s while the dialog is open.
* MODIFIED: `frontend/lib/hooks/useExportStatus.ts` — `onSnapshot(users/{uid}/exports)` → polling `apiGet<ExportJobResponse>("/api/account/export/status")` every 5s while in-flight.
* MODIFIED: `frontend/lib/hooks/useMutes.ts` — `onSnapshot` + `setDoc` + `deleteDoc` → `apiGet<MutesResponse>` once + manual refetch on `useMute()` action; `setDoc` → `apiPost`; `deleteDoc` → `apiDelete`.
* MODIFIED: `frontend/lib/hooks/useBlocks.ts` — mirror of `useMutes`.
* NEW: `backend/tests/test_users.py`, `backend/tests/test_users_bootstrap.py`, `backend/tests/test_users_devices.py`, `backend/tests/test_users_notifications.py`.
* NEW: `frontend/tests/m2-cookie-bootstrap.test.tsx` — explicit test that an authed page renders without `firebase/firestore` mocked.

**M2.5 — the cookie bootstrap (load-bearing detail).**

The middleware that sets `jacob-has-profile` is in `backend/app/middleware/cookie.py`. It runs on every `/api/users/me/bootstrap` and `/api/users/me` (POST) response and reads the response body to determine whether the user has a profile, then writes the cookie:

```python
# backend/app/middleware/cookie.py (M2)

class HasProfileCookieMiddleware(BaseHTTPMiddleware):
    """
    On responses from bootstrap or profile-create endpoints, sets
    or clears the `jacob-has-profile` cookie used by frontend/middleware.ts.
    """
    TARGET_PATHS = {"/api/users/me/bootstrap", "/api/users/me"}

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path in self.TARGET_PATHS and response.status_code < 400:
            # The bootstrap response includes hasProfile in its JSON body.
            # We can't inspect StreamingResponse without buffering, but FastAPI
            # JSON responses go through Response, which has .body. Trust the
            # handler to set a header marker on the response when no profile.
            has_profile = response.headers.get("X-Has-Profile") == "1"
            secure = "; Secure" if request.url.scheme == "https" else ""
            if has_profile:
                response.headers["Set-Cookie"] = f"jacob-has-profile=1; Path=/; SameSite=Lax{secure}"
            else:
                response.headers["Set-Cookie"] = f"jacob-has-profile=; Path=/; Max-Age=0; SameSite=Lax{secure}"
        return response
```

The handler-side cooperator: `users.bootstrap` and `users.create_profile` set `response.headers["X-Has-Profile"] = "1"` (or "0") so the middleware can decide without parsing the body. This is uglier than I'd like — alternative is to skip the middleware and just have the two handlers each call `response.set_cookie(...)` directly. **Preference: the latter, simpler pattern.** Use `Response(content=..., headers={"Set-Cookie": "..."})` inside the handler. The middleware is over-engineered.

Rewrite the section as: the handler returns `Response.set_cookie("jacob-has-profile", ...)`. No middleware. Sonnet, default to that.

**Acceptance criteria.**

* On a fresh sign-in with uBlock Origin enabled, the user can complete onboarding and reach `/groups`.
* `useUser` no longer imports `firebase/firestore`.
* `useDeletionStatus`, `useExportStatus`, `useMutes`, `useBlocks` no longer import `firebase/firestore`.
* `frontend/lib/push.ts` no longer imports `firebase/firestore`.
* `frontend/components/onboarding/ProfileForm.tsx` no longer imports `firebase/firestore`.
* `frontend/app/(authed)/settings/notifications/page.tsx` no longer imports `firebase/firestore`.
* `pytest backend/tests/test_users*.py` passes (≥30 cases).
* The middleware redirect contract is preserved: missing cookie still redirects to `/onboarding`.
* CI is green: `eslint`, `prettier`, `tsc`, `vitest`, `ruff`, `black`, `mypy`, `pytest`, rules tests.

**Test plan.**

* Backend pytest:
  * `bootstrap` returns `{hasProfile: true, profile: {...}}` for an existing user; sets the cookie.
  * `bootstrap` returns `{hasProfile: false, profile: null}` for a new user; clears the cookie.
  * `POST /api/users/me` 409s on duplicate.
  * `POST /api/users/me` validates `displayName` length (1..100), `photoURL` length, `isMinor` bool.
  * `PATCH /api/users/me` rejects extra keys (Pydantic `extra=forbid`).
  * `PATCH /api/users/me` 403s for a banned user.
  * `PUT /api/users/me/notification-prefs` overwrites the doc.
  * `POST /api/users/me/devices` deduplicates on `fcmToken`.
* Frontend vitest:
  * `useUser` returns the bootstrap response.
  * `useUser`'s `refresh()` re-fetches.
  * `useDeletionStatus` polls every 60s; clears the interval on unmount.
* Manual: install uBlock, complete onboarding, sign-out, sign-in, reach `/groups` without a hang.

**Rollback plan.** Single revert. Server-side `Set-Cookie` is no-op for clients that haven't fetched the new endpoints; the frontend's prior client-side cookie write is also no-op (the `useUser` listener was removed). On revert, the listener returns and the cookie writes from the browser again. No data migration.

**One-line risk note.** "If M2 fails: onboarding hangs in adblock-prod and the cookie redirect loops; revert immediately."

### 7.3 M3 — Phase C: groups + memberships (reads)

**Why next.** Once M2 is stable, the reads on `groups/{gid}`, `groups/{gid}/members/{uid}`, and the collection-group `members` query become the next-biggest cluster of `firebase/firestore` callers. M3 ports all the read endpoints; M4 ports the writes. Splitting reads from writes lets M3 land safely without touching the write-path rate limits or audit log infra.

**Branch.** `claude/m3-groups-reads`.

**Files touched.**

* NEW endpoints (per §4.10):
  * `GET /api/users/me/groups`
  * `GET /api/groups/{gid}` (the existing `POST /api/groups` is unchanged; this is the per-group read)
  * `GET /api/groups/{gid}/me`
  * `GET /api/groups/{gid}/members`
  * `GET /api/groups/{gid}/pinned-messages`
  * `GET /api/groups/{gid}/messages` (read; one-shot + pagination)
  * `GET /api/groups/{gid}/messages/{mid}`
  * `GET /api/boards` (already exists; just verify response shape covers `useBoards`)
  * `GET /api/boards/{boardId}/posts`
  * `GET /api/boards/{boardId}/posts/{postId}`
  * `GET /api/boards/{boardId}/posts/{postId}/replies`
* NEW: `backend/app/routers/messages.py` — read endpoints only in M3.
* NEW: `backend/app/routers/members.py` — group members read.
* MODIFIED: `backend/app/routers/groups.py` — add the per-group read + `me` membership read.
* MODIFIED: `backend/app/routers/boards.py` — add the post + reply read endpoints.
* NEW: `backend/app/models/messages.py` — `Message`, `MessagesListResponse`.
* NEW: `backend/app/models/members.py` — `Member`, `MembersListResponse`.
* MODIFIED: `backend/app/deps.py` — add `require_member`, `require_leader`, `require_member_or_public_top_level` (§5.2).
* MODIFIED: hooks:
  * `useGroups.ts` — `collectionGroup` query → `apiGet<MyGroupsResponse>("/api/users/me/groups")`.
  * `useGroup.ts` — `onSnapshot` → `apiGet<GroupDetail>("/api/groups/{gid}")` once + return `refresh()`.
  * `useMembers.ts` — `onSnapshot` → `apiGet<MembersListResponse>("/api/groups/{gid}/members")` once + return `refresh()`.
  * `useGroupMessages.ts` — `onSnapshot` + `getDocs` → `apiGet<MessagesListResponse>("/api/groups/{gid}/messages?cursor=...")`. **No SSE yet** — M3 polls every 10 seconds. M5 adds SSE.
  * `useThreadMessages.ts` — same pattern with `?parentMessageId=`.
  * `useRecentMessages.ts` — `getDocs` per group → single `apiGet<RecentMessagesResponse>("/api/users/me/recent-messages")` (NEW endpoint, optional).
  * `usePinnedMessages.ts` — `onSnapshot(group) + getDoc(message) per id` → `apiGet<PinnedMessagesResponse>("/api/groups/{gid}/pinned-messages")`.
  * `useInvites.ts` — `onSnapshot` → `apiGet<InviteListResponse>("/api/groups/{gid}/invites")` + manual refetch on create/revoke.
  * `useBoards.ts` — `onSnapshot` → `apiGet` + 5-minute SWR.
  * `useBoardPosts.ts` — `onSnapshot` → `apiGet` + 30s polling.
  * `useBoardPost.ts` — same.
* MODIFIED: pages:
  * `frontend/app/groups/[gid]/chat/page.tsx` — drop direct `onSnapshot`; use `useGroup` + `useGroupMembership` (NEW small hook over `GET /api/groups/{gid}/me`).
  * `frontend/app/groups/[gid]/settings/page.tsx` — same.
  * `frontend/app/groups/[gid]/members/page.tsx` — same; use `useMembers`.
  * `frontend/app/groups/[gid]/analytics/page.tsx` — same.
  * `frontend/app/groups/[gid]/settings/invites/page.tsx` — drop direct `onSnapshot`; use `useInvites`.
  * `frontend/components/groups/InviteList.tsx` — switch to `useInvites`.
* NEW: `backend/tests/test_messages_read.py`, `test_members.py`, `test_my_groups.py`.

**Acceptance criteria.**

* Every group page renders behind uBlock Origin.
* `useGroupMessages` polls; messages from another user appear within 10-15 seconds. (Latency degradation is acceptable for M3 because M5 fixes it. We will document this in the M3 PR description.)
* No hook listed above imports `firebase/firestore`.
* The collection-group rule (`firestore.rules:438-441`) is unchanged in M3 (M6 tightens).
* CI green.

**Test plan.**

* Backend pytest covers each new read endpoint with: 200 happy path, 401, 403 not-a-member (member-only paths), 404 not-found, 422 invalid cursor, pagination (cursor → next-cursor → empty page).
* Frontend vitest: each migrated hook returns the expected shape from a mocked `apiGet`. SWR/poll behaviour: vitest fake-timers verify the refetch interval.
* Manual: with uBlock, navigate to a group, see messages, scroll up to load more, switch groups, check member list.

**Rollback plan.** Single revert. Hooks return to the prior `onSnapshot` calls. The new endpoints become orphaned but harmless. **Data integrity:** no data is written by M3; reverting is a pure code change.

**One-line risk note.** "If M3 fails: chat shows stale messages or doesn't load; revert and chat returns to working-but-broken-behind-adblock."

### 7.4 M4 — Phase D: writes

**Why next.** With reads on the API, writes are the next surface. M4 ports every client-side write to a backend endpoint. After M4, no `setDoc / addDoc / updateDoc / deleteDoc` calls remain in the frontend.

**Branch.** `claude/m4-writes`.

**Files touched.**

* NEW endpoints (per §4.11-4.15):
  * `PATCH /api/groups/{gid}` (group metadata + pinned messages + avatar)
  * `POST /api/groups/{gid}/messages` (message create — top-level + thread)
  * `PATCH /api/groups/{gid}/messages/{mid}` (edit, 15-min window)
  * `DELETE /api/groups/{gid}/messages/{mid}` (soft-delete)
  * `POST /api/groups/{gid}/messages/{mid}/reactions/{slug}` (reaction add)
  * `DELETE /api/groups/{gid}/messages/{mid}/reactions/{slug}` (reaction remove)
  * `POST /api/users/me/mutes/{otherUid}`
  * `DELETE /api/users/me/mutes/{otherUid}`
  * `POST /api/users/me/blocks/{otherUid}`
  * `DELETE /api/users/me/blocks/{otherUid}`
  * `POST /api/users/me/notifications/{nid}/read`
  * `POST /api/boards/{bid}/posts`
  * `PATCH /api/boards/{bid}/posts/{pid}`
  * `DELETE /api/boards/{bid}/posts/{pid}`
  * `POST /api/boards/{bid}/posts/{pid}/pin` (admin)
  * `DELETE /api/boards/{bid}/posts/{pid}/pin` (admin)
  * `POST /api/boards/{bid}/posts/{pid}/replies`
  * `PATCH /api/boards/{bid}/posts/{pid}/replies/{rid}`
  * `DELETE /api/boards/{bid}/posts/{pid}/replies/{rid}`
  * `POST /api/boards/{bid}/posts/{pid}/reactions/{slug}`
  * `DELETE /api/boards/{bid}/posts/{pid}/reactions/{slug}`
* NEW: write handlers in `backend/app/routers/messages.py`, `backend/app/routers/boards.py`, `backend/app/routers/users.py`, MODIFIED `backend/app/routers/groups.py`.
* NEW: `backend/app/services/messages.py` — encapsulates the transactional write logic (parent-exists check, archive check, etc.) so handlers stay thin.
* MODIFIED: `backend/app/limits.py` — add new limit constants:
  * `MESSAGE_CREATE: "60/minute"` per uid.
  * `MESSAGE_EDIT: "30/hour"` per uid.
  * `MESSAGE_DELETE: "60/hour"` per uid.
  * `REACTION_TOGGLE: "120/minute"` per uid.
  * `BOARD_POST_CREATE: "30/hour"` per uid.
  * `BOARD_REPLY_CREATE: "60/hour"` per uid.
  * `MUTE_BLOCK_TOGGLE: "30/minute"` per uid.
* MODIFIED: components:
  * `MessageInput.tsx`, `ThreadReplyInput.tsx` — `addDoc` → `apiPost`.
  * `MessageItem.tsx` — `updateDoc(body)` → `apiPatch`; `updateDoc(deletedAt)` → `apiDelete`.
  * `GroupSettingsForm.tsx`, `GroupAvatarUpload.tsx` — `updateDoc` → `apiPatch`.
  * `NewPostForm.tsx`, `NewReplyForm.tsx` (boards) — `addDoc` → `apiPost`.
* MODIFIED: hooks:
  * `useReactions.ts` — `setDoc/deleteDoc` → `apiPost/apiDelete`.
  * `useBoardPostReactions.ts` — same.
  * `usePinnedMessages.ts` — `updateDoc(group)` → `apiPatch(group, {pinnedMessageIds})`.
  * `useMutes.ts`, `useBlocks.ts` — finish the write side from M2.
* NEW: `backend/tests/test_messages_write.py`, `test_messages_edit.py`, `test_messages_delete.py`, `test_reactions.py`, `test_boards_write.py`.

**The 15-minute edit window.** The edit handler reads the message inside a Firestore transaction and computes `now - createdAt`. The Phase 2 review's "double-message rule" lesson (don't trust client time) carries over — we use `firestore.SERVER_TIMESTAMP` for `createdAt` on write and `time.time()` on read, both anchored to the server.

**Optimistic UI for sends.** Today, the moment you `addDoc`, Firestore commits locally and the message appears. After M4, the round-trip is `client → backend → Firestore → SSE → client`, which is ~100-300ms p50. We bridge with optimistic local state in the chat hook:

```ts
// frontend/lib/hooks/useGroupMessages.ts (M4 write addition; M5 SSE wiring)

async function sendMessage(input: CreateMessageInput) {
  const tempId = `tmp_${crypto.randomUUID()}`;
  const optimistic: Message = { id: tempId, authorUid: me, body: input.body, /*...*/, _optimistic: true };
  insertOptimistic(optimistic);  // shows in chat immediately
  try {
    const real = await apiPost<Message, CreateMessageInput>(`/api/groups/${gid}/messages`, input);
    replaceOptimistic(tempId, real);  // swap tempId for real id
  } catch (err) {
    markFailed(tempId, err);  // shows the failed indicator + retry affordance
    throw err;
  }
}
```

When M5 lands, the `replaceOptimistic` step is also triggered by the SSE `message.created` event for the same author — whichever arrives first wins; the other is a no-op due to the dedup keyed on `mid`.

**Audit log new entries.** Per §4: `message.delete` audit. No edit audit (high-volume, low-value). Add `account.update_profile` audit (M2 already specified it).

**Rate limit table addition.** §4 lists per-endpoint limits; M4 adds them to `backend/app/limits.py` and applies via `@limiter.limit(...)`. **The limits are per-uid, not per-IP.** `slowapi` + `request.state.uid` (set by `get_current_user`) is the existing pattern.

**Acceptance criteria.**

* Every chat send works behind uBlock Origin.
* Every reaction toggle works behind uBlock Origin.
* Every group/board write works behind uBlock Origin.
* Soft-delete is idempotent (calling delete twice on the same message returns 200 with the existing doc).
* Edit returns 409 `edit_window_expired` when called >15 minutes after `createdAt`.
* Unit tests cover the rate-limit cases (429 on the 121st reaction toggle in 60 seconds).
* `firestore.rules` is unchanged in M4 (rules still enforce the same predicates for any client that *does* still write directly — defense-in-depth until M6).

**Test plan.**

* Backend pytest covers each write endpoint:
  * 200/201 happy path.
  * 401 missing token.
  * 403 not-a-member, banned, archived group, deleted message, sticker doesn't exist.
  * 422 shape errors (body too long, mediaRefs has bad URL, stickerIds > 5, mentions > 10).
  * 409 edit-window-expired, soft-delete idempotency.
  * 429 rate-limited.
  * Audit log written for `message.delete` and `account.update_profile`.
* Frontend vitest: each component's send action calls the right `apiPost` shape with the right body.
* Integration: end-to-end "send a message via the migrated `MessageInput` and assert the message appears in `useGroupMessages`'s polling refresh."
* Manual: send 50 messages back-to-back, verify they all land; verify rate-limit triggers cleanly.

**Rollback plan.** Single revert. Reverting restores the prior client-side write paths; the new endpoints become orphaned. **Data integrity:** all the writes that did land via the new endpoints are valid — they wrote the same Firestore docs the client SDK would have. No cleanup needed.

**One-line risk note.** "If M4 fails: chat sends bounce back as errors; revert and we're back to direct-Firestore writes (which work, except behind adblockers)."

### 7.5 M5 — Phase E: SSE chat realtime

**Why next.** Replaces the M3-introduced polling (10s) with sub-second SSE pushes. Closes the only remaining UX gap from the migration: chat feels real-time again.

**Branch.** `claude/m5-sse-chat`.

**Files touched.**

* NEW endpoints (per §4.16):
  * `GET /api/streams/groups/{gid}` (SSE)
  * `GET /api/streams/notifications` (SSE)
* NEW: `backend/app/routers/streams.py` — owns both endpoints.
* NEW: `backend/app/services/realtime.py` — owns the Firestore listener orchestration. Subscribes to `groups/{gid}/messages`, `groups/{gid}/messages/.../reactions`, `groups/{gid}` doc, `groups/{gid}/members`. Translates Firestore `DocumentChange`s into the SSE event types from §6.3.
* NEW: `frontend/lib/streams/client.ts` — the polyfill-backed client from §6.1.2.
* NEW: `frontend/lib/streams/groupStream.ts` — the multiplex for the chat-page hooks.
* MODIFIED: hooks — wire each into the shared stream:
  * `useGroupMessages` — drop the 10s poll; use `useGroupStream(gid).subscribeMessages`.
  * `useThreadMessages` — same, filtered by `parentMessageId`.
  * `useReactions` — wire into the stream's reaction events (incoming events update local `myReactionsRef` state).
  * `usePinnedMessages` — wire into the stream's `pin.changed`.
  * `useGroup` — wire into `archive.changed` + `member.changed` for memberCount + `group.updated` for metadata.
  * `useMembers` — wire into `member.changed` for incremental updates.
* MODIFIED: `firebase.json` — add a rewrite for `/api/streams/**` to a separate Cloud Run service `jacob-streams` (M5 deploys it).
* NEW: `backend/Dockerfile.streams` — separate Dockerfile target for the streams service. Excludes the heavy ML/email deps; just the FastAPI app + the streams + users + groups routers + the deps it needs.
* MODIFIED: `infra/cloudrun.tf` (or whatever the deploy file is — verify) — add the `jacob-streams` service.
* NEW: `backend/tests/test_streams.py` — the integration tests in §6.7.
* NEW: `frontend/tests/integration/streams.test.ts` — frontend integration test against the emulator + a local FastAPI streams server.

**Single-instance cap.** `jacob-streams` deploys with `max_instances=1`, `min_instances=0`, `timeout=3600s`. M5.10 documents the path to multi-instance.

**M5.7 — reconnect/backfill (the hard part).** Already specified in §6.4.1. Reproduced here as an acceptance criterion: a client that disconnects for 30 minutes and reconnects must either (a) receive every event since `Last-Event-ID` or (b) receive a `backfill.gap` event. Test 6.7.2 covers it.

**M5.10 — Redis fanout (deferred design).** When M5 hits a real load wall (DESIGN-OPEN: pick a threshold — maybe 200 concurrent SSE clients per Cloud Run instance, or a memory-pressure trigger), the realtime service stops opening per-client Firestore listeners and instead:

1. Each Cloud Run instance opens a single Firestore listener per active group.
2. The listener publishes events to a Redis Pub/Sub channel `jacob:groups:{gid}:events` on Memorystore.
3. Per-client SSE handlers `SUBSCRIBE` to the Redis channel and forward.
4. Multi-instance topology: events fan out to every instance via Redis; each instance forwards to its connected clients.

Cost: Memorystore Standard, smallest tier (1GB), ~$50/month. Not in M5 scope.

**Acceptance criteria.**

* On a chat page, a message sent from another browser appears within 1 second in the receiving browser.
* Disconnect (close laptop) → reconnect 5 minutes later → receive any messages that arrived during the disconnect.
* Disconnect for 1 hour → reconnect → receive `backfill.gap` event → hook re-fetches via REST and re-subscribes.
* SSE works behind uBlock Origin (manual verification, since the path is `/api/streams/*` and same-origin).
* Heartbeat fires every 25 seconds during idle (verifies cloud proxy timeouts don't kill the connection).
* `pytest backend/tests/test_streams.py` — 5+ test cases.
* `vitest frontend/tests/integration/streams.test.ts` — 3+ test cases.

**Test plan.** Per §6.7.

**Rollback plan.** Two-step revert: (1) revert the frontend hook wiring (chat returns to M4 polling); (2) revert the backend streams router (Cloud Run service stays deployed but unreferenced — clean up later). **Data integrity:** SSE doesn't write data; revert is fully clean.

**One-line risk note.** "If M5 fails: chat realtime breaks but the M4 polling fallback still works — degraded UX, not broken UX. Revert is safe."

### 7.6 M6 — Phase F: cleanup

**Why last.** With every read and write API-mediated, M6 deletes `firebase/firestore` from the bundle, tightens rules to default-deny, and finishes test cleanup.

**Branch.** `claude/m6-cleanup`.

**Files touched.**

* MODIFIED: `frontend/lib/firebase.ts`:
  * Drop `getFirestore`, `connectFirestoreEmulator`, the `firestore` export.
  * Keep `getAuth` and `getStorage` (auth tokens + uploads still use the SDK).
* MODIFIED: `frontend/package.json`:
  * Move `firebase` from `dependencies` to `devDependencies` IF the test files still need it. Better: keep it where it is (still used for auth + storage) and let `bundle-analyzer` confirm `firebase/firestore` is no longer in the chunk.
* DELETED: `frontend/lib/offline-cache.ts` — the IndexedDB cache for messages. After M5, the SSE backfill mechanism replaces offline cache. **DESIGN-OPEN: keep offline cache as a UX nicety for poor connections? See §12.OQ7.**
* MODIFIED: `frontend/tests/*` — replace any test that mocks `firebase/firestore` with mocks of the new `apiGet`/`apiPost` helpers.
* MODIFIED: `firestore/firestore.rules`:
  * `match /groups/{gid}` — `allow read: if false;` (was: `isGroupMember(gid) || isPublic`). All client reads now go through `/api/groups/{gid}`.
  * `match /groups/{gid}/members/{uid}` — `allow read: if false;` for direct, but **keep the CG-`members` rule at `:438-441` because we may still want admin tools to query directly. DESIGN-OPEN.**
  * `match /groups/{gid}/messages/{mid}` — `allow read, write: if false;`.
  * `match /groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}` — `allow read, write: if false;`.
  * `match /users/{uid}` — `allow read: if false;` (the `users/me/bootstrap` is the only authorized reader).
  * `match /users/{uid}/mutes/{otherUid}`, `/blocks/...`, `/notificationPrefs/main`, `/notifications/{nid}` — all `allow read, write: if false;` (or keep readAt update for in-place compat — see §12).
  * `match /stickers/{sid}` — `allow read: if false;` (only `/api/stickers` reads).
  * `match /daily_verse/{day}` — `allow read: if false;`.
  * `match /boards/...` — same, all reads go through `/api/boards/...`.
  * Keep all the existing backend-only collection rules as-is.
* MODIFIED: `firestore/tests/*.rules.test.ts` — invert the read-allow tests to read-deny tests for everything that used to allow client reads.
* MODIFIED: `CLAUDE.md` — update the "architectural rule of thumb" to reflect the new "everything via FastAPI" default.
* DELETED: `frontend/lib/firestore.ts` if it exists (it doesn't; verified).
* MODIFIED: `frontend/middleware.ts` — leave as-is. The cookie contract is preserved.
* NEW: `backend/scripts/lint_writes_have_not_banned.py` — CI lint that fails the build if a `POST/PATCH/DELETE` route is missing `Depends(require_not_banned)` (with an allow-list for the few endpoints where banned users are permitted, e.g. `DELETE /api/users/me/mutes/{uid}`). Wire into `.github/workflows/ci.yml`.

**Acceptance criteria.**

* `grep -rn "from \"firebase/firestore\"" frontend/lib frontend/components frontend/app frontend/middleware.ts` returns ZERO matches outside test files. **This is the headline pass criterion.**
* Bundle analyzer confirms `firestore` is not in the production frontend chunks.
* Rules tests still pass (with their inverted assertions).
* No regression in any existing acceptance criterion.

**Test plan.** Smoke-test every page behind uBlock Origin. Run the entire rules-test suite. Run the entire backend test suite. Run the entire frontend test suite.

**Rollback plan.** Revert. Rules go back to permissive, frontend code goes back to using the (still-present) `firestore` export. Bundle gets bigger again. Functionally identical.

**One-line risk note.** "If M6 fails: rules-tightening might break a forgotten direct-Firestore call site somewhere; revert and grep more carefully."

### 7.7 Out-of-band cleanups (do not block phases)

The Phase 2 review identified several issues that overlap this migration's scope. The migration **does not** fix them; they are tracked as separate PRs. I list them so reviewers know they're remembered:

* C2 (missing Firestore indexes for discover, invites, devices cleanup, digest, archived filter) — independent of this migration; track as a DEV_PLAN entry.
* C3 (invite-code global uniqueness) — M4's invite-create endpoint can opportunistically tighten the code length to ≥12, but the global-uniqueness fix is its own task.
* C5 (trigger idempotency for `onMessageCreate`, `onBoardPostCreate`, `mentionFanout`) — independent.
* H7 (digest enumerates all groups per user) — independent.
* L7 (offline cache leaks hidden message bodies) — M6 may delete offline cache entirely; if not, fix in M6.

---

## 8. SSE vs WebSocket decision

**Recommendation: Server-Sent Events (SSE).** Use it for `/api/streams/groups/{gid}` and `/api/streams/notifications`. Do not use WebSocket.

### 8.1 What we need from the transport

The chat realtime channel has three requirements:

1. **Server → client push.** Sub-second delivery of new messages, reactions, edits.
2. **Reliable reconnect.** Close laptop, reopen, get the messages we missed.
3. **Survives proxies, adblockers, corporate networks.** This is the entire reason for the migration.

It does **not** need:

* Bidirectional streaming. The client → server direction is already covered by REST POSTs. We never need to push from client to server within the lifetime of a single connection — sends use a regular `fetch` to `POST /api/groups/{gid}/messages`.
* Binary frames. Everything we push is JSON.
* Sub-100ms delivery. 200ms is fine; chat isn't a game.

### 8.2 SSE strengths

* **Plain HTTP/1.1 or HTTP/2.** No protocol upgrade. Goes through every CDN, proxy, and corporate firewall that allows HTTPS, which is essentially all of them.
* **Adblockers don't touch same-origin `/api/*` paths.** EasyPrivacy, EasyList, and Brave's default lists never block first-party paths because the false-positive rate would be unbearable. SSE on `/api/streams/*` is invisible to them.
* **Built-in reconnect.** EventSource (and the polyfill) auto-reconnects with `Last-Event-ID`. Backfill semantics are baked into the spec.
* **Cloud Run native support.** No special configuration; the response is just a long-lived chunked HTTP response. Set `timeout=3600s`. Done.
* **Cheap to implement.** ~150 lines of backend code (§6.1.1) + ~80 lines of client (§6.1.2). No new infra in M5.
* **Stateless on the wire.** Each event is self-contained JSON. Debugging is `curl -N -H "Authorization: Bearer ..." /api/streams/groups/{gid}` — you can read the events in your terminal.

### 8.3 WebSocket considered

For the record, I considered WebSocket. It would work. It would also be wrong for our case.

* **The only thing WebSocket gives you that SSE doesn't is bidirectional streaming.** We don't need it. Sends are POSTs.
* **WebSocket requires protocol upgrade (`Upgrade: websocket`).** Some corporate proxies strip the upgrade header. Not all, but enough that we'd see real users locked out — the same kind of failure mode the migration is trying to fix.
* **Cloud Run supports WebSocket** (since 2022) but it's quirkier than SSE: you have to handle ping/pong, the timeout interaction is murkier, and the proxy buffering story is the same as SSE so there's no advantage there.
* **Adblockers occasionally block WebSocket** — there's a long tail of EasyPrivacy entries blocking `wss://*.googletagmanager.com/...` and similar tracking-WSS endpoints. Same-origin first-party `wss://` is generally fine, but the failure mode if it gets misclassified is worse than SSE: SSE just falls back to polling-via-EventSource-retry; a blocked WS upgrade looks like a hung connection.
* **WebSocket's binary efficiency doesn't help a JSON workload.** SSE's per-event overhead (`event: ...\nid: ...\ndata: ...\n\n`) is ~40 bytes; WebSocket's frame overhead is ~6 bytes. For a 200-byte chat message, WS is 3% smaller. Not material.
* **WebSocket's bidirectional shape is a footgun for stateful protocols.** It invites you to design "send a message over the WS" which then duplicates the REST POST endpoint and creates a two-channel auth/audit/rate-limit story. SSE forces the simple shape: pushes go one way; mutations go via REST.

### 8.4 Per-stream decision

| Stream | SSE? | Why |
|---|---|---|
| Group chat (`/api/streams/groups/{gid}`) | ✅ SSE | The hot path. SSE wins on every dimension. |
| Notifications (`/api/streams/notifications`) | ✅ SSE | Per-user; small fan-out. SSE is even better-suited here. |
| Boards (`/api/streams/boards/{boardId}`) | ❌ Polling | Lower-frequency. 30s polling is fine. SSE not justified by the traffic. |
| Member list updates | ✅ multiplexed onto group SSE | No second connection. |
| Pinned messages | ✅ multiplexed | same |
| Group archive state | ✅ multiplexed | same |

### 8.5 The fallback

If the SSE endpoint fails (server returns 5xx, network lost, browser doesn't support EventSource — basically only IE which we don't support), the frontend falls back to the polling path from M3. The hook's contract is identical; only the latency and bandwidth differ.

This is a graceful, low-effort fallback because **M3 ships polling first; M5 adds SSE on top**. If M5 ever needs to be temporarily disabled, the streams endpoints can return 503 and the polling path takes over. No client code change needed.

### 8.6 What if Cloud Run's SSE story changes

Cloud Run support for long-lived connections has been stable since 2023. The 60-minute hard request-timeout is the current ceiling; we set 60 minutes and rely on the client to reconnect. If Google ever tightens this (unlikely), the M5.10 Redis fanout migration becomes mandatory rather than optional, but the SSE wire format stays identical.

---

## 9. Cost & performance impact

This section is the resource-budget honest accounting. Numbers are estimates rooted in the existing infra; I flag where I'm guessing vs. where there's a sturdy basis.

### 9.1 Egress and bandwidth

Cloud Run egress is billed per GB out. The migration's egress profile depends on whether SSE saves bytes vs. the JS Firestore SDK.

**Today:** the Firestore JS SDK pulls full message documents on every snapshot fire — if a 100-byte message gets a thread reply, Firestore re-fires on the message doc with the full body (because the doc changed). Chat is dominated by per-event costs.

**Post-migration:** SSE events are smaller per-event (we send only the changed fields in `message.updated` events) but require an HTTP/2 stream framing per event. Net: roughly even, possibly 10-20% smaller egress per message-event. Not material.

**Numbers (very rough).**

* 100-message chat session, average message ~250 bytes, 50 reactions, 5 edits, 5 deletes.
* Today's snapshot push: ~30 KB of Firestore wire format + ~10 KB SDK overhead = 40 KB.
* SSE push: 100 message-events × ~250 bytes JSON + 50 reaction-events × ~150 bytes + 10 edit/delete × ~80 bytes = ~33 KB. Plus heartbeats: ~80 bytes × 60s × session-minutes.
* For a 30-minute chat session: SSE total ~33 KB events + ~5 KB heartbeats = 38 KB. Comparable to today.

Cloud Run egress costs are ~$0.12 per GB. We are nowhere near the regime where this matters.

### 9.2 Firestore reads/writes

**Today:** every onSnapshot is one persistent listener. Listener pricing: same as document-read pricing, but Firestore charges only for changed documents per fire.

**Post-migration with the per-client backend listener (M5 default):** N clients on a group means N backend listeners on the same query. Firestore charges per document-read per listener. So with 50 clients, every message write costs 50 reads, not 1.

This is the **single non-trivial cost line** in the migration.

**Quantification:**

* Pre-migration: 1 listener per client per group × M groups the client is in. Listener overhead per write: 1 doc read.
* Post-migration: N backend listeners per group × N concurrent clients. Listener overhead per write: N doc reads.

If we get to 10 active groups × 50 average concurrent listeners = 500 backend listeners. A burst of 100 messages/minute across all groups = 100 writes × 50 listeners per group on average = 5,000 reads/minute = 7.2M reads/day = ~$2.20/day at $0.06/100k reads.

**Tolerable for v1.** Not tolerable at 10x scale. M5.10's Redis fanout fixes it. Trigger to migrate: **monthly Firestore read bill > $200** (DESIGN-OPEN: pick the right threshold).

### 9.3 Cloud Run costs

Cloud Run charges per CPU/memory per request-second. SSE connections are long-lived but mostly idle (most of the time, no event is being processed; the connection is just open).

* Idle-connection cost: ~$0 (Cloud Run charges for active CPU; idle is ~free).
* Memory: each open SSE connection consumes ~50-100 KB of process memory + Python's per-thread overhead (~500 KB). At 500 connections that's ~250 MB. Smallest Cloud Run instance is 512 MB. **We're at the upper bound for the smallest profile.** M5.10 may need to bump to 1 GB ($X/month delta) earlier than the Firestore-listener pressure forces it.
* CPU: per-event CPU is trivial (~1 ms of JSON serialization). Not a constraint.

Estimate Cloud Run streams service cost for v1 traffic: $5-15/month. Same order of magnitude as today's "main API" service.

### 9.4 Latency

p50 latencies, end-to-end (client send → recipient render):

| Path | p50 today | p50 M3 (polling) | p50 M5 (SSE) |
|---|---|---|---|
| Chat send → render on sender's screen | ~150ms (Firestore local commit, then UI render) | ~250ms (REST POST) | ~150ms (optimistic UI from §7.4) |
| Chat send → render on recipient's screen (same network) | ~250ms (Firestore push) | ~5,000ms (10s poll mean ~5s) | ~250ms (SSE push) |
| Reaction toggle visible to others | ~250ms | ~5,000ms | ~250ms |
| Group settings change visible to other leaders | ~500ms | ~5,000ms (SWR refresh) | ~500ms (SSE) |

**M3's polling regression is real and observable.** The migration deliberately accepts it as a transient cost. The PR description for M3 must say so.

p99 numbers tail off ~3-5x; specifically, Cloud Run cold starts on the streams service can add 1-2s to a reconnect. Acceptable; users almost never see this because reconnects come from already-warm instances unless the service has been idle for >15 min.

### 9.5 Backend memory pressure

Already covered in §9.3. The single-instance topology in M5 means a single Cloud Run pod must hold every SSE listener. At 500 listeners we're near the 512 MB ceiling. M5 acceptance test is "load test 100 simulated SSE clients on one group; verify backend memory stays sub-50%."

If the test fails, the response is one of:

* Bump the streams instance to 1 GB / 2 GB.
* Move the listener orchestration to Redis-fanout earlier (M5.10 → M5.5).

### 9.6 Frontend bundle size

`firebase/firestore` is roughly 250 KB minified, ~85 KB gzipped of the production bundle. Removing it in M6 is a real bundle-size win. The new `apiGet/apiPost` helpers are <10 KB. Net: **~75 KB gzipped saved**, which on a 3G connection is ~0.6 s of TTI improvement. Not the headline benefit; nice to have.

### 9.7 What I am NOT modeling

* **Search.** Already on the backend. No change.
* **Photo uploads.** Already on the backend. No change.
* **Account deletion.** Already on the backend. No change.
* **Cron jobs and triggers.** Already on the backend. No change.

The migration touches only the data-plane reads/writes between the browser and Firestore.

---

## 10. Testing strategy

The migration's surface is wide enough that ad-hoc testing will leak bugs. This section defines what each phase tests, how, and what counts as "green."

### 10.1 The four test surfaces

Across the project, four kinds of tests live in four directories. The migration adds work in each.

| Surface | Location | Runner | Scope |
|---|---|---|---|
| Backend unit + integration | `backend/tests/` | pytest | FastAPI handlers, deps, services. Mocks `firebase_admin` at module level. |
| Frontend unit | `frontend/tests/` | vitest + RTL | Hooks, components. Mocks `apiGet/apiPost`. |
| Frontend integration | `frontend/tests/integration/` | vitest + Firestore emulator + a local FastAPI server | End-to-end: real backend, real Firestore. |
| Firestore rules | `firestore/tests/*.rules.test.ts` | `@firebase/rules-unit-testing` against the emulator | Rule predicates. |

CI runs all four on every PR (`.github/workflows/ci.yml`). The migration does not change the runner; it changes the contents.

### 10.2 Per-phase test plan

#### M1 (stickers + verse)

* **Backend pytest** — new `backend/tests/test_stickers.py`, `test_verse.py`. Cases: 200 happy path, 401 missing token, 503 Firestore down, audience filter, ETag round-trip.
* **Frontend vitest** — `useStickers` and `useDailyVerse` mocked-`apiGet` tests.
* **Manual smoke** — uBlock Origin loads stickers and verse.
* **Rules tests** — unchanged in M1.

#### M2 (profile + bootstrap)

* **Backend pytest** — `test_users.py`, `test_users_bootstrap.py`, `test_users_devices.py`, `test_users_notifications.py`. Cases per §7.2 acceptance tests.
* **Frontend vitest** — `useUser` mocked-`apiGet`; `useDeletionStatus` poll-on-fake-timers; `useExportStatus` poll-on-fake-timers; `useMutes` and `useBlocks` write-then-refetch.
* **Frontend integration** — `frontend/tests/integration/m2-onboarding.test.ts`: spin up backend with emulator, perform onboarding through `ProfileForm`, assert the cookie is set, assert middleware doesn't redirect.
* **Manual smoke** — uBlock Origin completes onboarding.
* **Rules tests** — unchanged. (Rules still enforce identical predicates because the JS SDK still works for clients that aren't yet using the new endpoints — the migration is rolling, not a hard cutover.)

#### M3 (group reads)

* **Backend pytest** — `test_messages_read.py`, `test_members.py`, `test_my_groups.py`, `test_pinned_messages.py`. Pagination cases: empty page, full page, partial page, invalid cursor (422), cursor for a different group (403).
* **Frontend vitest** — every migrated hook mocked-`apiGet` test. Polling-on-fake-timers verifies the 10s poll interval for `useGroupMessages`.
* **Frontend integration** — `m3-chat-poll.test.ts`: send a message via the (still-Firestore-direct) `MessageInput`, assert it appears in `useGroupMessages` within 15s (10s poll + 5s slack).
* **Rules tests** — unchanged in M3.

#### M4 (writes)

* **Backend pytest** — write endpoint tests (`test_messages_write.py`, `test_messages_edit.py`, `test_messages_delete.py`, `test_reactions.py`, `test_boards_write.py`). Coverage:
  * shape errors → 422 (every Pydantic validator fires).
  * authz errors → 403 (every dep fires).
  * state errors → 409 (edit-window-expired, soft-delete idempotent, archive blocks write).
  * rate-limit → 429 (every limit triggers cleanly at the boundary).
  * audit log written for `message.delete`.
  * 15-minute edit window: time-travel the system clock with `freezegun`, verify boundary at 14:59 (allowed) and 15:00 (denied).
  * idempotent soft-delete: call DELETE twice; both 200; second is a no-op.
* **Frontend vitest** — every migrated component's send action invokes the right `apiPost` shape.
* **Frontend integration** — `m4-send-message-end-to-end.test.ts`: send via `MessageInput`, assert the message appears in `useGroupMessages` polling refresh within 15s.
* **Rules tests** — unchanged in M4. (Rules still enforce predicates for any client that *does* still write directly. M4 stops the frontend from doing that, but doesn't relax the rules.)

#### M5 (SSE chat)

This is the most subtle phase; it gets the most testing investment.

* **Backend pytest** — `test_streams.py`. Cases:
  * Open a stream, post a message via REST, assert the SSE client receives `message.created` within 1s.
  * Send a reaction, assert `reaction.added` arrives.
  * Edit a message, assert `message.updated` arrives with only the changed fields.
  * Soft-delete a message, assert `message.deleted` arrives.
  * Close the connection, post 5 messages, reconnect with `Last-Event-ID` of the pre-close last event, assert all 5 messages arrive.
  * Close the connection, post 1500 messages (more than the backfill window), reconnect, assert `backfill.gap` event arrives.
  * Idle for 30s, assert `heartbeat` event arrives.
  * Authz: open a stream for a group the user isn't a member of, assert 403.
  * Authz: open a stream as a banned user — pass (banned users can still read).
* **Frontend integration** — `streams.test.ts`. Cases:
  * Subscribe, send a message via REST, assert hook state updates within 1s.
  * Simulate network drop via `AbortController`, assert auto-reconnect within 5s.
  * Verify dedup: `apiPost` returns the new message AND the SSE event with the same id arrives shortly after; the hook's `messages` array contains exactly one entry for that id.
  * Verify ordering: send messages with `createdAt` colliding (microsecond-tied), assert lexicographic-on-`mid` tiebreaker.
* **Load test** — `backend/tests/load/sse_load.py`, run manually: 100 simulated SSE clients on one group; verify backend memory stays under 256 MB and response time under 1s.
* **Manual smoke** — open chat in two browsers, send a message in one, see it land in the other within 1s.
* **Rules tests** — unchanged in M5.

#### M6 (cleanup)

* **Frontend grep gate** — CI step `grep -rn "from \"firebase/firestore\"" frontend/lib frontend/components frontend/app frontend/middleware.ts` returns zero matches. The M6 PR's CI workflow asserts this.
* **Bundle analyzer gate** — CI step runs `next build` then `pnpm exec next-bundle-analyzer` and asserts `firestore` is not in the production chunk. (DESIGN-OPEN: do we wire this into CI or do it manually? See §12.OQ4.)
* **Rules tests** — invert. Each test that previously asserted "client X can read collection Y" becomes "client X cannot read collection Y." This is mechanical; M6's PR description should call it out as the bulk of the diff.
* **Backend pytest** — full suite. No regression.
* **Frontend vitest** — full suite. No regression.
* **Manual smoke** — every page behind uBlock Origin.

### 10.3 Adblock testing automation

The whole migration is justified by adblocker behaviour. We should automate adblock testing rather than relying on manual checks every PR.

**Approach:** add a Playwright test target that runs Chromium with uBlock Origin pre-installed. Loads the homepage; signs in via a fixture user; navigates through onboarding; reaches `/groups`. Asserts no `firestore.googleapis.com` request was made in the network trace.

**Cost:** Playwright + uBlock setup is ~50 lines of CI config + ~100 lines of test code. **DESIGN-OPEN:** Do we add this in M2 (where the adblock symptom is fixed) or M6 (where it's strictly enforced)? My preference: add in M2 as a "smoke" lane, escalate to "required" in M6.

### 10.4 What's NOT being tested

* **Cross-instance SSE consistency.** M5 ships single-instance. Multi-instance only exists if M5.10 is implemented. We test single-instance.
* **High-concurrency reactions.** Phase 2 review didn't flag reaction storms as a real bug source. Skipping the load test for v1.
* **Real-network adblockers.** Playwright with uBlock is a proxy; actual users may have different adblock configs. Manual verification still applies for the M2 acceptance criterion.
* **Mobile network conditions.** The hooks should be resilient; explicit "slow 3G" tests are not in the phase's scope. Add later.

### 10.5 Test ownership

* `backend/tests/` — backend pytest is the owner of all FastAPI behaviour tests.
* `frontend/tests/` — vitest is the owner of all hook + component behaviour.
* `firestore/tests/` — rules tests are the owner of who-can-do-what at the Firestore level. Even when the client doesn't read directly, the rule still defends against a future regression that re-introduces a direct read. **Rules tests are NOT optional, even after M6.**
* `frontend/tests/integration/` — the trustworthy oracle for end-to-end behaviour. Every phase ships at least one integration test that exercises the new code path against the emulator + a local backend.

### 10.6 CI configuration changes

The current CI (`.github/workflows/ci.yml`) runs:

* `pnpm lint`
* `pnpm typecheck`
* `pnpm test` (vitest)
* `pnpm exec firebase emulators:exec --only firestore "pnpm rules:test"`
* `cd backend && pytest`

The migration adds:

* M1+: integration test job that brings up the Firestore emulator + a local FastAPI process and runs the integration suite. Runs on PRs that touch backend or `frontend/tests/integration/`.
* M2+: optional Playwright + uBlock smoke job (manual trigger initially; required by M6).
* M6: grep gate + bundle analyzer.

CI runtime budget: the current pipeline runs in ~6 minutes. Integration tests add ~3 minutes; Playwright adds another 4. **Total ~13 minutes by M6.** Acceptable; if it gets worse, parallelize.

### 10.7 Coverage targets

Pragmatic. Per CLAUDE.md, "light, pragmatic, focused on behaviour." Not coverage targets in the strict sense, but the target *behaviours* per phase are listed in the per-phase test plans above. Reviewer should pattern-match against those lists rather than against a coverage percentage.

---

## 11. Rollback

Every phase is designed to be revertible without manual data cleanup. This section is the explicit playbook per phase.

### 11.1 Universal rollback principles

These hold for every phase.

* **Use `git revert`, not `git reset`.** Migration PRs squash-merge to `main`; reverts are single commits that undo the migration commit, leaving history clean.
* **Don't revert across multiple phases at once unless you have to.** Each phase's revert is independently safe. A multi-phase revert is a bigger change that may interact in surprising ways.
* **Don't manually clean up Firestore data on revert.** The migration writes the same documents that the prior client-side path would have. Revert restores the prior path; existing docs remain valid.
* **Cookies expire on their own.** Even if M2 is reverted while users have the new server-set cookie, the cookie just stays valid (`Max-Age` for the JACOB cookie is session-bounded; M2 doesn't set a long expiry — verify this in the M2 implementation).
* **Cloud Run services that aren't referenced are zero-cost.** If you revert M5 but leave the `jacob-streams` Cloud Run service deployed, it idles at zero cost (`min_instances=0`). Tear it down later when you're sure.

### 11.2 Per-phase rollback

#### M1 rollback

```bash
# On the merge commit C of M1:
git revert C
git push origin main
# Deploy.
```

* **Effect:** stickers and daily verse return to direct-Firestore reads. Adblocker users break for those two endpoints.
* **Data integrity:** none affected; M1 didn't write data.
* **Cleanup:** none.

#### M2 rollback

```bash
git revert <m2-merge-sha>
git push origin main
# Deploy backend (the new endpoints become unreachable but the route definitions go away).
# Deploy frontend (hooks return to onSnapshot).
```

* **Effect:** profile, mutes, blocks, deletion-status, export-status, notifications-prefs, devices, onboarding return to client-side Firestore. Adblocker users break onboarding again.
* **Data integrity:** profile docs created via the new endpoint are valid Firestore docs identical to what `setDoc` would have written (same fields, same shape, same timestamps). They just keep working.
* **Cookies:** the `jacob-has-profile` cookie set server-side stays in the browser until session end. The reverted client still writes the same cookie, so they don't conflict. **Verify in the M2 implementation that the server-set cookie's name and value exactly match the prior client-set cookie ("1") to avoid drift.**
* **Cleanup:** none.

#### M3 rollback

```bash
git revert <m3-merge-sha>
git push origin main
# Deploy.
```

* **Effect:** group, members, pinned, messages-read, board reads return to direct Firestore listeners. Latency improves (back to sub-second) but adblocker users break those reads again.
* **Data integrity:** no writes happened during M3 reads.
* **Cleanup:** none.

#### M4 rollback

```bash
git revert <m4-merge-sha>
git push origin main
# Deploy.
```

* **Effect:** all writes return to direct-Firestore client SDK calls. Adblocker users break writes.
* **Data integrity:** Every write that landed via the new endpoints wrote a Firestore doc identical in shape to what `addDoc / setDoc / updateDoc` would have written. Specifically:
  * `groups/{gid}/messages/{mid}` docs: same field set as the `firestore.rules:325-328` allow-list.
  * `groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}` docs: just `{reactedAt}`, identical to what the rules allowed on direct write.
  * `users/{uid}/mutes/{otherUid}`, `/blocks/...`: `{mutedAt}` / `{blockedAt}` only.
  * Audit-log writes (`audit_log/{eventId}`) created during M4 stay valid; they're additional metadata that nothing breaks on if the migration is reverted.
* **Cleanup:** none.

#### M5 rollback

The most subtle revert because two services are involved.

```bash
git revert <m5-merge-sha>
# This reverts:
#  - frontend hook wiring (back to M3-M4 polling)
#  - backend streams router registration
git push origin main
# Deploy main API + frontend.
# Cloud Run streams service: leave deployed but unreferenced. It idles at zero cost.
# Delete it later via terraform once you're confident.
```

* **Effect:** SSE goes away; chat returns to 10s polling from M3.
* **Data integrity:** SSE didn't write anything; no impact.
* **Cleanup:** the `jacob-streams` Cloud Run service can be deleted later (`terraform destroy -target=google_cloud_run_service.jacob_streams` plus the `firebase.json` rewrite rule) — not urgent.

#### M6 rollback

```bash
git revert <m6-merge-sha>
git push origin main
# Deploy.
```

* **Effect:** `firebase/firestore` returns to the bundle. Rules return to permissive. Functionally identical because no caller actually uses the SDK anymore (M2-M4 already removed the callers); M6 just deletes the now-unused export and tightens rules.
* **Data integrity:** rules tightening was a defense-in-depth tightening; reverting it just re-allows what the SDK was no longer doing. No data invariant breaks.
* **Cleanup:** none.

### 11.3 Partial rollback within a phase

If a single new endpoint is found to be broken post-merge but the rest of the phase is fine, the playbook is:

1. Open a hotfix PR that reverts just the broken endpoint's frontend caller (the hook returns to `firebase/firestore` calls for that one path).
2. Leave the backend endpoint in place; it's idle but harmless.
3. Fix the bug in a follow-up; reland the frontend caller switch.

This is preferable to reverting the full phase merge because the rest of the phase's work doesn't get re-litigated.

### 11.4 Data invariants the migration must not break

Per Phase 1's `docs/data-model.md` (referenced via CLAUDE.md), the system has a few invariants that the migration must preserve. Each phase's PR description should affirm these explicitly.

* **`groups/{gid}.memberCount` reflects actual member count.** Maintained by the existing `onMemberWrite` trigger. Migration doesn't touch the trigger.
* **`groups/{gid}.leaderCount > 0` for non-archived groups.** Maintained by the existing leader transition endpoints. M4 must not introduce a code path that creates a leaderless group.
* **`groups/{gid}/messages/{mid}.threadReplyCount` reflects actual thread reply count.** Maintained by `onMessageWrite`.
* **`audit_log` writes are append-only.** Migration adds entries; never modifies prior ones.
* **Soft-delete is one-way.** Once `deletedAt` is set, it never goes back to null.
* **Archive is two-way but transactional.** `archivedAt` toggles between null and a timestamp; never has an interim state.

### 11.5 What to monitor post-merge

For each phase:

* **Sentry error rate.** Watch for new error codes from the new endpoints (e.g., `ApiError(403, "not_a_member")`) at unexpectedly high rates. A spike of 403s suggests a frontend caller is sending the wrong gid or the membership check is wrong.
* **Cloud Logging structured logs.** Backend emits a request_id-tagged JSON line per request. Filter on `path startswith /api/` and watch p99 latency.
* **Cloud Monitoring** dashboards for Cloud Run instance memory + CPU. M5 in particular needs an SSE-connections gauge — DESIGN-OPEN: stand up a custom metric in M5 implementation.
* **Firestore usage console.** Watch for an unexpected increase in document reads (could indicate a leaky Admin SDK listener — see §6.5).

### 11.6 Recovery from a botched rollback

If a revert deploy itself fails (deploy pipeline error, partially-deployed state), the standard Phase 1 deploy runbook applies (`docs/runbooks/restore.md`). Specifically:

* Cloud Run rollback to prior revision: `gcloud run services update-traffic jacob-api --to-revisions=PRIOR=100`.
* Frontend rollback via Firebase Hosting: previous hosting release is one click in the Firebase console.
* Data is in Firestore; nothing to roll back there.

---

## 12. Open questions

Items I cannot decide unilaterally, or where the answer depends on a number we haven't measured yet. Each tagged `DESIGN-OPEN` so the M-phase implementer can grep for them. Where a recommendation is plausible, I include it; the user can ratify or override.

### OQ1. Polling vs SSE for low-frequency streams

`useDeletionStatus`, `useExportStatus`, `useBoardPosts`, `useBoardPost` all become polling hooks in §6.2. **DESIGN-OPEN:** is 30s polling acceptable for board posts, or do we want SSE there too? The argument for SSE: boards are part of the chat-feeling product and a 30s lag for new posts is conspicuous. The argument against: boards are far less frequented than chat, the SSE infrastructure is sized for chat traffic, and every additional stream costs Firestore listeners.

**Recommendation:** ship boards on polling in M3/M4, revisit in M5 retro based on observed traffic. If boards traffic is materially less than chat (likely), polling stays.

### OQ2. Admin tools — keep Firestore listeners?

The admin moderation-queue page is internal-only. Operators don't run adblockers (or shouldn't). Keeping Firestore listeners on `/admin/...` pages would save the migration work for those pages and preserve real-time UX without justifying SSE infrastructure for an audience of <10 users.

**Recommendation:** **keep direct Firestore on admin tools** for now. M6's rule tightening must except admin-readable collections (`moderation_queue` is already `if false;` so backend-only — but the admin page presumably reads via an Admin SDK call, not the JS SDK; verify in M6 implementation).

**DESIGN-OPEN:** confirm by reading `frontend/app/admin/...` pages in M6's prep work.

### OQ3. The `/api/users/me/private` endpoint

§4.3.4 stubs it; nothing currently reads it. **DESIGN-OPEN: cut from scope unless a consumer materializes by M2.** My preference: cut.

### OQ4. CI bundle-analyzer gate in M6

M6 wants a "no `firebase/firestore` in the production chunk" CI assertion. Two options:

* Wire `next-bundle-analyzer` into CI and parse its output. ~50 lines of CI config.
* Use a simpler grep on the built `.next/` directory looking for `firebase/firestore` strings in chunks. ~5 lines.

**Recommendation:** the simpler grep. It's brittle but catches the common-case regression.

### OQ5. SSE Redis fanout threshold

§9.2 picks "$200/month Firestore read bill" as the trigger to migrate from per-client listeners to Redis. **DESIGN-OPEN:** is that the right threshold? An alternative is "when a single Cloud Run instance hits 200 concurrent SSE clients" (a memory-pressure trigger).

**Recommendation:** monitor both; whichever fires first is the migration trigger. Define the SLO in M5 implementation as "SSE p99 backfill latency < 2s under load."

### OQ6. `useRecentMessages` — keep or replace

`useRecentMessages` does N getDocs calls (one per group the user is in) to build the home dashboard's "recent activity" panel. **DESIGN-OPEN:** does the dashboard panel still exist and is it valuable enough to add a new endpoint, or should we drop the panel?

**Recommendation:** ask the user. If yes, M3 adds `GET /api/users/me/recent-messages` returning the last activity in each of the user's groups. Cost: one fan-out query per request, paid by the API server.

### OQ7. Drop `frontend/lib/offline-cache.ts` in M6?

The IndexedDB cache supports offline message read. Phase 2 review L7 noted it leaks hidden message bodies. After M5+M6, the SSE backfill mechanism handles reconnect-after-disconnect; the offline cache is needed only when the user is **truly offline** (airplane mode, no network at all). **DESIGN-OPEN:** is offline-mode read a goal?

**Recommendation:** drop the cache in M6. Users who are truly offline can't send messages or get realtime updates anyway; reading stale messages from IDB is a marginal feature. If we keep the cache, M6 must filter hidden messages out of it (close L7).

### OQ8. The cookie middleware vs handler-level cookie set

§7.2.M2.5 raised both options. **DESIGN-OPEN: pick one in implementation.** My preference is handler-level (`response.set_cookie(...)` in `users.bootstrap` and `users.create_profile`).

### OQ9. Audit log for `message.edit`

§5.8 and §4.13.2 both note this. **DESIGN-OPEN:** confirm "no audit log for edit" in M4 with the user before shipping. Edit-volume is high; the trade-off is "more observability vs. more audit_log writes ($)."

### OQ10. CI lint for `require_not_banned`

§5.8 proposed a CI lint that fails on a write route missing `Depends(require_not_banned)`. **DESIGN-OPEN:** scope this into M6 or a separate task? My preference: M6 (it goes with the rules tightening), but a small separate PR is also fine.

### OQ11. Optimistic-UI replication on edit/delete

§7.4 covers optimistic send. Edit and delete are also write-then-render flows. Today's UX: the local Firestore cache reflects edits immediately. After M4, the round-trip is server-mediated. **DESIGN-OPEN:** do edit/delete need optimistic UI like send does?

**Recommendation:** yes for delete (it feels broken if a deleted message lingers for 200ms); no for edit (rare, and the form already shows a "saving..." state).

### OQ12. Do we keep `useGroups` as the home-screen list, or move to server-rendered?

The collection-group `where uid == me` query was clever; the new `GET /api/users/me/groups` serves the same data. **DESIGN-OPEN:** could we make the home screen a server component that pre-renders the group list during SSR, eliminating the client-fetch hop? This is an SSR/perf question more than a migration question.

**Recommendation:** punt to M6 retro. Too speculative for the migration.

### OQ13. Should M5 consider Firebase Realtime Database as a fanout?

Firebase RTDB is a different product from Firestore but lives in the same Firebase project. It's a real-time-only database with a websocket-based protocol. A "side-channel" RTDB listener for chat events would solve the "browser ↔ Firestore" problem because RTDB's hostname is *.firebaseio.com, which... is also frequently blocked by the same adblockers. **So no, RTDB doesn't help.** Logged here for completeness so future evaluators don't re-derive it.

### OQ14. Should the migration adopt server actions (Next.js)?

Next.js App Router supports server actions which would let the frontend call typed server functions instead of REST. They're served at `/api/actions/...` (effectively) and they'd give us same-origin first-party API for free. **DESIGN-OPEN:** is this preferable to building an explicit REST API in FastAPI?

**Recommendation:** **no.** The FastAPI backend is the system of record for non-realtime APIs (per CLAUDE.md). Splitting half the API into Next.js server actions creates a two-API-surface problem. Keep FastAPI.

### OQ15. Phase ordering — could M3 and M4 swap?

Could we ship writes (M4) before reads (M3)? **DESIGN-OPEN.** The argument for: writes are the audit-log-bearing path, where the migration matters most for observability. The argument against: writes return data that the frontend then has to display, and if reads are still on Firestore, an inconsistency window opens (the SDK may not have synced before the next read).

**Recommendation:** keep M3 before M4. Read/write inconsistency between phases is a real risk in a half-migrated state.

### OQ16. Test fixture for "behind uBlock"

§10.3 discusses Playwright + uBlock. **DESIGN-OPEN:** do we want the same automation for AdGuard, Brave Shields, Privacy Badger? Different lists block slightly different things. My recommendation: just uBlock (most popular + most aggressive).

### OQ17. Sticker freshness

§4.1.1 caches stickers in process for 5 minutes. Today's `useStickers` caches in module memory for the session lifetime. **DESIGN-OPEN:** what's the right TTL? If a sticker is retired while a user has the page open, today they keep seeing it; backend cache makes that worse by 5 minutes.

**Recommendation:** 5 minutes is fine. Stickers don't update often enough for this to matter.

### OQ18. Ban audit visibility on the user's own account

After M2, a banned user calling `GET /api/users/me/bootstrap` will get `BootstrapResponse` regardless. They can't read `bans/{uid}` directly (`firestore.rules:612` denies). **DESIGN-OPEN:** should bootstrap include `{banned: true, banExpiresAt: ...}` for transparency? Phase 1 didn't surface ban state to the user.

**Recommendation:** out of scope for this migration. Track separately.

### OQ19. The `repostOfThread` field

§2.2 mentions `repostOfThread` as a field used by `ThreadReplyInput`. **DESIGN-OPEN:** verify the field name and behaviour during M4. It's not in the rules' allow-list (`firestore.rules:325-328`), so either the rules are missing it (regression?) or the field doesn't actually exist client-side. Confirm in M4.

---

## Appendix A — File-touch summary by phase

For quick reference. Each row is a path; each column is the phase that touches it.

| File | M1 | M2 | M3 | M4 | M5 | M6 |
|---|---|---|---|---|---|---|
| `frontend/lib/firebase.ts` | | | | | | ✏️ |
| `frontend/lib/api.ts` | ✨ | | | | | |
| `frontend/lib/streams/client.ts` | | | | | ✨ | |
| `frontend/lib/streams/groupStream.ts` | | | | | ✨ | |
| `frontend/lib/push.ts` | | ✏️ | | | | |
| `frontend/lib/offline-cache.ts` | | | | | | 🗑️ |
| `frontend/lib/hooks/useStickers.ts` | ✏️ | | | | | |
| `frontend/lib/hooks/useDailyVerse.ts` | ✏️ | | | | | |
| `frontend/lib/hooks/useUser.ts` | | ✏️ | | | | |
| `frontend/lib/hooks/useDeletionStatus.ts` | | ✏️ | | | | |
| `frontend/lib/hooks/useExportStatus.ts` | | ✏️ | | | | |
| `frontend/lib/hooks/useMutes.ts` | | ✏️ | | ✏️ | | |
| `frontend/lib/hooks/useBlocks.ts` | | ✏️ | | ✏️ | | |
| `frontend/lib/hooks/useNotificationPrefs.ts` | | ✨ | | | | |
| `frontend/lib/hooks/useGroups.ts` | | | ✏️ | | | |
| `frontend/lib/hooks/useGroup.ts` | | | ✏️ | | ✏️ | |
| `frontend/lib/hooks/useMembers.ts` | | | ✏️ | | ✏️ | |
| `frontend/lib/hooks/useGroupMessages.ts` | | | ✏️ | ✏️ | ✏️ | |
| `frontend/lib/hooks/useThreadMessages.ts` | | | ✏️ | ✏️ | ✏️ | |
| `frontend/lib/hooks/useRecentMessages.ts` | | | ✏️ | | | |
| `frontend/lib/hooks/usePinnedMessages.ts` | | | ✏️ | ✏️ | ✏️ | |
| `frontend/lib/hooks/useReactions.ts` | | | | ✏️ | ✏️ | |
| `frontend/lib/hooks/useBoardPostReactions.ts` | | | | ✏️ | | |
| `frontend/lib/hooks/useInvites.ts` | | | ✏️ | | | |
| `frontend/lib/hooks/useBoards.ts` | | | ✏️ | | | |
| `frontend/lib/hooks/useBoardPost.ts` | | | ✏️ | | | |
| `frontend/lib/hooks/useBoardPosts.ts` | | | ✏️ | | | |
| `frontend/components/onboarding/ProfileForm.tsx` | | ✏️ | | | | |
| `frontend/components/chat/MessageInput.tsx` | | | | ✏️ | | |
| `frontend/components/chat/ThreadReplyInput.tsx` | | | | ✏️ | | |
| `frontend/components/chat/MessageItem.tsx` | | | | ✏️ | | |
| `frontend/components/groups/GroupSettingsForm.tsx` | | | | ✏️ | | |
| `frontend/components/groups/GroupAvatarUpload.tsx` | | | | ✏️ | | |
| `frontend/components/groups/InviteList.tsx` | | | ✏️ | | | |
| `frontend/components/boards/NewPostForm.tsx` | | | | ✏️ | | |
| `frontend/components/boards/NewReplyForm.tsx` | | | | ✏️ | | |
| `frontend/app/groups/[gid]/chat/page.tsx` | | | ✏️ | | | |
| `frontend/app/groups/[gid]/settings/page.tsx` | | | ✏️ | | | |
| `frontend/app/groups/[gid]/settings/invites/page.tsx` | | | ✏️ | | | |
| `frontend/app/groups/[gid]/members/page.tsx` | | | ✏️ | | | |
| `frontend/app/groups/[gid]/analytics/page.tsx` | | | ✏️ | | | |
| `frontend/app/(authed)/settings/notifications/page.tsx` | | ✏️ | | | | |
| `backend/app/routers/stickers.py` | ✨ | | | | | |
| `backend/app/routers/verse.py` | ✨ | | | | | |
| `backend/app/routers/users.py` | | ✨ | | ✏️ | | |
| `backend/app/routers/messages.py` | | | ✨ | ✏️ | | |
| `backend/app/routers/members.py` | | | ✨ | | | |
| `backend/app/routers/streams.py` | | | | | ✨ | |
| `backend/app/routers/groups.py` | | | ✏️ | ✏️ | | |
| `backend/app/routers/boards.py` | | | ✏️ | ✏️ | | |
| `backend/app/services/messages.py` | | | | ✨ | | |
| `backend/app/services/realtime.py` | | | | | ✨ | |
| `backend/app/middleware/cookie.py` | | (✨ or skip) | | | | |
| `backend/app/deps.py` | | ✏️ (require_not_banned) | ✏️ (require_member, require_leader) | ✏️ | | |
| `backend/app/limits.py` | | | | ✏️ | | |
| `backend/app/main.py` | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ | |
| `backend/Dockerfile.streams` | | | | | ✨ | |
| `firebase.json` | | | | | ✏️ (rewrite) | |
| `firestore/firestore.rules` | | | | | | ✏️ (tighten) |
| `firestore/tests/*.rules.test.ts` | | | | | | ✏️ (invert) |
| `infra/cloudrun.tf` (verify name) | | | | | ✏️ (jacob-streams) | |
| `CLAUDE.md` | | | | | | ✏️ |
| `.github/workflows/ci.yml` | | (Playwright?) | | | | ✏️ (grep gate) |

Legend: ✨ new, ✏️ modified, 🗑️ deleted.

---

## Appendix B — Quick-reference glossary

For the next reader who lands here cold.

* **Adblock breakage** — uBlock Origin, AdGuard, Brave Shields, Privacy Badger block `firestore.googleapis.com` by default. JACOB's frontend currently fails silently on these clients. The migration's purpose is to fix this.
* **Bootstrap cookie** — `jacob-has-profile`, set in the browser today by `useUser.ts`. Read by `frontend/middleware.ts` to decide whether to redirect to onboarding. Not a security boundary.
* **CG query** — collection-group query. Firestore feature that queries across all subcollections with the same name. Used by `useGroups` for "all groups I'm in." After M3 it's a backend-only Admin SDK call.
* **Cloud Run** — Google's serverless container product. Hosts the FastAPI backend. Supports SSE natively up to 60-minute request lifetimes.
* **`onSnapshot`** — Firestore JS SDK function for realtime listeners. The thing the migration is replacing.
* **Phase letter and task ID** — M1 through M6 = phase + PR letter. Stable identifiers for cross-referencing across the plan.
* **Rules predicate** — a clause in `firestore.rules` that gates a read or write. The migration ports each predicate to either a FastAPI dep, a Pydantic validator, or an inline handler check. See §5.
* **SSE** — Server-Sent Events, RFC 8895 / W3C `text/event-stream`. One-way push from server to client. The choice for the realtime channel.
* **Streams router** — `backend/app/routers/streams.py`. Owns `/api/streams/*`. Deploys as a separate Cloud Run service in M5 to isolate long-lived connections.

---

## Appendix C — PR description template per phase

Every phase's PR should include the same body shape so reviewers can pattern-match. The template below is the M1 example; copy and adapt per phase.

```markdown
## M1 — stickers + daily verse migration

Closes the Phase A pilot of the [data layer migration plan](docs/data-layer-migration-plan.md).
Replaces direct Firestore client reads with `GET /api/stickers` and `GET /api/daily-verse`.

### Why
The frontend's `useStickers` and `useDailyVerse` hooks call the Firestore JS SDK,
which adblockers (uBlock Origin, AdGuard, Brave Shields, Privacy Badger) block.
This PR is the lowest-risk pilot of the migration.

### What changed
- New `backend/app/routers/stickers.py` and `verse.py`.
- New `backend/app/models/stickers.py` and `verse.py`.
- New `frontend/lib/api.ts` typed fetch wrapper (foundation for later phases).
- `useStickers` and `useDailyVerse` hooks switched to `apiGet`.
- pytest + vitest coverage for the new endpoints + hooks.

### Acceptance criteria
- [ ] `useStickers()` returns the same data behind uBlock Origin.
- [ ] `useDailyVerse()` returns the same data behind uBlock Origin.
- [ ] `pytest backend/tests/test_stickers.py backend/tests/test_verse.py` passes.
- [ ] `vitest frontend/lib/hooks/__tests__/useStickers.test.ts` passes.
- [ ] CI green: lint, typecheck, tests, rules tests.
- [ ] No `firebase/firestore` import in `useStickers.ts` or `useDailyVerse.ts`.

### Manual smoke
- [ ] Install uBlock Origin in Chrome.
- [ ] Load the app, sign in, go to a chat page.
- [ ] Confirm stickers render in the picker.
- [ ] Confirm daily verse renders on the home dashboard.

### Rollback
`git revert <merge-sha>` is sufficient. No data migration. See plan §11.M1.
```

Per-phase deltas:

* M2 PR: same template, plus a "🚨 cookie behaviour" callout explaining the bootstrap-cookie move from client to server.
* M3 PR: same template, plus a "📉 known latency regression — chat polling is 10s; M5 fixes it" disclaimer.
* M4 PR: same template, plus a "📋 audit log additions" section listing the new audit-log actions.
* M5 PR: same template, plus a "⚠️ new Cloud Run service" callout with deploy/rollback steps for `jacob-streams`.
* M6 PR: same template, plus a "🧹 rules tightening — invert allow→deny" section listing every rule that flipped.

---

## Appendix D — Code skeletons for new deps and helpers

Reference snippets for the M2-M5 implementer to copy-and-adapt. Not authoritative; the actual implementation lives in the PRs.

### D.1 `MembershipContext` and the membership deps

```python
# backend/app/deps.py — append in M3

from dataclasses import dataclass
from typing import Literal

from firebase_admin import firestore as fb_firestore
from fastapi import Depends, HTTPException

from app.exceptions import APIError
from app.deps import CurrentUser, get_current_user

@dataclass(frozen=True)
class GroupDoc:
    gid: str
    name: str
    is_private: bool
    archived_at: object | None  # datetime
    archived_by: str | None
    member_count: int
    leader_count: int
    pinned_message_ids: list[str]
    sticker_set: str
    join_mode: Literal["open", "request", "invite"]
    audience: str | None
    created_by: str
    founder_uid: str
    avatar_url: str | None

    @classmethod
    def from_snapshot(cls, snap) -> "GroupDoc":
        d = snap.to_dict() or {}
        return cls(
            gid=snap.id,
            name=d.get("name", ""),
            is_private=bool(d.get("isPrivate", True)),
            archived_at=d.get("archivedAt"),
            archived_by=d.get("archivedBy"),
            member_count=int(d.get("memberCount", 0)),
            leader_count=int(d.get("leaderCount", 0)),
            pinned_message_ids=list(d.get("pinnedMessageIds", [])),
            sticker_set=str(d.get("stickerSet", "general")),
            join_mode=d.get("joinMode", "request"),
            audience=d.get("audience"),
            created_by=str(d.get("createdBy", "")),
            founder_uid=str(d.get("founderUid", "")),
            avatar_url=d.get("avatarUrl"),
        )

@dataclass(frozen=True)
class MembershipContext:
    gid: str
    uid: str
    role: Literal["member", "leader"]
    group: GroupDoc

def _db():
    return fb_firestore.client()

def require_not_banned(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    db = _db()
    snap = db.collection("bans").document(user.uid).get()
    if not snap.exists:
        return user
    data = snap.to_dict() or {}
    expires = data.get("expiresAt")
    # Firestore timestamps in Python admin are datetime with tzinfo.
    if expires is not None and expires > _now_utc():
        raise APIError(
            status_code=403,
            code="banned",
            message="Account is banned.",
            details={"expiresAt": expires.isoformat()},
        )
    return user

def require_member(
    gid: str,
    user: CurrentUser = Depends(get_current_user),
) -> MembershipContext:
    db = _db()
    group_ref = db.collection("groups").document(gid)
    member_ref = group_ref.collection("members").document(user.uid)
    # Single getAll to fetch both docs in one round-trip.
    group_snap, member_snap = db.get_all([group_ref, member_ref])
    if not group_snap.exists:
        raise APIError(404, "group_not_found", "Group not found.")
    if not member_snap.exists:
        raise APIError(403, "not_a_member", "Not a member of this group.")
    role = (member_snap.to_dict() or {}).get("role", "member")
    return MembershipContext(
        gid=gid, uid=user.uid, role=role,
        group=GroupDoc.from_snapshot(group_snap),
    )

def require_leader(
    membership: MembershipContext = Depends(require_member),
) -> MembershipContext:
    if membership.role != "leader":
        raise APIError(403, "not_a_leader", "Not a leader of this group.")
    return membership

def require_not_archived(
    membership: MembershipContext = Depends(require_member),
) -> MembershipContext:
    if membership.group.archived_at is not None:
        raise APIError(409, "group_archived", "Group is archived.")
    return membership
```

### D.2 The opaque cursor helper

Used by every paginated read endpoint. Goes in `backend/app/services/cursors.py`.

```python
import base64, hmac, hashlib, json, time
from typing import TypedDict
from app.config import get_settings

class MessageCursor(TypedDict):
    created_at_micros: int
    mid: str

def encode(cursor: MessageCursor) -> str:
    payload = json.dumps(cursor, separators=(",", ":")).encode()
    sig = hmac.new(
        get_settings().cursor_secret.encode(),
        payload,
        hashlib.sha256,
    ).digest()[:8]
    return base64.urlsafe_b64encode(sig + payload).decode().rstrip("=")

def decode(cursor: str) -> MessageCursor:
    raw = base64.urlsafe_b64decode(cursor + "==")
    sig, payload = raw[:8], raw[8:]
    expected = hmac.new(
        get_settings().cursor_secret.encode(),
        payload,
        hashlib.sha256,
    ).digest()[:8]
    if not hmac.compare_digest(sig, expected):
        from app.exceptions import APIError
        raise APIError(422, "invalid_cursor", "Cursor is invalid or tampered.")
    return json.loads(payload)
```

`Settings.cursor_secret` is added to `backend/app/config.py` and loaded from Secret Manager. **DESIGN-OPEN: minimum-length and rotation policy.**

### D.3 The realtime listener orchestrator

Sketch only — M5 implementation will need backpressure and connection lifecycle handling not shown here.

```python
# backend/app/services/realtime.py (M5)

import asyncio, json, time, secrets
from typing import AsyncIterator
from firebase_admin import firestore as fb_firestore

class StreamEvent:
    def __init__(self, event_type: str, data: dict):
        self.id = f"{int(time.time() * 1_000_000)}-{secrets.token_hex(4)}"
        self.event_type = event_type
        self.data = data

    def serialize(self) -> str:
        return (
            f"event: {self.event_type}\n"
            f"id: {self.id}\n"
            f"data: {json.dumps(self.data)}\n\n"
        )

async def subscribe_group(gid: str, uid: str) -> AsyncIterator[StreamEvent]:
    """
    Yield StreamEvents from the group's Firestore listener.
    Fans in: messages, reactions on those messages, group doc, members.
    """
    db = fb_firestore.client()
    queue: asyncio.Queue[StreamEvent] = asyncio.Queue()

    def on_messages(snapshot, changes, read_time):
        for change in changes:
            doc = change.document
            if change.type.name == "ADDED":
                queue.put_nowait(StreamEvent("message.created", _serialize_message(doc)))
            elif change.type.name == "MODIFIED":
                queue.put_nowait(StreamEvent("message.updated", {"mid": doc.id, "fields": _diff(doc)}))
            elif change.type.name == "REMOVED":
                queue.put_nowait(StreamEvent("message.deleted", {"mid": doc.id}))

    msg_query = (
        db.collection("groups").document(gid).collection("messages")
        .order_by("createdAt", direction=fb_firestore.Query.DESCENDING)
        .limit(50)
    )
    msg_unsub = msg_query.on_snapshot(on_messages)

    # Heartbeat coroutine — emit a heartbeat every 25 seconds.
    async def heartbeat():
        while True:
            await asyncio.sleep(25)
            queue.put_nowait(StreamEvent("heartbeat", {"t": _now_iso()}))

    hb_task = asyncio.create_task(heartbeat())

    try:
        while True:
            event = await queue.get()
            yield event
    finally:
        msg_unsub.unsubscribe()
        hb_task.cancel()
```

This is **incomplete** — it doesn't subscribe to reactions or the group doc; it doesn't dedup events on initial-snapshot replay; it doesn't handle the `last_event_id` backfill cutoff. M5's implementation will fill those in.

### D.4 Frontend hook composition

Two hooks share a stream:

```ts
// frontend/lib/hooks/streams/useGroupStream.ts (M5)

import { useEffect, useRef } from "react";
import { subscribeGroupStream, type StreamEvent } from "@/lib/streams/client";
import { useAuth } from "@/lib/auth-context";

type Listener = (e: StreamEvent) => void;

const subscriptions = new Map<
  string,  // gid
  { listeners: Set<Listener>; unsubscribe: () => void; refCount: number }
>();

export function useGroupStream(gid: string, listener: Listener) {
  const { getIdToken } = useAuth();
  useEffect(() => {
    if (!gid) return;
    let entry = subscriptions.get(gid);
    if (!entry) {
      const listeners = new Set<Listener>();
      const unsub = subscribeGroupStream(
        gid,
        getIdToken,
        (e) => { for (const l of listeners) l(e); },
        () => { /* on reconnect — fire a synthetic refetch event */ },
      );
      entry = { listeners, unsubscribe: unsub, refCount: 0 };
      subscriptions.set(gid, entry);
    }
    entry.listeners.add(listener);
    entry.refCount += 1;
    return () => {
      entry!.listeners.delete(listener);
      entry!.refCount -= 1;
      if (entry!.refCount === 0) {
        entry!.unsubscribe();
        subscriptions.delete(gid);
      }
    };
  }, [gid, listener, getIdToken]);
}

export function useGroupStreamFiltered<T>(
  gid: string,
  match: (e: StreamEvent) => T | null,
  onMatch: (data: T) => void,
) {
  useGroupStream(gid, (e) => {
    const m = match(e);
    if (m !== null) onMatch(m);
  });
}
```

The composition pattern: every chat-page hook calls `useGroupStreamFiltered` with its own match function. One TCP connection per group view.

### D.5 The cookie-set in the bootstrap handler

Per the §7.2.M2.5 simpler pattern (no middleware):

```python
# backend/app/routers/users.py (M2)

from fastapi import APIRouter, Depends, Response
from app.deps import get_current_user, CurrentUser
from app.models.users import BootstrapResponse

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("/me/bootstrap", response_model=BootstrapResponse)
def bootstrap(response: Response, user: CurrentUser = Depends(get_current_user)) -> BootstrapResponse:
    db = _db()
    profile_snap = db.collection("users").document(user.uid).get()
    has_profile = profile_snap.exists
    if has_profile:
        response.set_cookie(
            "jacob-has-profile",
            "1",
            max_age=60 * 60 * 24 * 30,  # 30 days
            secure=True,
            samesite="lax",
            path="/",
        )
    else:
        response.delete_cookie("jacob-has-profile", path="/")
    return BootstrapResponse(
        profile=UserProfile.from_snapshot(profile_snap) if has_profile else None,
        hasProfile=has_profile,
        claims={"admin": bool(user.claims.get("admin"))},
        deletionRequestedAt=(profile_snap.to_dict() or {}).get("deletionRequestedAt"),
    )
```

The same `response.set_cookie` pattern lives inside `POST /api/users/me` after a successful create.

---

## Appendix E — First 30 days of M5 operational runbook

A short reference for what to watch after M5 ships, before M6 closes the loop.

### Day 1 (deploy day)

* Deploy `jacob-streams` Cloud Run service via Terraform.
* Smoke-test in two browsers: confirm message lands in <1s.
* Verify Cloud Run streams logs structured-log JSON entries with `request_id`.
* Confirm Cloud Monitoring shows `instance_count == 1` for the streams service.
* Watch Sentry for new error codes `stream.connect_failed`, `stream.backfill_gap`.

### Day 2-7

* Daily check: `gcloud monitoring metrics list --filter='resource.type=cloud_run_revision'` for `request_count` on `jacob-streams`.
* If request count spikes past expected bounds (>10 RPS sustained on streams), investigate: client reconnect storm? Bug in disconnect handling?
* Daily Firestore reads: confirm we're not leaking listeners (Firestore admin console → Usage tab).

### Day 8-30

* Watch the SSE p99 backfill latency metric (M5 implementation must add it).
* Track concurrent SSE clients per instance.
* If clients per instance > 200, consider M5.10 Redis fanout earlier than planned.
* Track Firestore monthly read bill projection. If trending toward $200/month, plan M5.10.

### Triggers to escalate to M5.10 (Redis fanout)

Any one of these fires the M5.10 task:

1. Single-instance memory > 80% sustained.
2. Firestore reads from streams service > 100k/day.
3. SSE p99 backfill latency > 2s.
4. User complaints about chat lag in any of these conditions.

---

*End of plan.*


