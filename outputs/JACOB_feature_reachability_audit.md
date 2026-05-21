# JACOB feature reachability + role-based UI audit

Audit date: 2026-05-20. Branch surveyed: `origin/main` (HEAD `ae1995f`).

> Christopher reported that all he can find is chat — the backend has sermons, devotionals, daily verse, reading plans, the ministry feed, events, the discover surface, admin tooling, moderation, the wellbeing queue and org tooling, but the *reachable UI* is missing or undifferentiated by role. This audit confirms the report. The frontend pages **mostly exist** (more than I expected), but the entry points to reach them and the role-conditional UI to surface the right affordances **don't**.

## TL;DR

- **27 backend feature surfaces** (one per router). Frontend pages exist for **23** of them. Backend-only by design: `account.py` (account API), `unfurl.py` (helper), `uploads.py` (helper), `stickers.py` (helper) — these are not user-facing destinations and are fine.
- **Reachable (entry point present)**: chat, boards, ministry feed, groups list / create, join, search, settings, home, daily verse, account flows.
- **Built but unreachable (no inbound link from the app shell or any page a normal user lands on)**: **sermons, events, group members, group analytics, group settings, group settings/invites, watch sessions, devotionals, reading plans, discover, admin, orgs, appeals (member side)**. All of these have a fully-built consume page; some have a fully-built create flow too. They just have no nav entry. Direct URL only.
- **Role-conditional UI**: almost non-existent outside `/admin/layout.tsx` (admin/moderator) and `/feed` (ministry owner). The "Add sermon" and "New event" buttons render for every member; the backend rejects with 403 if they're not a leader. There is no UI affordance for an admin to reach the admin console from a normal page.
- **Net effect on a regular member**: they see Home → Chats → Boards → Feed → Settings. They will never discover that sermons, events, devotionals, reading plans, or the discover directory exist. A leader has no UI hint that they can post a sermon or create an event without typing the URL. An admin has no UI hint that the admin console exists.

## Method

1. Walked every router in `backend/app/routers/` and recorded the path, method, role dep, and consume/create classification.
2. Walked every page in `frontend/app/` and every component in `frontend/components/`.
3. Grepped for inbound links to each feature page (`grep -rn '"/devotionals' …` etc.) to confirm what is *reachable*.
4. Compared role checks (`useGroupMembership`, `useMinistryOwner`, the inline `claims.admin`/`claims.moderator` check in `/admin/layout.tsx`) against where they're applied.

## App-shell nav (today)

**Mobile bottom tab bar** (`MobileTabBar.tsx`): Home · Chats · Boards · Feed · Settings.

**Desktop sidebar + mobile drawer** (`AppShell.tsx`): Home · Feed · Chats · Boards · About · FAQ · Settings · Sign out.

**Home page** (`/home`): Daily verse · Your groups (first 5) · Recent activity. **No links** to devotionals, reading plans, sermons, events, discover, feed (despite Feed being a peer tab — fine), admin, or orgs.

**Group overview** (`/groups/[gid]`): Name, description, member count, "Open chat" button, and (leader-only) the invite-code box. **No links** to sermons, events, members, analytics, settings, settings/invites, or watch. The only way a member reaches sermons or events is by typing `/groups/<gid>/sermons` or `/groups/<gid>/events` directly.

## Per-feature punch list

Severity: **BLOCKER** = core feature exists but no end user can reach it. **HIGH** = present but missing key affordance (e.g. create UI not role-gated, leader can't tell they're a leader). **MED** = polish / discoverability. **LOW** = staff-only or low-impact.

### Sermons (`sermons.py` → `/api/groups/{gid}/sermons`)

- **Backend:** GET list / GET one / POST add / PATCH update / DELETE — list/get gated by `require_member`, write ops gated by `require_leader`.
- **Frontend page:** ✅ `/groups/[gid]/sermons` (list with filter + add form) and `/groups/[gid]/sermons/[sermonId]` (detail).
- **Reachable:** ❌ No link from `/home`, `/groups`, the group overview, or the chat page header. **Direct URL only.**
- **Consume:** ✅ once you reach the page.
- **Create:** ✅ form is built, but the **"Add sermon" button renders for every member**, not just leaders — the backend rejects non-leaders with 403. (`frontend/app/(authed)/groups/[gid]/sermons/page.tsx:98-106`.)
- **Role-gating:** ❌ button should be gated on `useGroupMembership(uid, gid).isLeader`.
- **Severity:** **BLOCKER** for reachability, **HIGH** for the role-gate cosmetic.
- **Fix:** add a "Sermons" link to the group overview (`/groups/[gid]/page.tsx`) and to the chat-header overflow. Gate "Add sermon" behind `isLeader`. Small.

### Events (`events.py` → `/api/groups/{gid}/events`)

- **Backend:** GET list / get / ICS export / POST create / PATCH / DELETE — list/get is `require_member`, create/patch/delete is `require_leader`, RSVP/check-in is member, manual-attendance and RSVP list are `require_leader`.
- **Frontend page:** ✅ `/groups/[gid]/events` (list + create form + RSVP buttons) and `/groups/[gid]/events/[eventId]` (detail).
- **Reachable:** ❌ Same as sermons — no link from anywhere a member lands.
- **Consume:** ✅.
- **Create:** ✅ form built, but **"New event" button renders for every member** (`frontend/app/(authed)/groups/[gid]/events/page.tsx:73-80`).
- **Role-gating:** ❌ same problem as sermons. Also: RSVP-list / manual-attendance / event edit affordances are not surfaced even to leaders in the UI today.
- **Severity:** **BLOCKER** + **HIGH**.
- **Fix:** link from group overview; gate `New event` on `isLeader`; expose RSVP list (`GET /events/{eventId}/rsvps`) on the event detail page for leaders.

### Group members (`groups.py` → `/api/groups/{gid}/members` and member-management writes)

- **Backend:** GET list (member), PATCH role / DELETE / founder-transfer / archive / unarchive / member-cap / announce — all leader-only.
- **Frontend page:** ✅ `/groups/[gid]/members`.
- **Reachable:** ❌ No link from the group overview or chat header.
- **Consume:** ✅.
- **Create / management:** ✅ promote/demote/remove/transfer buttons present (and gated to leader, good).
- **Severity:** **BLOCKER** (reachability).
- **Fix:** link from group overview.

### Group analytics (`analytics.py` → `/api/groups/{gid}/analytics`)

- **Backend:** leader-only.
- **Frontend page:** ✅ `/groups/[gid]/analytics` (self-redirects non-leaders).
- **Reachable:** ❌ No link from anywhere. Even a leader has no breadcrumb to it.
- **Severity:** **BLOCKER** for leaders.
- **Fix:** link from group overview, leader-only.

### Group settings + invites (`groups.py`, `invites.py`)

- **Backend:** leader-only writes.
- **Frontend pages:** ✅ `/groups/[gid]/settings` and `/groups/[gid]/settings/invites`. Both self-redirect non-leaders.
- **Reachable:** ❌ No link from anywhere. Leaders type the URL.
- **Severity:** **BLOCKER** for leaders.
- **Fix:** link from group overview, leader-only.

### Watch sessions (`watch.py` → `/api/groups/{gid}/watch`)

- **Backend:** member.
- **Frontend page:** ✅ `/groups/[gid]/watch/[sessionId]` (single session viewer).
- **Reachable:** ❌ There is **no list page** at `/groups/[gid]/watch` and no link from anywhere. To see a session you need its ID.
- **Consume:** session detail ✅; list ❌.
- **Create:** "start a watch session" UI ❌ (the POST endpoint exists; no client form).
- **Severity:** **HIGH** — feature is essentially undiscoverable. The backend lets a member start a session, but the only way to invoke it is by typing a URL or building it via API.
- **Fix:** (M) add a `/groups/[gid]/watch` list page with a "Start watching" button.

### Devotionals (`devotionals.py` → `/api/devotionals`)

- **Backend:** GET list / GET detail. Authoring is **backend-only** — content is seeded; no POST endpoint exists.
- **Frontend page:** ✅ `/devotionals` and `/devotionals/[slug]`.
- **Reachable:** ❌ Zero inbound links. Grep confirms only `/devotionals/[slug] → /devotionals`.
- **Consume:** ✅.
- **Create:** N/A — staff/editorial only, managed outside the user UI.
- **Severity:** **BLOCKER** (reachability).
- **Fix:** add a "Read" or "Library" entry point in the nav, or link from `/home` and `/feed`.

### Reading plans (`devotionals.py` → `/api/reading-plans`)

- **Backend:** GET list / GET detail / GET progress / POST mark-day-complete (member).
- **Frontend pages:** ✅ `/reading-plans`, `/reading-plans/[slug]`, `/reading-plans/[slug]/day/[n]`. Mark-complete button presumably wired in detail (not verified by this audit; spot-check later).
- **Reachable:** ❌ Zero inbound links.
- **Severity:** **BLOCKER** (reachability).
- **Fix:** same as devotionals — add a nav entry or surface on `/home`.

### Daily verse (`verse.py`)

- **Backend:** GET (member).
- **Frontend:** rendered on `/home` via `<DailyVerse />`.
- **Reachable:** ✅ on Home.
- **Severity:** N/A — fine.

### Boards (`boards.py`)

- **Backend:** list / posts / replies / reactions (member); pin and create-board (admin).
- **Frontend:** ✅ `/boards`, `/boards/[boardId]`, `/boards/[boardId]/[postId]`. Tab in mobile bar. New post / reply forms present and ungated (members can post).
- **Reachable:** ✅.
- **Create:** ✅, but **admin-only "Create board" / "Pin post" UI is not present** — `POST /admin/boards` and `POST .../pin` have no frontend form. (Admins can only create boards via API today.)
- **Severity:** MED (admin board-management not implemented in UI).
- **Fix:** (M) add `/admin/boards` page.

### Ministry feed (`ministry_feed.py`)

- **Backend:** list / get (member); create / edit / delete / pin (ministry_owner only); react (member).
- **Frontend:** ✅ `/feed` with `<NewMinistryPostForm />` shown only when `useMinistryOwner() === true`. Tab in mobile bar.
- **Reachable:** ✅.
- **Create:** ✅ (gated correctly to ministry owner).
- **Severity:** N/A — this is the model the rest of the app should follow.

### Discover (`discover.py`)

- **Backend:** GET public groups (member); POST join-request (member); approve/reject join-requests (leader).
- **Frontend:** ✅ `/discover` (list with filters), `/discover/[gid]` (detail + join request button).
- **Reachable:** ❌ No inbound link from the nav, home, or groups page.
- **Join-request management for leaders:** ❌ No UI page lists pending join requests on the leader side. The backend endpoints exist (`GET /groups/{gid}/join-requests`, approve/reject) — no client surface to drive them.
- **Severity:** **BLOCKER** for discover, **HIGH** for join-request management.
- **Fix:** add "Discover groups" entry on `/groups` next to "New group" / "Join with code". Build a join-requests panel in group settings or members page (M).

### Search (`search.py`)

- **Backend:** GET (member).
- **Frontend:** ✅ `/search` page + `<SearchBar />` overlay mounted in `AuthedLayout`. The mobile header has a search icon that opens the bar; ⌘K opens it on desktop. Search route + UI fully reachable.
- **Severity:** N/A — fine.

### Admin (`admin.py`, `flags.py`, `incidents.py`, `appeals.py` admin side, `ncmec.py`, `transparency.py` admin side)

- **Backend:** admin-only (some also moderator, see wellbeing).
- **Frontend:** ✅ `/admin/{queue,applications,users,groups,flags,incidents,ncmec,appeals,transparency,wellbeing}` with a dedicated admin layout/sidebar. The layout role-gates correctly: non-admin/moderator redirected to `/home`.
- **Reachable:** ❌ **No link from the regular app nav.** Admins must bookmark `/admin/queue`. The desktop sidebar and mobile drawer in `AppShell.tsx` have no admin entry. Grep confirms zero outbound links from non-admin pages to `/admin`.
- **Severity:** **BLOCKER** for admins.
- **Fix:** show an "Admin" link in the drawer / sidebar conditional on `claims.admin === true` (or `moderator === true` — that should link to `/admin/wellbeing`). Refactor the inline claim check in `/admin/layout.tsx` into a reusable `useRoleClaims()` hook so the nav can read the same source.

### Wellbeing queue (`wellbeing.py`)

- **Backend:** GET queue / status transitions (moderator or admin); moderator-grant (admin).
- **Frontend:** ✅ `/admin/wellbeing` (gated correctly).
- **Reachable:** ❌ Same as admin — only via direct URL.
- **Severity:** **BLOCKER** for moderators (who don't see the rest of the admin nav, and have nothing else hinting `/admin/wellbeing` exists).
- **Fix:** same hook + a conditional drawer entry "Moderation" for moderators.

### Orgs (`orgs.py`)

- **Backend:** create / list (admin); per-org dashboard / groups / admins / settings (org admin).
- **Frontend:** ✅ `/orgs/[orgId]`, `/orgs/[orgId]/{groups,admins,analytics,settings,transparency}`.
- **Reachable:** ❌ Completely orphaned. No nav entry. There isn't even a `/orgs` index page listing orgs you administer — only `/orgs/[orgId]` detail pages. Grep confirms zero inbound links from anywhere outside the orgs subtree.
- **Severity:** **BLOCKER** for org admins.
- **Fix:** (M) add a `/orgs` index page that lists the orgs the caller is an admin of (backend: `/api/orgs` returns the list for admins; need a per-user "my orgs" view), plus a nav entry conditional on the user belonging to any org. Without an `/api/users/me/orgs` endpoint this needs a small backend addition.

### Appeals (`appeals.py`, member side)

- **Backend:** POST submit / GET appeal (member); admin list/decide (admin).
- **Frontend:** ✅ `/appeals/new` (submit) and `/appeals/[appealId]` (status).
- **Reachable:** ❓ The submit page is presumably linked from the ban / strike notification (worth confirming — not in scope of this audit; flagged as a follow-up check). It is **not** linked from `/settings`.
- **Severity:** MED — assume it's reachable from notifications. Add a "My appeals" entry under `/settings` so a banned-and-appealing user can re-find their open appeal.
- **Fix:** (S) add a settings row "Appeals" → `/appeals/new` (and a "view current appeal" affordance if one exists).

### Notifications, profile, blocked users, data export, delete account, push prompt, install prompt

- All reachable from `/settings`. ✅. No issues.

### Transparency (public side)

- `/transparency` exists as a public page (under `frontend/app/transparency`). ✅. Linked from footer? — needs spot-check; out of scope.

### About / FAQ / Privacy / Terms / Guidelines

- Public pages, linked from drawer + footer. ✅.

### Recurring quiet gap: cross-feature role hook

There is no `useRoleClaims()` (or equivalent) hook. The admin/moderator check is open-coded in `/admin/layout.tsx`. `useMinistryOwner` is its own one-off hook. As a result, the app shell can't render conditional nav based on role without re-implementing the same `getIdTokenResult` dance. Recommend introducing one hook that returns `{ isAdmin, isModerator, isMinistryOwner }`, and use it from `AppShell` to drive role-conditional nav entries.

## Role → UI matrix (expected vs. actual)

| Role            | Should see today                                                                                  | Actually sees today                                            | Gap                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Member          | Home · Chats · Boards · Feed · Discover · Devotionals · Reading plans · Search · Settings · Group sub-features (sermons/events/members) | Home · Chats · Boards · Feed · Settings                        | Devotionals / Reading plans / Discover never surface. Sermons/events only via direct URL.        |
| Group leader    | All of member, **plus** in the group: Settings · Invites · Analytics · Members management · "Add sermon" / "New event" CTAs · Pending join requests | Same as member. No leader-specific affordances visible.        | No leader UI on group overview. "Add sermon" / "New event" show for everyone, no leader badge.   |
| Group founder   | All of leader, **plus** archive / transfer-founder controls.                                       | All exist in `/groups/[gid]/settings`, page is unreachable.    | Reachability.                                                                                    |
| Admin           | All of member, **plus** an "Admin" nav entry; admin console with queue/users/applications/flags/etc. | Same as member. No nav entry to `/admin`. Must type the URL.   | Nav entry missing.                                                                               |
| Moderator       | All of member, **plus** an entry to `/admin/wellbeing`.                                            | Same as member.                                                | Nav entry missing.                                                                               |
| Ministry owner  | All of member, **plus** the compose form on `/feed` (already correct) and ideally pin controls on existing posts. | Compose form on `/feed` ✅. Pin/edit UI on existing cards? — not verified, likely missing. | Mostly OK. Spot-check pin/edit affordances on `MinistryPostCard`. |
| Org admin       | All of member, **plus** an "Org dashboard" entry for the org(s) they admin.                        | Same as member. `/orgs` index does not exist.                  | Whole org surface is orphaned. Also needs an "Org admin" nav entry.                              |

## Fix sizing

### Cheap reachability wins (S — single small PR each, no backend work)

1. **Group overview links** (`/groups/[gid]/page.tsx`): add tiles or rows for Chat (existing), Sermons, Events, Members, plus leader-only Settings · Invites · Analytics. Size: S.
2. **Home page entry points** (`/home/page.tsx`): add a "Browse" or "Library" section linking to Devotionals, Reading plans, Discover. Size: S.
3. **Add "Discover groups"** button to `/groups/page.tsx` next to "New group" / "Join with code". Size: XS.
4. **Settings link to "Appeals"**: row in `/settings/page.tsx`. Size: XS.
5. **Role-conditional drawer entries** ("Admin" for admins, "Moderation" for moderators) in `AppShell.tsx`: needs a `useRoleClaims()` hook. Size: S.
6. **Gate leader-only CTAs in UI**: hide "Add sermon", "New event", "New post (announce)" affordances behind `useGroupMembership(uid, gid).isLeader`. Size: S.
7. **Drawer entry "Library"** with Devotionals + Reading plans (alternative or addition to fix #2). Size: XS.

### Substantial follow-ups (M — needs new pages or small backend additions)

8. **Watch sessions list page** (`/groups/[gid]/watch`) + "Start watching" CTA. Size: M.
9. **Join-request leader UI**: a panel on `/groups/[gid]/members` (or new `/groups/[gid]/join-requests`) showing pending requests with approve/reject. Backend exists. Size: M.
10. **Admin boards management page** (`/admin/boards`) wrapping the existing `POST /api/admin/boards` and pin endpoints. Size: M.
11. **`/orgs` index page** for org admins. May need `GET /api/users/me/orgs` (small backend). Size: M.
12. **Event detail enhancements for leaders**: RSVP list, manual-attendance, edit/delete affordances. Size: M.
13. **Ministry owner pin/edit affordances** on `MinistryPostCard` (verify; if missing). Size: S.

### Larger gaps (L — bigger product decisions)

14. **An overarching "Library" or "Today" surface** that pulls together daily verse, today's reading plan day, latest devotional, and latest sermons across the user's groups. The pieces all exist; nothing currently composes them. Christopher's framing suggests this is where users *expect* to land. Size: L (mostly composition + product copy; backend probably ready).
15. **Sermon authoring inside a group: video upload vs URL paste.** Today the model is "paste a URL"; if the actual ministry wants to host audio/video, that's a different feature. Out of scope for this audit, flag for product. Size: L.

## What I propose to ship in this session

A single PR that lands the biggest reachability wins from #1–#7 above:

- Add a section to `/groups/[gid]/page.tsx` that lists Chat, Sermons, Events, Members; show Settings · Invites · Analytics conditional on `useGroupMembership(uid, gid).isLeader`.
- Add a "Browse" section to `/home/page.tsx` linking Devotionals, Reading plans, Discover.
- Add a "Discover groups" button to `/groups/page.tsx`.
- Introduce a `useRoleClaims()` hook (or reuse the inline pattern from `admin/layout.tsx`) and surface an "Admin" drawer entry (admins) / "Moderation" drawer entry (moderators) in `AppShell.tsx`.
- Gate `Add sermon` and `New event` CTAs behind `isLeader`.

Leaves for follow-up (separate PRs / tracked):

- Watch list page + start-session CTA.
- Join-request leader UI.
- Admin boards page.
- `/orgs` index + `GET /api/users/me/orgs`.
- Settings → Appeals row (trivial; can also fold into the same first PR if there's room).
- Larger "Library" composite surface.
