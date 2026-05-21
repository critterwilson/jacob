# JACOB navigation — IA audit + redesign

_Last revised: 2026-05-21_

The JACOB app has accreted features across many PRs. Each one slipped its destination into whichever nav surface was nearest to hand, so the same screens are now reachable through 2–3 different paths, a few are reachable through only one obscure path, and at least one (`/search`) is reachable only via a mobile-only icon. This doc enumerates the current state, identifies the problems, and lays out a redesigned IA.

## Method

- Read every `page.tsx` under `frontend/app/` (74 routes).
- Read every component that renders nav links: `AppShell.tsx`, `MobileTabBar.tsx`, `home/page.tsx` (Browse section), per-group `[gid]/page.tsx`, `admin/layout.tsx`, `orgs/[orgId]/page.tsx`, `settings/page.tsx`.
- Cross-referenced each destination against every nav surface and counted click depth from `/home` for a member and a leader.

## Destination inventory

### Top-level, member-accessible (no role gating beyond being signed in)
- `/home` — daily surface (verse, reading-plan progress, devotional, ministry highlights, your groups slice, recent activity, Browse cards).
- `/feed` — ministry broadcast feed (sermons, devotionals, announcements).
- `/groups` — your groups list + Discover/Join/Create CTAs.
- `/groups/new` — create a new group.
- `/groups/[gid]` — group overview hub (sub-nav into sermons, events, members, leader tools).
- `/groups/[gid]/chat` — group chat (full-height surface; no bottom tabs).
- `/groups/[gid]/sermons` and `/sermons/[sermonId]` — sermon archive + detail.
- `/groups/[gid]/events` and `/events/[eventId]` — events list + detail with RSVP roster.
- `/groups/[gid]/members` — group member list.
- `/discover` and `/discover/[gid]` — public group browsing.
- `/boards`, `/boards/[boardId]`, `/boards/[boardId]/[postId]` — cross-group discussion boards.
- `/devotionals`, `/devotionals/[slug]` — ministry devotionals.
- `/reading-plans`, `/reading-plans/[slug]`, `/reading-plans/[slug]/day/[n]` — scripture reading plans.
- `/search` — full-text message search.
- `/settings` and sub-pages (`/profile`, `/notifications`, `/blocked`, `/export`, `/delete-account`).
- `/appeals/new`, `/appeals/[appealId]` — moderation appeals.
- `/about`, `/faq`, `/terms`, `/privacy`, `/guidelines`, `/transparency` — public/info pages.

### Role-gated
- **Leader-only (per group):** `/groups/[gid]/sermons/new`, sermon edit/delete on `[sermonId]`, event create/edit/delete inline on `events`, `/groups/[gid]/join-requests`, `/groups/[gid]/settings`, `/groups/[gid]/settings/invites`, `/groups/[gid]/analytics`.
- **Ministry-owner-only:** `/devotionals/new`, "New post" form on `/feed`.
- **Admin-only:** all of `/admin/*` (queue, applications, users, groups, boards, flags, incidents, ncmec, appeals, transparency, wellbeing), `/reading-plans/new`, `/reading-plans/[slug]/edit`.
- **Moderator-only:** `/admin/wellbeing` (the only admin page they get).
- **Org-conditional:** `/orgs` (only if the user belongs to ≥1 org), `/orgs/[orgId]/*` (groups, admins, analytics, transparency, settings — settings backend-gated to org admin).

## Current nav surfaces

There are **seven** distinct surfaces that render nav links today:

1. **`MobileTabBar`** (`frontend/components/nav/MobileTabBar.tsx`) — bottom tab bar on mobile, 5 fixed slots: Home / Chats (`/groups`) / Boards / Feed / Settings. Hidden on full-height surfaces (chat).
2. **`AppShell` desktop sidebar** (`AppShell.tsx`, ll. 212–222) — left column on `md+`, renders `NavLinks` (the same flat list as the drawer).
3. **`AppShell` mobile drawer** (ll. 256–311) — opened by the hamburger top-left in the mobile header; renders the same `NavLinks` flat list.
4. **`AppShell` mobile header search button** (ll. 242–253) — fires a `jacob:open-search` event that opens `SearchBar`. Mobile only; desktop has no equivalent.
5. **Home Browse cards** (`home/page.tsx`, ll. 178–222) — three tiles for Devotionals / Reading plans / Discover groups.
6. **Group detail sub-nav** (`groups/[gid]/page.tsx`, ll. 118–189) — a 2-or-3-column grid that mixes member tabs (Sermons, Events, Members) with leader tools (Join requests, Settings, Invites, Analytics) when the viewer is a leader.
7. **Admin layout sidebar** (`admin/layout.tsx`) — left rail inside `/admin/*` with 11 links for admins, 1 link for moderators.
8. **Settings hub list** (`settings/page.tsx`) — list of 6 items (Edit profile, Notification settings, Blocked users, Export, Submit an appeal, Delete account).
9. **Org detail header buttons** (`orgs/[orgId]/page.tsx`) — inline row of buttons (Groups, Admins, Analytics, Settings).

The `NavLinks` flat list rendered by AppShell (sidebar + drawer) currently contains:

```
Home, Feed, Chats, Boards, Discover, Devotionals, Reading plans,
About, FAQ, Settings, [Organizations if any orgs], [Admin/Moderation if claim]
```

— 10 base entries plus 1 conditional plus 1 admin entry. No grouping, no headers, no hierarchy.

## What's wrong

### 1. The same destination reaches through 3+ surfaces (inconsistency)
- **Discover (`/discover`)** — drawer/sidebar **AND** Home Browse card **AND** a CTA on `/groups`.
- **Devotionals (`/devotionals`)** — drawer/sidebar **AND** Home Browse card. Plus today's devotional has its own card on Home.
- **Reading plans (`/reading-plans`)** — drawer/sidebar **AND** Home Browse card. Plus today's reading has its own card on Home.
- **Feed (`/feed`)** — bottom tab **AND** drawer/sidebar **AND** "See all" link on Home.
- **Chats (`/groups`)** — bottom tab **AND** drawer/sidebar **AND** "See all" on Home's groups card.

The redundancy isn't pure waste — there's value in surfacing devotionals and reading plans on Home as part of the daily flow — but the **drawer becomes a flat list with no signal about what matters and no place that's the authoritative entry point** for each thing.

### 2. Destinations with only one obscure path
- **`/search`** — the only entry is the magnifying-glass icon in the mobile header. On desktop, there is literally **no** way to reach `/search` from any nav surface. You must type the URL.
- **`/appeals/[appealId]`** (own appeals) — only reachable by deep-link (e.g. email from an admin) or by remembering the URL. There is no `/appeals` index for the user to see their own submissions.
- **`/groups/[gid]/settings/invites`** — nested under Settings inside a group, even though invite rotation is a frequent leader task. Click depth from /home for a leader: 5 clicks (Home → Chats → group → Settings → Invites). Should be 3.
- **`/groups/[gid]/events/[eventId]`** — only reachable from the events list inside the group; no shortcut from Home or Feed even though events are time-sensitive.

### 3. Destinations with no nav path
- **`/appeals`** — there is no such route at all; users can submit (`/appeals/new`) but cannot list their past submissions.
- **`/transparency`** — public route, but appears nowhere in authed nav (only via landing footer).

### 4. Role-gated entries that aren't obvious to the role that has them
- **Ministry owner devotional/feed authoring** — the "Write devotional" CTA only appears once you're on `/devotionals`. The drawer just says "Devotionals" — there's no signal to a ministry owner that this is their authoring surface. Same for `/feed` ministry posting.
- **Leader management actions inside a group** — Join requests, Settings, Invites, Analytics are mixed into the same visual grid as Sermons/Events/Members. A leader has to mentally separate "things any member can use" from "things only I can use." A non-leader can't tell at a glance whether they're seeing the full nav.
- **Admin entry** is fine (drawer link → admin sidebar takes over), but the moderator-only fallback (`/admin/wellbeing`) labels the drawer link "Moderation" which is informative.

### 5. Mobile vs desktop asymmetry
- Mobile has search via header icon, desktop has nothing.
- Mobile has bottom tab bar (5 items), desktop has flat sidebar (12 items). The two sets don't even overlap cleanly — desktop's flat sidebar has no notion of "primary 5" vs "everything else."

### 6. Settings tab is a wasted slot
Settings is a once-every-few-weeks destination, but it occupies one of the five precious bottom-tab slots. By contrast, the spiritual-content surfaces (devotionals/reading-plans) that the app exists to serve are buried behind the hamburger.

## Redesign

### Principles
1. **One primary entry per destination.** Bottom tabs and the drawer/sidebar serve different purposes: tabs are "where you go most days," the drawer is "the authoritative list of everywhere you can go." A destination can appear in both, but each should feel like a deliberate choice, not duplication.
2. **Group the drawer/sidebar.** A flat list of 12 items is the same as no list. With three or four section headers (You / Library / Community / Admin), users can predict where things are.
3. **Mobile and desktop should share a mental model.** On mobile, primary = tabs, long-tail = drawer. On desktop, primary = sidebar (grouped), long-tail = the same grouped sidebar (since there's no tab bar to compete with). Same `NavLinks` component, same labels, same order.
4. **Role-conditional sections live below the always-visible nav, with a header.** "Admin" doesn't go in the same bucket as "Devotionals."
5. **`/search` is a real destination, not an event.** Add it to the drawer/sidebar. The mobile header search icon stays as a convenience.

### Top-level structure (bottom tab bar — mobile primary)

Five slots. Recommend:

| # | Tab | Route | Why |
|---|-----|-------|-----|
| 1 | **Home** | `/home` | Daily portal (verse, reading-plan progress, devotional, ministry highlights). Unchanged. |
| 2 | **Chats** | `/groups` | Most-used surface. Unchanged. |
| 3 | **Feed** | `/feed` | Ministry broadcasts — the primary content surface for a ministry-led app. Unchanged. |
| 4 | **Boards** | `/boards` | Cross-group community. Unchanged. |
| 5 | **You** | `/settings` | **Changed**. Replaces "Settings". Profile/account/orgs/admin/about/sign-out all roll up here. The avatar icon signals "this is your space," matching the pattern in Instagram/Twitter/Discord/etc. |

**Judgment call to flag for Christopher:** which 5 deserve a tab is the only IA decision worth bikeshedding. The choice above keeps every currently-tabbed destination tabbed (Home/Chats/Feed/Boards) and only swaps Settings → You. The alternative most worth considering is making the 5th tab a **Library / Grow** tab (devotionals + reading plans + sermons) instead of a profile tab, on the argument that the app's spiritual content is the reason people open it daily. I recommend **You** because: (a) Settings as a tab is already a slot we're giving away, and the swap is cosmetic; (b) Library content is well-surfaced on Home (verse / reading-plan / devotional cards are sections 1–3 of /home) and via the grouped drawer; (c) "You" is also where leaders/admins/owners discover their role-specific surfaces.

### Drawer / sidebar structure (mobile drawer + desktop sidebar)

Grouped, with section headers. Roughly:

```
EXPLORE
  Home
  Chats
  Feed
  Boards

GROW
  Devotionals
  Reading plans
  Discover groups
  Search

YOU
  Settings
  Organizations           (only if orgs.length > 0)
  Submit an appeal
  About
  FAQ

ADMIN                     (only if isAdmin or isModerator)
  Moderation queue        (admin)
  Wellbeing               (moderator — sole entry)
```

Sign out lives at the very bottom of the drawer/sidebar as it does today.

- **EXPLORE** mirrors the bottom tabs so desktop users (no tab bar) get the same primary nav. On mobile, this section is also visible but feels like a "you're already on a tab — here's the long tail."
- **GROW** is the library section — spiritual content + discovery + search.
- **YOU** is the personal account section. `Settings` is the entry to all the profile sub-pages (it's already a hub). `About`/`FAQ` are personal-info-adjacent, not navigation-primary.
- **ADMIN** is below the line, only visible when claimed.

### Per-section sub-nav: group detail

The group detail page (`/groups/[gid]`) currently renders a 2-or-3-column grid of 7 tiles that mixes member-tabs with leader-tools. The redesign:

- A horizontal **member sub-nav strip** at the top of the page: `Chat | Sermons | Events | Members`. These are the four sections every member can use, presented as one bar that mirrors the visual language of a tab strip. (Chat is currently a separate primary CTA button — keep it as the visually-emphasised entry but make it the first item of the strip too, since it IS the group's most-used surface.)
- A separately-titled **leader-only "Manage group" section** below that, containing: Join requests (with badge), Settings, Invites, Analytics. Visually distinct from the member strip — collapsible card or a clearly-labeled sub-section — so a leader can tell at a glance "these are my admin tools."

This also lets us **promote Invites out of the Settings nesting** (currently 5 clicks deep from /home; will become 4 clicks at the same depth as Settings, both leader-tools tiles).

### Per-section sub-nav: settings → "You" hub

`/settings` becomes the You hub. The page renders sections rather than a single flat list:

```
Account
  Edit profile
  Notification settings
  Blocked users
  Export my data
  Delete account                (danger)

Appeals
  Submit an appeal
  (in future: list of own appeals — needs /appeals index route)

Organizations                   (only if orgs.length > 0)
  → [Org name]                  (links to /orgs/[orgId])
  → [Org name 2]
  ...

Admin                           (only if isAdmin or isModerator)
  Admin console                 (→ /admin/queue or /admin/wellbeing)

Info
  About JACOB
  FAQ
  Privacy / Terms / Guidelines

Sign out
```

This is what the bottom-tab "You" tab opens to. It's a true personal hub.

### Search

- Add **`/search`** to the GROW section of the drawer/sidebar so it's discoverable from anywhere on both viewports.
- Keep the mobile header magnifying-glass icon as a convenience shortcut (it's faster than opening the drawer).
- Add a similar shortcut to the desktop sidebar header (next to the JACOB wordmark) so the search-as-icon pattern works on desktop too.

### Home Browse section

Keep the three cards (Devotionals / Reading plans / Discover groups) on Home — they're explicitly placed at the end of the daily flow as "if none of the above is what you wanted, here's the library." This is a legitimate redundancy with the drawer because Home is a daily-focus surface and the cards have descriptive subtitles ("Short scripture reflections", "Multi-day scripture journeys", "Find a public small group") that the drawer items don't. **No change.**

## Per-feature reachability after redesign

| Feature | Member entry | Leader / role entry | Click depth |
|---------|--------------|-------------------------|-------|
| Daily verse / devotional / plan | Home (sections 1–3) | — | 0 |
| Group chat | Chats tab → group card → chat | — | 2 |
| Ministry feed | Feed tab; Home highlights | Ministry owner: "New post" on Feed | 1 |
| Cross-group boards | Boards tab | Admin: `/admin/boards` create/archive | 1 |
| Devotionals | GROW > Devotionals; Home Browse | Ministry owner: "Write devotional" CTA on Devotionals | 1–2 |
| Reading plans | GROW > Reading plans; Home Browse | Admin: "New plan" CTA on Reading plans | 1–2 |
| Discover groups | GROW > Discover; Home Browse; Chats CTA | — | 1–2 |
| Search | GROW > Search; mobile header icon; desktop sidebar icon | — | 1 |
| Sermons (per group) | Chats tab → group → Sermons | Leader: "Add sermon" CTA on archive | 3 |
| Events (per group) | Chats tab → group → Events | Leader: inline create form | 3 |
| Members (per group) | Chats tab → group → Members | — | 3 |
| Join requests | — | Leader: group > Manage > Join requests (badge) | 4 |
| Group settings | — | Leader: group > Manage > Settings | 4 |
| Invites | — | Leader: group > Manage > Invites | 4 (was 5) |
| Analytics | — | Leader: group > Manage > Analytics | 4 |
| Settings sub-pages | You tab → section | — | 2 |
| Organizations | You tab → Organizations (if any) | Org admin: org page > Settings | 2–3 |
| Admin console | You tab → Admin; drawer ADMIN section | Admin: full sidebar | 2 |
| Moderation queue | — | Moderator: drawer ADMIN > Wellbeing; You tab → Admin | 2 |
| About / FAQ / legal | You tab → Info; drawer YOU > About/FAQ | — | 2 |
| Submit appeal | You tab → Appeals; drawer YOU > Submit an appeal | — | 2 |

Every destination in the inventory now has at least one obvious, role-appropriate path. Nothing has been removed. The "Discover" three-way duplication collapses to two (drawer + Home Browse — `/groups` CTA stays as a contextual call-to-action specific to that page, not a global nav surface). Search becomes discoverable. Invites moves up one level. Leader tools become visually distinct from member sub-nav.

## Implementation plan

Split into two PRs:

**PR 1 — Top-level nav restructure.** Touches `AppShell.tsx`, `MobileTabBar.tsx`, `settings/page.tsx`. Adds grouped sidebar/drawer sections, swaps the Settings tab for a You tab (avatar icon, same `/settings` route), turns the settings hub into a You hub with Account / Appeals / Organizations / Admin / Info / Sign-out sections. Adds `/search` to the GROW group. Adds a desktop sidebar search shortcut.

**PR 2 — Per-group sub-nav cleanup.** Touches `groups/[gid]/page.tsx`. Separates member sub-nav (Chat / Sermons / Events / Members) from leader management (Join requests / Settings / Invites / Analytics) into two visually distinct sections.

Both PRs are independently shippable. PR 1 lands first because it's the bigger structural change.

## Things not changed

- Group chat polling/SSE behaviour (not nav).
- Admin layout sidebar (the inner admin nav is already clean and section-isolated).
- Org detail page sub-nav (already clean; might benefit from minor visual unification with the group `Manage` section but not in scope).
- Public/landing footer.
- The `Browse` cards on Home — kept as-is for the daily-flow reason given above.
