# JACOB — Greenfield UI Redesign Proposal (v2)

*Drafted 2026-05-29. A clean-sheet design derived from what JACOB **does**, not from the
current frontend. Grounded in `docs/data-model.md` and the product ADRs — 0007 (org model),
0011 (ministry feed + the `ministry_owner` role), 0012 (superseded admin-approval signup),
0013 (SSE realtime chat), 0014 (group-message push), 0015 (delegated membership), 0016
(native Firestore search) — plus the live API surface (`backend/app/routers/*`). No existing
screens were read while writing this; the intent is a fresh idea, not a cleanup of what exists.*

This is a proposal to react to, not a spec to build. Pick a direction; we'll turn the chosen
parts into tickets afterward.

---

## 0. The app in one breath

JACOB is two products fused: a **peer small-group messenger** (every group an equal room) and
a **one-to-many discipleship channel** (one spiritual leader teaching the whole community).
ADR 0011 makes this explicit — there is a single `ministry_owner` who speaks to everyone,
plus per-group `leader`s who shepherd their own mats. The UI has to serve both shapes at once:
the intimate room *and* the gathered congregation.

A member opens JACOB to do one of four things: *catch up on my group, hear what the ministry is
teaching this week, see what's coming up, or read today's devotional.* A leader adds *who's
asking to join my group.* The owner adds *who applied to lead, which minors are waiting on me,
and what do I want to say to everyone.* A platform admin adds *is anything flagged.* Every screen
below is built to answer one of those from a cold open in one tap.

The unit of belonging is the **group** (`groups/{gid}`). The unit of teaching is the **ministry
feed + weekly sermon** (`ministry_feed`, `weekly_sermons`). Those two are the spine; everything
else orbits them.

---

## 1. Design principles

Six commitments. Each is a tiebreaker we can hold a screen against.

### 1.1 Two voices, one question per screen
The owner's broadcast voice (`ministry_feed`, `weekly_sermons`, platform `devotionals`) and the
peer voice (`groups/{gid}/messages`, `boards`) must never blur together. ADR 0011 rejected
"just pin a board post" precisely because a sermon and a chat message need different permission
*and* different visual weight. The IA gives each voice its own home (a Ministry destination vs.
Groups/Boards) so a member always knows whether they're hearing the shepherd or their peers. And
within that split, **every destination has a single job and a single primary action** — we do not
build a dashboard home that answers everything at once, because on a phone that just pushes the
real content below the fold. The data model is cleanly partitioned (`messages`, `ministry_feed`,
`events`, `boards`, `devotionals`); the UI inherits that partition.

### 1.2 The group is the gravity well — land people in it
The most frequent session, by a wide margin, is "read/post in my group." The default landing for
an approved member is their group chat (single-group) or a one-tap group list (multi-group) — not
a synthetic activity feed assembled from six collections. *Why:* `groups/mine` is the cheapest,
highest-signal call we make; the home that's cheapest to render is also the one people want.

### 1.3 Minors are never invisible to the owner
Per ADR 0015, a join request from a user with `isMinor: true` sets `requiresOwnerReview: true`
and escalates to the `ministry_owner` — a leader *cannot* approve a minor, and the owner attests
parental consent at decision time. The UI makes the owner's view of pending minors a first-class,
badged, always-reachable surface, visually distinct from adult approvals and from leader
applications. A waiting minor is never more than one tap from the owner's attention. *Why:* this
is the single most safety-critical flow in the product; it earns dedicated pixels.

### 1.4 Duties are work queues, not settings
Join-request approval (`/groups/{gid}/requests`), leader-application review
(`/admin/leader-applications`), reports (`/admin/reports`), appeals (`/admin/appeals`), and
incidents (`/admin/incidents`) are *inboxes with counts and one-tap actions*, not configuration
screens you navigate into and hunt around. A leader/owner/admin should see a number, tap it, and
clear it. *Why:* these are recurring obligations with a clear "done" state; the inbox-with-badge
pattern is the honest representation.

### 1.5 Three authorities, one shell
JACOB has three orthogonal roles (ADR 0011): `ministry_owner` (spiritual/product — broadcasts,
approves leaders + minors, authors devotionals), `admin` (platform ops — moderation, bans,
transparency), and `leader` (per-group, membership-derived). One human can hold any combination;
the pilot founder holds owner + admin. There is no separate "admin app." All three share the
member shell; privileges appear inline where the work is and collect in a single role-aware
**Manage** destination whose *sections* light up by claim. *Why:* the role boundary is fluid and
should feel like permission, not partition.

### 1.6 Optimistic, quiet, never blank
Chat is SSE (ADR 0013); everything else polls with `If-None-Match`/ETag conditional GETs (304s).
After first load we never show a full-screen spinner — last data stays on screen, a thin
"updating" hairline shows sync, chat sends optimistically and reconciles, and a failed send keeps
the text. *Why:* the runtime is polling + PWA + gym wifi; a design that flashes spinners on every
poll would feel broken even when working perfectly.

---

## 2. User archetypes

Six roles; the first three drive ~95% of sessions.

### 2.1 The Ministry Owner — "Jacob" (`ministry_owner` claim)
The founder and single spiritual leader. Lives in the app daily, mostly on his phone between
sessions on the mat. He's the only one who can: broadcast to everyone (`ministry_feed`), publish
the weekly sermon (`weekly_sermons`), author platform-wide `devotionals`, approve **leader
applications** (`leader_applications` — approving one *creates* the group with that person as
leader), and approve **minor** join requests. **A typical session:** opens from a push ("a minor
requests approval"), clears the queue (1 minor + 1 leader application), records this week's sermon
link and a short devotional, RSVPs himself to Friday's open mat, closes the app. ~3 min,
high-stakes. He is the only user who routinely touches every surface.

### 2.2 The Group Leader — a coach (`members/{uid}.role == "leader"`)
Leads one group (sometimes two), anointed by the owner via an approved leader application.
Approves **adult** join requests to *their* group (`/groups/{gid}/requests`), posts to and
moderates their own chat, creates the group's events, authors group-scoped `devotionals`, may
start a Watch Together. **A typical session:** opens from a push ("2 people want to join Tuesday
Teens"), approves both adults, sees a minor request he *can't* action (escalated to the owner),
posts "bring a gi for new folks," creates next week's event. A few times a week.

### 2.3 The Adult Member — a regular
The bulk of users. Chat, RSVP, read the owner's word, follow a devotional. **A typical session:**
opens from a push ("Sarah replied to you"), reads the thread, reacts and replies, checks Saturday's
events and marks "going," skims this week's ministry post on the way out. 60–90 s, several times a
week. Mobile, one-handed, often on flaky gym wifi.

### 2.4 The Minor Member — a teen
Same jobs as an adult — chat, events, the ministry feed, devotionals — wrapped in safety. Signed
up under 18, so `users/{uid}.isMinor: true`. Could not enter until the owner approved their
escalated join request with parental consent attested (ADR 0015). **A typical session:** identical
to the adult's; the machinery around them (owner approval, heightened moderation, the owner one
tap from anything about them) is invisible to them — they just see chat.

### 2.5 The Platform Admin — trust & safety (`admin` claim)
Operates the safety surfaces: the moderation outcomes, `reports`, ban `appeals`, `active_incidents`
banners, `transparency_reports`, bans. Often the same human as the owner in the pilot, but a
*distinct* authority (ADR 0011) so a hosted customer could hold `ministry_owner` without `admin`.
**A typical session:** opens from a report notification, reviews the flagged content in context,
removes it (soft-delete) or dismisses, occasionally issues a ban with a reason or resolves an
appeal. Low frequency, high consequence.

### 2.6 The Org tier — latent (T54 / ADR 0007)
Multi-tenant `orgs/{orgId}` exists in the schema (every current group has `orgId: null`,
unaffiliated) but the org admin/onboarding UI is Phase 3.5. **Design stance:** structure the
owner's org-profile surface so it can later gate to an org-admin role without moving anything; do
not build a separate org persona UI in v1.

---

## 3. Jobs to be done

Per archetype, ranked by frequency. Each job names the entities/endpoints it touches so §4 can map
it to a destination.

### Adult / Minor Member
1. **Read & post in my group** — `messages` (text/sticker/media), threads via `parentMessageId`, emoji reactions. *Many times/week.*
2. **Catch up on what I missed** — `groups/mine` ordering, `notifications`.
3. **Reply in a thread / react** — `/messages/{mid}/thread`, `/react`, reaction slugs `like|love|pray|laugh|wow|sad`.
4. **Hear the ministry's word** — `weekly_sermons` (this week's video), `ministry_feed` posts, react.
5. **See what's coming up & RSVP** — `events`, `POST …/rsvp` (`going|maybe|declined`).
6. **Read a devotional / follow a plan** — `devotionals` (merged feed), `reading_plans`, `plan_progress`.
7. **Browse the cross-group forums** — `boards` posts (sticker-tagged) + flat replies + reactions.
8. **Find & join another group** — `/discover/groups`, `POST /groups/{gid}/join` → `joinRequests`, or accept an invite (`/invites/{code}/accept`).
9. **Manage my notifications & muted groups** — `notification-prefs`, `muted-groups`, `mutes`/`blocks`.
10. **Report something / get help** — `POST /reports`, `wellbeing/resources` + `wellbeing/checkin`.
11. **Watch together** — `groups/{gid}/watch` synchronized video sessions.

### Group Leader (adds, on top of member jobs)
1. **Approve adults waiting on my group** — `/groups/{gid}/requests` → approve/reject. *The signature job.*
2. **Post & moderate in my chat / pin** — `messages`, soft-delete (`deletedAt`).
3. **Create & manage my group's events** — `events` create/patch, delete sets `cancelledAt`.
4. **Author a group devotional** — `POST /devotionals` (group-scoped).
5. **Start a Watch Together** — `POST /groups/{gid}/watch`.
6. **See who's pending vs active** — `/groups/{gid}/requests`, `/groups/{gid}/members`.

### Ministry Owner (adds, on top of leader jobs)
1. **Approve minors** — escalated `joinRequests` (`requiresOwnerReview`), attest consent. *Never delegated.*
2. **Review leader applications** — `/admin/leader-applications` → approve creates the group.
3. **Broadcast to everyone** — `POST /ministry-feed`, pin/unpin.
4. **Publish the weekly sermon** — `POST /admin/weekly-sermon`.
5. **Author platform devotionals & plans** — `POST /devotionals` (platform), `reading_plans`.

### Platform Admin (`admin`)
1. **Triage reports** — `/admin/reports` → resolve.
2. **Handle appeals** — `/admin/appeals` → resolve.
3. **Post / clear incident banners** — `/admin/incidents`.
4. **Ban / unban** — `bans`, with reason + `expiresAt`.
5. **Pull transparency reports** — `transparency_reports`.

---

## 4. Information architecture

### 4.1 The form: a role-aware bottom tab bar

**Decision: a persistent bottom tab bar — 4 tabs for members (Groups, Ministry, Events, Boards),
a 5th badged "Manage" tab that appears for anyone holding `leader`, `ministry_owner`, or `admin`.
Notifications and profile live in a slim top bar; an `active_incidents` banner can pin under it.
Search is scoped inside each surface, never a global tab.**

Why a bottom tab bar over a hamburger drawer or a side rail:

- **Thumb reach.** One-handed, mobile-first, PWA, used in a gym. The most-frequent destinations
  must be reachable by the thumb without a menu tap. A drawer hides primary nav behind a
  deliberate gesture — wrong for surfaces hit dozens of times a week. A side rail is a desktop
  idiom that wastes phone width.
- **Few enough destinations.** The member's jobs (§3) collapse cleanly into four buckets, inside
  the "≤5 tabs" rule with room for the role-gated fifth.
- **Predictable shell.** The four member tabs never move or reorder by role. A leader's app is a
  member's app *plus* Manage — same muscle memory, wider surface (principle 1.5).

Why notifications/profile are **not** tabs: notifications are a transient inbox you visit and
leave — a top-right **bell with an unread badge** is the honest control. Profile/settings is
infrequent — a top-left **avatar** suffices. Spending a thumb slot on either would crowd out a
daily destination.

Why search is **not** a tab: per ADR 0016 search is keyword-only (`array-contains` over
`searchTokens`) and *scoped* — messages within a group, posts within a board, members within a
group. A global box would promise cross-everything results the backend can't give. Search lives as
a contextual control inside Groups, Boards, and member lists.

### 4.2 The destinations

```
┌─ Top bar (every screen) ───────────────────────────────┐
│  [avatar]            JACOB / context title      [🔔 3]  │
│  ⚠ active incident banner (only when one exists)        │
└────────────────────────────────────────────────────────┘
        … screen content …
┌─ Bottom tab bar ───────────────────────────────────────┐
│ [Groups]  [Ministry]  [Events]  [Boards]   [Manage•]    │
│  chat      the word     what's    cross-     queues      │
│  home      + grow       coming    group      (leader/    │
│                          up        forums     owner/     │
│                                               admin)     │
└────────────────────────────────────────────────────────┘
```

| Tab | Job it owns | Entities / endpoints | Who sees it |
|-----|-------------|----------------------|-------------|
| **Groups** | Read & post; catch up; Watch Together — the gravity well | `groups`, `messages`(+threads), reactions, stickers, `watch` | everyone |
| **Ministry** | The owner's word + your discipleship | `weekly_sermons`, `ministry_feed`, `devotionals`, `reading_plans`, `plan_progress` | everyone (compose gated to owner/leader) |
| **Events** | What's coming up; RSVP | `events`, `rsvps` | everyone |
| **Boards** | Cross-group peer forums | `boards`, posts (sticker-tagged), replies, reactions | everyone |
| **Manage** | Approvals + leader apps + moderation + org | `joinRequests`, `leader_applications`, `reports`, `appeals`, `incidents`, `orgs` | leader / owner / admin |
| 🔔 Bell | Activity inbox | `notifications` | everyone |
| avatar | Self + prefs + safety | `users/{uid}`, `notification-prefs`, `devices`, `muted-groups`, `mutes`/`blocks`, `wellbeing` | everyone |

**Why merge weekly sermon + ministry feed + devotionals + plans into one "Ministry" tab:** they're
all the *same voice* — the leadership teaching for your growth — and folding them honors principle
1.1 (one home for the owner's voice, distinct from peer chat/boards). It also collapses what would
otherwise be a separate `/feed` tab, a `/grow` tab, and a weekly-sermon hero into a single coherent
destination. Boards stays its own tab because it is the *peer* voice — exactly the broadcast-vs-forum
separation ADR 0011 insists on.

### 4.3 Pre-shell state: the waiting room

A user with no approved membership (no `members/{uid}` anywhere; their `joinRequests` are still
`pending`) gets **no tab bar** — just the waiting-room screen: their pending requests with *who*
approves each (leader for adults, owner for minors), a `/discover/groups` browse list, and the
invite-code accept path (`/invites/{code}`). The shell appears the moment their first request is
approved (`onJoinRequestWrite` creates the membership). *Why:* tabs leading to permission-denied
surfaces are a bad first impression; the waiting room is a deliberate single-purpose pre-state.

### 4.4 Job → destination map (every §3 job lands somewhere)

| Job | Destination |
|-----|-------------|
| Read & post in my group | Groups → chat |
| Catch up / unread | Groups (unread) + 🔔 |
| Reply in thread / react | Groups → chat → thread |
| Watch together | Groups → group → Watch |
| Hear the ministry's word | Ministry (weekly sermon + feed) |
| Read devotional / follow plan | Ministry → Devotionals / Plans |
| See what's coming up & RSVP | Events |
| Browse cross-group forums | Boards |
| Find & join a group | Groups → "Find a group" (`/discover`) + invite accept |
| Manage notifications / muted groups | avatar → Settings |
| Report / get help | inline overflow on content + avatar → Help & wellbeing |
| Approve adults (leader) | Manage → Requests |
| Pin / moderate my chat (leader) | Groups → chat (inline) |
| Create/manage events (leader) | Events → "+" + group landing |
| Author group devotional (leader) | Ministry → "+" (group-scoped) |
| Approve minors (owner) | Manage → Approvals → Minors (distinct) |
| Review leader applications (owner) | Manage → Leader applications |
| Broadcast (owner) | Ministry → "+" (feed post) |
| Publish weekly sermon (owner) | Ministry → "+" (this week) |
| Triage reports / appeals (admin) | Manage → Safety → Reports / Appeals |
| Incident banner (admin) | Manage → Safety → Incidents |
| Org profile (latent) | Manage → Org |

Every job has one obvious home. Nothing is orphaned; nothing lives in two places.

---

## 5. Key screens

Text wireframes. For each: above the fold, the **primary** action, secondary actions, and what's
behind overflow (`⋯`). Mobile width assumed (~390px).

### 5.1 Waiting room (pre-shell)

```
┌──────────────────────────────────────────┐
│ Welcome to Christ-Centered BJJ            │
│ You're almost in.                         │
├──────────────────────────────────────────┤
│ YOUR REQUESTS                             │
│  • Tuesday Teens      ⏳ Awaiting leader  │  ← joinRequests, leader decides
│  • Friday Open Mat    ⏳ Awaiting owner   │  ← requiresOwnerReview (minor)
├──────────────────────────────────────────┤
│ FIND A GROUP                              │
│  ┌────────────────────────────────────┐  │  ← /discover/groups
│  │ Saturday Fundamentals   [Request →]│  │
│  │ 12 members · public                │  │
│  └────────────────────────────────────┘  │
│  Have an invite link?  [ Enter code ]     │  ← /invites/{code}/accept
├──────────────────────────────────────────┤
│ ⓘ What happens next                       │
│   A leader reviews adult requests; the    │
│   ministry owner approves under-18s.      │
└──────────────────────────────────────────┘
```
- **Above fold:** your pending requests, honest about *who* the approver is (leader vs owner).
- **Primary:** request to join a discovered group (or accept an invite code).
- **Minor + consent pending:** a banner replaces the browse list — "We've emailed your guardian
  for permission; you'll get in once the owner approves." (`parentalConsentObtained` is owner-
  attested at decision time, ADR 0015.)

### 5.2 Groups — home (multi-group member)

```
┌──────────────────────────────────────────┐
│ [avatar]   Groups               [🔔 3]    │
├──────────────────────────────────────────┤
│ 🔎 Search your groups                     │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ ● Tuesday Teens                12:04│   │  ● = unread
│ │   Marcus: bring a gi for new fol…   │   │  ← last message preview
│ ├────────────────────────────────────┤   │
│ │   Friday Open Mat              Mon  │   │
│ │   You: see everyone there 🙏        │   │
│ ├────────────────────────────────────┤   │
│ │   Saturday Fundamentals       3d    │   │
│ │   📺 Watch Together is live         │   │  ← active watch_session
│ └────────────────────────────────────┘   │
│              [ + Find a group ]           │  ← /discover
└──────────────────────────────────────────┘
        [Groups] Ministry Events Boards
```
- **Above fold:** `groups/mine` ordered by recency; unread dot; last-message preview; a live
  Watch Together gets a badge.
- **Primary:** tap a group → chat.
- **Single-group member:** skip this list — land directly in the one group's chat. The list earns
  its keep only when there's more than one group.

### 5.3 Group chat (the most important screen)

```
┌──────────────────────────────────────────┐
│ ‹  Tuesday Teens          [👥]    [⋯]     │  ⋯ = group landing/overflow
├──────────────────────────────────────────┤
│ 📌 Coach Dan: No class next Mon (holiday) │  ← pinned strip
├──────────────────────────────────────────┤
│   Marcus  11:58                           │
│   🙏 Prayer Request                        │  ← author-applied sticker (compose-time tag)
│   bring a gi for new folks                │
│   👍 3   🙏 1        💬 2 replies  ›       │  ← reaction slugs + threadReplyCount
│                                           │
│        ┌──────────────────────────────┐  │
│        │ on it — got two spares    You│  │  ← own msg, optimistic
│        │ 12:01                  ✓ sent │  │
│        └──────────────────────────────┘  │
│   ── Aiden joined the group ──            │  ← system line, centered/muted
├──────────────────────────────────────────┤
│ [＋] [ Message…              ] [😀] [➤]   │  ＋ = sticker/photo, 😀 = quick react
└──────────────────────────────────────────┘
```
- **Above fold:** pinned strip (if any) + latest messages. SSE-live (ADR 0013); optimistic send
  shows `✓ sent` then reconciles; polling is the fallback.
- **Primary:** send a message.
- **Secondary (long-press):** React (emoji slug) · Reply (opens thread) · Copy · (leader/author)
  Delete (soft) · Report.
- **`[＋]`:** attach a sticker tag (`Prayer Request` / `Praise Report` / `Check-In` / `Amen`) or a
  photo (routes through the moderation upload pipeline before it's visible).
- **Threads** (`💬 N replies ›`): tap → thread view (`/messages/{mid}/thread`) — a focused
  sub-conversation, not inline nesting.
- **System messages** (joins, event created/cancelled) render centered and muted, never as a bubble.
- **Sync affordance:** a 2px hairline under the header pulses on reconnect; no blocking spinner.

### 5.4 Group landing / about

Reached from the chat `[⋯]` or the `[👥]` icon — the group's home base when you need more than the
stream.

```
┌──────────────────────────────────────────┐
│ ‹  Tuesday Teens                          │
├──────────────────────────────────────────┤
│ Tuesday Teens · private · 14 members      │  ← name, isPrivate, memberCount
│ "Teen class, ages 13–17. Gi required."    │  ← description
├──────────────────────────────────────────┤
│ 📌 Pinned (2)                          ›   │
│ 📅 Next: Open Mat · Fri 6pm            ›   │  ← next group event
│ 📺 Start Watch Together                ›   │  ← /groups/{gid}/watch (leader)
├──────────────────────────────────────────┤
│ MEMBERS                          🔎        │
│  ◆ Coach Dan      leader                   │
│    Marcus         member                    │
│    Aiden          member · 16  ⚠           │  ← isMinor marker (leader/owner only)
│  … (14)                                     │
├──────────────────────────────────────────┤
│ [ Mute this group ]   [ Leave group ]      │  ← muted-groups / POST /leave
│ — leader only —                            │
│ [ + Event ]  [ Edit group ]  [ Invites ]   │  ← events / PATCH groups / invites
└──────────────────────────────────────────┘
```
- **Above fold:** identity + pinned + next event + Watch Together entry.
- **Primary (member):** browse members / jump to pinned.
- **Secondary:** mute group push (`muted-groups`), leave, search members.
- **Leader inline:** create event, edit group, manage invite links, change member roles.
- **Minor marker:** members who are `isMinor` carry a quiet age marker visible only to leaders and
  the owner — a consistent expression of principle 1.3.

### 5.5 Ministry — the owner's word + your growth

```
┌──────────────────────────────────────────┐
│ [avatar]   Ministry             [🔔 3]    │
├──────────────────────────────────────────┤
│ THIS WEEK                                 │
│ ┌────────────────────────────────────┐   │  ← weekly_sermons (current ISO week)
│ │ ▶  "Abiding in the Vine"           │   │
│ │    Sermon · 32 min                 │   │
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ FROM THE MINISTRY                         │  ← ministry_feed (owner broadcast)
│ ┌────────────────────────────────────┐   │
│ │ Sunday devotional                  │   │
│ │ Jacob · 2d                         │   │
│ │ "Markdown body excerpt…"           │   │
│ │ 🙏 12      (react — no replies)     │   │  ← one-way by design (ADR 0011)
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ YOUR PLAN                                 │  ← reading_plans + plan_progress
│ Foundations of Faith · Day 7/21          │
│ ▓▓▓▓▓▓░░░░░░   [ Read today → ]           │
├──────────────────────────────────────────┤
│ DEVOTIONALS                          ›    │  ← merged platform + your groups' feed
│  • The Lord is my shepherd · Psalm 23     │
│  • Strength in weakness · 2 Cor 12        │
│                          — owner/leader —  │
│                       [ + Post / Sermon ]  │  ← ministry-feed / weekly-sermon / devotional
└──────────────────────────────────────────┘
```
- **Above fold:** the week's sermon (the hero), then the latest broadcast post.
- **Primary (member):** play the sermon / read the latest ministry post / resume the plan.
- **Reactions only on `ministry_feed`** — no reply affordance (broadcast, like a sermon).
- **Compose (`+`)** is role-gated: an **owner** can post to the feed, set the weekly sermon, and
  author platform devotionals; a **leader** can author a group-scoped devotional. The same FAB,
  different sheet by claim.
- **Devotionals** merges platform-wide (owner-authored) with those scoped to the viewer's groups
  (`GET /devotionals`), labeled by source.

### 5.6 Events — list & detail

```
┌─ list ───────────────────────────────────┐   ┌─ detail ─────────────────────────────────┐
│ [avatar]   Events           [🔔 3]        │   │ ‹  Open Mat                        [⋯]    │
├──────────────────────────────────────────┤   ├──────────────────────────────────────────┤
│ [ Upcoming ]  Past                        │   │ Fri, Jun 5 · 6:00–8:00 PM                 │
├──────────────────────────────────────────┤   │ 📍 Main Dojo · Tuesday Teens              │
│ THIS WEEK                                 │   ├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │   │ Open rolling, all levels. Bring water.    │
│ │ Fri · Jun 5 · 6:00 PM              │   │   ├──────────────────────────────────────────┤
│ │ Open Mat · Tuesday Teens           │   │   │ ARE YOU GOING?                            │
│ │ ✅ Going (8) · you're going         │   │   │ [ ✅ Going ] [ 🤔 Maybe ] [ ✕ Can't ]     │  ← POST …/rsvp
│ └────────────────────────────────────┘   │   │ Going 8 · Maybe 3 · Can't 1               │  ← rsvp summary
│ ┌────────────────────────────────────┐   │   │  ▸ Marcus, Sarah, Aiden, +5               │  ← GET …/rsvps
│ │ Sat · Jun 6 · Belt Testing         │   │   ├──────────────────────────────────────────┤
│ │ [CANCELLED]  Saturday Fundamentals │   │   │ + Add to calendar                         │
│ └────────────────────────────────────┘   │   └──────────────────────────────────────────┘
│                       — leader only —     │     ⋯ (leader): Edit · Cancel (sets cancelledAt,
│                    [ + New event ]        │         posts a system message to the group)
└──────────────────────────────────────────┘
```
- **List above fold:** soonest events by week; your RSVP status visible without tapping; cancelled
  events stay listed with a badge.
- **Detail primary:** set RSVP — three big targets (`going|maybe|declined`), current choice
  highlighted, optional `note`. Changing your mind is one tap; no edit mode.
- **Leader/owner:** "+ New event"; overflow → edit/cancel.

### 5.7 Boards — list & post detail

Boards are *peer* forums (admin-created, `audience`-scoped) — the community talking to itself, kept
deliberately separate from the owner's Ministry voice.

```
┌─ board list ─────────────────────────────┐   ┌─ post detail ────────────────────────────┐
│ [avatar]   Boards           [🔔 3]        │   │ ‹  Pray for Marcus's grandma              │
├──────────────────────────────────────────┤   │ 🙏 Prayer Request                          │  ← required sticker tag
│ ┌────────────────────────────────────┐   │   │ Coach Dan · 5h                            │
│ │ Prayer & Praise                ●   │   │   │ She's in surgery Thursday. 🙏              │
│ │ "Pray for Marcus's grandma" · 5h   │   │   │ [ 🙏 12 ] [ ❤️ 4 ] [ + ]                   │  ← reactionCounts
│ │ 31 posts                           │   │   ├──────────────────────────────────────────┤
│ ├────────────────────────────────────┤   │   │ REPLIES (6)                               │  ← flat, chronological
│ │ Testimonies                        │   │   │  Sarah · 4h · Praying now 🙏              │
│ │ "New season starting" · 1d         │   │   │  Aiden · 3h · 🙏🙏                         │
│ └────────────────────────────────────┘   │   ├──────────────────────────────────────────┤
│                              🔎 search    │   │ [ Write a reply…                    ] [➤] │
└──────────────────────────────────────────┘   └──────────────────────────────────────────┘
```
- **Board list above fold:** the audience's boards with last-post preview + new-activity dot.
- **Post detail above fold:** the post (with its **required** sticker tag), its reaction bar, then
  flat replies (ADR-defined — no nested threading on boards).
- **Primary:** reply. **Secondary:** react (one slug per user per post), search within board.
- **Compose a post** requires ≥1 sticker; **pin** is `admin`-only.
- **Overflow:** report; (author within edit window / admin) edit/delete (`deletedAt`).

### 5.8 Member profile (within a group)

```
┌──────────────────────────────────────────┐
│ ‹                                  [⋯]    │
├──────────────────────────────────────────┤
│            Sarah Klein                     │
│            member · Tuesday Teens          │
├──────────────────────────────────────────┤
│ ALSO IN                                   │
│  • Friday Open Mat                         │  ← shared groups only
├──────────────────────────────────────────┤
│ [ Message in group ]                      │  ← no DMs in the model; jump to shared chat
├──────────────────────────────────────────┤
│ ⋯  Mute Sarah · Block Sarah · Report      │  ← mutes / blocks / reports
└──────────────────────────────────────────┘
```
- **Above fold:** who they are, role in *this* group.
- **Primary:** there's no DM collection — primary is "jump to where we both are." We don't invent
  private messaging.
- **Secondary/overflow:** mute (`users/{uid}/mutes`), block (`users/{uid}/blocks` — one-directional),
  report.
- **Leader/owner viewing a minor:** the profile shows the `isMinor` marker and a path into the
  moderation context — principle 1.3.

### 5.9 Leader's "requests to approve"  (Manage → Requests)

```
┌──────────────────────────────────────────┐
│ ‹  Requests                               │
├──────────────────────────────────────────┤
│ TUESDAY TEENS                             │  ← /groups/{gid}/requests
│ ┌────────────────────────────────────┐   │
│ │ Jordan Lee · adult · 2h ago        │   │
│ │            [ ✕ Decline ] [ ✓ Approve ]│ │  ← approve → onJoinRequestWrite → membership
│ ├────────────────────────────────────┤   │
│ │ Aiden Brooks · ⚠ minor (16) · 1h   │   │
│ │ Owner approval required            │   │  ← requiresOwnerReview: true
│ │            [ ✕ Decline ] [ 🔒 ⓘ ]   │   │  ← approve LOCKED for leader
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```
- **Above fold:** pending `joinRequests` for the leader's group(s), longest-waiting first.
- **Primary:** Approve (adult) — one tap; the backend approve endpoint refuses minor rows
  (`403 minor_owner_review_required`), so the button is locked with that exact reason.
- **Minor rows are present but locked**, not hidden — transparency for the leader.
- **Secondary:** Decline (optional reason); tap a row → requester profile.

### 5.10 Owner's "minors to approve" + leader applications  (Manage → Approvals)

The owner's approval surface has minors **first**, loud, then leader applications, then a roll-up of
all groups' adult requests.

```
┌──────────────────────────────────────────┐
│ ‹  Approvals                              │
├──────────────────────────────────────────┤
│ ⚠ MINORS — YOUR APPROVAL REQUIRED   (2)   │  ← amber, top, can't collapse away
│ ┌────────────────────────────────────┐   │
│ │ Aiden Brooks · 16                  │   │
│ │ wants to join: Tuesday Teens       │   │
│ │ Parental consent: ✅ on file        │   │  ← parentalConsentObtained
│ │     [ View ] [ ✕ Decline ] [ ✓ Approve ]│
│ ├────────────────────────────────────┤   │
│ │ Mia Tran · 14 → Saturday Fund.     │   │
│ │ Parental consent: ⏳ attest at approve│  │  ← owner attests at decision time
│ │     [ View ]            [ ✓ Approve… ] │ │  → consent confirmation step
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ LEADER APPLICATIONS                  (1)   │  ← /admin/leader-applications
│ ┌────────────────────────────────────┐   │
│ │ Dana wants to start "Wed Women's"  │   │
│ │ "motivation…"                      │   │
│ │     [ View ] [ ✕ Reject ] [ ✓ Approve ]│  ← approve CREATES the group, Dana = leader
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ ADULT REQUESTS (all groups)          (3)   │  ← below; normal weight
│  • Jordan Lee → Tuesday Teens  [✓][✕]      │
└──────────────────────────────────────────┘
```
- **Above fold:** minors, always first, in an amber band that can't be scrolled past (principle 1.3).
- **Consent is explicit** — shown if on file, attested in a confirmation step at approve time when
  not (ADR 0015).
- **Leader applications** are the owner's other unique queue — approving one *creates the group*
  with the applicant as its leader.
- **Primary:** clear the highest-stakes item (a minor).

### 5.11 Manage hub (leaders / owners / admins)

```
┌──────────────────────────────────────────┐
│ [avatar]   Manage               [🔔 3]    │
├──────────────────────────────────────────┤
│ ┌── at a glance ──────────────────────┐  │
│ │ ⚠ 2 minors waiting · 5 to approve   │  │  ← owner counts
│ │ 🚩 3 reports · 1 appeal             │  │  ← admin counts
│ └─────────────────────────────────────┘  │
│ — your group (leader) —                   │
│ 👥 Requests                       (5) ›   │  ← §5.9
│ — ministry (owner) —                      │
│ 🧒 Approvals (minors + leaders)   (3) ›   │  ← §5.10
│ — safety (admin) —                        │
│ 🚩 Reports                        (3) ›   │  ← /admin/reports; §5.12
│ 📨 Appeals                        (1) ›   │  ← /admin/appeals
│ 📢 Incident banners                   ›   │  ← /admin/incidents
│ 📊 Transparency                       ›   │  ← transparency_reports
│ — org (latent) —                          │
│ ⚙ Org profile & invites               ›   │
└──────────────────────────────────────────┘
```
- **Sections light up by claim** (principle 1.5): a pure leader sees only "your group"; the pilot
  founder (owner + admin) sees all of it; a hosted owner without `admin` sees ministry but not
  safety.
- **Above fold:** the count card answers "is anything wrong" in one glance.
- **Primary:** whichever queue carries the highest badge.

### 5.12 Moderation review (admin) — Manage → Safety → Reports

```
┌──────────────────────────────────────────┐
│ ‹  Reports                                │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ ⚑ Reported message                 │   │  ← reports/{reportId}
│ │ in Tuesday Teens · 1h              │   │
│ │ "…the offending text in context…"  │   │
│ │ Reason: harassment · by Sarah      │   │
│ │  [ Dismiss ]  [ Remove ]  [ Ban ⋯ ]│   │  ← resolve / soft-delete / bans
│ ├────────────────────────────────────┤   │
│ │ 🚩 Auto-flagged image              │   │  ← moderation_queue (Vision/NL)
│ │ in Friday Open Mat · by Marcus     │   │
│ │ [ blurred thumbnail ]              │   │
│ │  [ Dismiss ]  [ Remove ]  [ View ] │   │
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```
- **Above fold:** one card per item, content in context, reason, verb buttons.
- **Primary:** the decision — Remove (`deletedAt`) or Dismiss (`/admin/reports/{id}/resolve`);
  one tap, the queue advances.
- **Secondary:** Ban (overflow → reason + `expiresAt` → `bans/{uid}`); View full context.
- **Honest about scope:** CSAM-path content (`ncmec_cases`, ADR 0010) is **never** rendered here —
  it's backend-only quarantine + NCMEC escalation. The UI never shows it.

### 5.13 Notifications (the bell)

```
┌──────────────────────────────────────────┐
│ ‹  Notifications        [ Mark all read ] │  ← POST /users/me/notifications/read
├──────────────────────────────────────────┤
│ ● Sarah replied to you            12:04   │  ● unread → deep link to the thread
│ ● ⚠ Aiden (16) requests approval   1h     │  → Manage → Approvals → Minors
│ ● Jacob posted in the Ministry feed  2d   │  ← ministry_feed (opt-in)
│   Friday Open Mat · 6pm           Mon      │  ← event reminder
└──────────────────────────────────────────┘
```
- **Above fold:** newest first; unread dot; each row deep-links to the exact entity.
- **Primary:** tap → the message/thread, ministry post, event, or approval queue.
- **No settings here** — prefs live in avatar → Settings; the bell is purely the feed.
- Owner/admin safety rows (minor pending, report filed) carry the same amber accent used in Manage,
  so the signal reads consistently everywhere.

### 5.14 Settings (avatar)

```
┌──────────────────────────────────────────┐
│ ‹  You                                    │
├──────────────────────────────────────────┤
│ Marcus Reed · member   [ Edit profile ]   │  ← PATCH /users/me
├──────────────────────────────────────────┤
│ 🔔 Notifications                       ›   │  ← prefs matrix, below
│ 🔕 Muted groups                        ›   │  ← muted-groups
│ 🚫 Muted & blocked people              ›   │  ← mutes / blocks
│ ❤️ Help & wellbeing                    ›   │  ← wellbeing/resources + checkin
│ 📥 Download my data                    ›   │  ← exports
│ 🚪 Sign out                                │
└──────────────────────────────────────────┘

  Notifications →   (per-category × channel; /users/me/notification-prefs)
┌──────────────────────────────────────────┐
│                            Push   Email   │
│ Group messages             [ ✔]   [  ]    │
│ Replies & mentions         [ ✔]   [  ]    │
│ Ministry feed              [  ]   [  ]    │  ← default OFF (ADR 0011 §4)
│ Events                     [ ✔]   [ ✔]    │
│ Approvals*                 [ ✔]   [ ✔]    │  *leaders/owner only
│ System / incidents         [ ✔]🔒  [ ✔]   │  ← locked on
└──────────────────────────────────────────┘
```
- **Above fold:** identity + the handful of self-controls.
- **Primary:** edit notification prefs — the real per-category push/email grid; `ministryFeed`
  defaults off (ADR 0011), incidents locked on.
- **Secondary:** muted groups (per-group push silence), muted/blocked people, **Help & wellbeing**
  (crisis resources + a private check-in), data export, sign out.
- The Approvals row only renders for leaders/owner.

### 5.15 Org profile (owner) — Manage → Org  *(latent, T54)*

```
┌──────────────────────────────────────────┐
│ ‹  Org                                    │
├──────────────────────────────────────────┤
│ Christ-Centered BJJ                        │  ← orgs/{orgId}
│ jacob.app/o/ccbjj      [ Copy join link ] │  ← org slug / discovery entry
│ 96 members · 6 groups                      │  ← denormalized counters
├──────────────────────────────────────────┤
│ GROUPS & LEADERS                           │
│  Tuesday Teens   · Coach Dan      14   ›   │
│  Saturday Fund.  · (no leader)    9    ›   │  ← prompts to approve a leader app
├──────────────────────────────────────────┤
│ ⚙ Org profile (name, logo, audience)   ›   │
│ 💳 Billing (free)                      ›   │  ← billing shape reserved
└──────────────────────────────────────────┘
```
- **Above fold:** org identity + the share/join link + at-a-glance counts.
- **Primary:** copy the join link; spot groups without a leader.
- **Admin-overlay-ready:** this whole section is one role gate from becoming org-admin-only later
  (ADR 0007 / T54) with no restructure. Marked latent because the org onboarding UI is Phase 3.5.

---

## 6. Interaction patterns

The recurring micro-interactions, designed once and reused.

### 6.1 Threads & replies in chat
Long-press a message → **Reply** opens its **thread** (`/messages/{mid}/thread`) — a focused
sub-view, with the parent pinned at top and `threadReplyCount` reflected back on the parent in the
main stream (`💬 N replies ›`). This is a real thread model (`parentMessageId`), not inline quoting.
Top-level chat stays scannable; depth lives in the thread. (Thread realtime currently polls; chat
itself is SSE — the UI shows the same hairline sync affordance in both.)

### 6.2 Stickers vs. reactions (two distinct things)
- **Stickers** are *author-applied tags chosen at compose time* — `Prayer Request`, `Praise
  Report`, `Check-In`, `Amen` (`stickerIds` / `stickers` collection). They categorize a message or
  (required) a board post. The compose `[＋]` opens the sticker picker.
- **Reactions** are *responses to someone else's content* — a fixed emoji allowlist
  (`like|love|pray|laugh|wow|sad`) via `/react`, one slug per user, counts denormalized
  (`reactionCounts`). The quick-react row lives in the long-press sheet.
One visual language for each across chat, boards, and the ministry feed (feed = reactions only, no
replies).

### 6.3 The approval flow (the product's signature interaction)
A join request lands as a notification **and** a Manage badge.
- **Adult → leader or owner:** one tap Approve on `/groups/{gid}/requests` → `onJoinRequestWrite`
  creates the membership → the new member is in, gets notified, and a welcome system message posts
  to the group.
- **Minor → owner only:** the request sits in the amber MINORS band; Approve walks through a
  parental-consent attestation when consent isn't already on file (ADR 0015). A leader who opens
  the same request sees it locked ("Owner approval required") — present, not hidden.
- **Leader applications → owner only:** approving on `/admin/leader-applications` *creates the
  group* with the applicant as leader. A different queue, same one-tap-clear feel.
Request → notify → one-tap clear → applicant notified: designed to take the approver under ten
seconds and to make a waiting minor impossible to overlook.

### 6.4 Drafts, optimistic send & sync
Chat sends optimistically (appears immediately, `✓ sent` → confirmed; on failure, a retry
affordance with the text preserved). Composer text persists per-conversation locally if you
navigate away. Ministry posts, board posts, events, and devotionals use a normal form-submit with
a saving state — deliberate, lower-frequency writes. Across every polled surface: keep last data,
show the 2px "updating" hairline, never a full-screen spinner after first load (ADR 0013, principle
1.7).

### 6.5 Moderation triage (admin)
The Reports queue (§5.12) is built for speed: each item is a self-contained card with content in
context, the reason, and verb buttons. Decisions are one tap and the card animates out —
Dismiss (`/admin/reports/{id}/resolve`) or Remove (`deletedAt`), with Ban behind an overflow that
asks for a reason + `expiresAt` (`bans/{uid}`). User-reported (`reports`) and auto-flagged
(`moderation_queue`, Vision/NL) items share the queue with distinct icons. CSAM-path content never
appears (backend-only, NCMEC).

### 6.6 RSVP
Three large mutually-exclusive targets (Going / Maybe / Can't) on the event detail; tapping issues
`POST …/rsvp` and optimistically updates the summary. An optional one-line `note` appears after you
pick. Changing your mind is just tapping a different target — no separate edit mode.

### 6.7 Watch Together
From a group (or an event), a leader starts a session (`POST /groups/{gid}/watch`); members join
(`/join`), the player stays in sync via `/heartbeat` + `/control`, and the group list flags it as
live. It's a *group-scoped* shared-presence feature, so it lives inside Groups — not a top-level
tab — surfacing as a banner in the group and a badge on the group row.

### 6.8 Notification → deep link
Every notification is a doorway. Each carries enough to land you on the exact message/thread,
ministry post, event, or approval queue — push and in-app share one resolver. Reading sets the row
read; the bell badge and the source surface's unread state clear together.

### 6.9 Scoped search
Search is always inside a context and labeled as such ("Search Tuesday Teens," "Search Prayer &
Praise," "Find a member"). Results are keyword matches over `searchTokens` (ADR 0016) — we don't
promise fuzzy/ranked results and don't offer a global search the backend can't honor. Empty states
say plainly: "keyword search only — try a different word."

---

## 7. What's different from where we are today

The deltas a reviewer should weigh — the gap between this and a typical cleanup of the current
`/home` (weekly-sermon hero + recent-activity), `/groups`, `/feed`, `/grow`, `/admin` + bottom-tab
+ drawer layout.

1. **The drawer is gone.** All navigation lives in the bottom tab bar + top bar — no hamburger, no
   hidden nav. (1.6 / §4.1)
2. **`/feed` + `/grow` + the weekly-sermon hero merge into one "Ministry" tab.** The owner's whole
   teaching voice — `ministry_feed`, `weekly_sermons`, `devotionals`, `reading_plans` — lives in
   one coherent destination instead of three. (1.1 / §5.5)
3. **The recent-activity home is replaced by landing in the group.** No synthetic cross-collection
   feed; approved members land in chat (or a one-tap group list). (1.2 / §5.2)
4. **`/admin` becomes a role-aware "Manage" tab whose sections light up by claim** —
   `ministry_owner`, `admin`, and `leader` duties are visibly separated rather than lumped into one
   admin area. (1.5 / §5.11)
5. **Approvals are split into two honest queues with the minor path made loud** — leader-decided
   adult `joinRequests`, owner-decided minors + `leader_applications`, with minors pinned in an
   amber band that can't be scrolled past and explicit parental-consent state. (1.3 / §5.9–5.10)
6. **Boards are reframed as the *peer* voice, distinct from the ministry broadcast** — they are not
   the announcement surface (that's `ministry_feed`); posts keep their required sticker tag and flat
   replies. (1.1 / §5.7)
7. **Notifications leave the tab bar** for a top-bar bell with a badge — an inbox you visit, not a
   destination you dwell in. (§4.1 / §5.13)
8. **No global search.** Search is demoted to a scoped, in-context control matching what
   `searchTokens` can actually do. (ADR 0016 / §6.9)
9. **Single-group members skip the group list** and land straight in their one chat. (§5.2)
10. **The group "landing/about" is a deliberate home-base screen** (members, pinned, next event,
    Watch Together, leader controls) rather than controls crammed into the chat header. (§5.4)
11. **Stickers and reactions are visibly two different things** — author-applied tags at compose
    vs. an emoji response set — with one consistent treatment each across chat/boards/feed. (§6.2)
12. **Safety is a member-facing surface, not just an admin one** — Watch Together, wellbeing
    resources + check-in, muted-groups, and one-directional block all get explicit, reachable homes
    in Settings and inline. (§5.14 / §6.7)

---

## 8. Recommended rollout

Stage it so each phase ships something usable and the riskiest surfaces come last.

**Phase 1 — The shell + the gravity well.** New navigation (role-aware bottom tabs + top bar,
drawer removed, incident banner slot), the waiting room (+ discover/invite accept), Groups (list +
chat with threads/reactions/stickers/optimistic send) and the group landing. ~80% of member value;
validates the IA before investing further.

**Phase 2 — The two voices + the orbit.** Ministry (weekly sermon + feed + devotionals + plans),
Boards (list + post detail), Events (list + detail + RSVP), Notifications bell + deep links,
Settings + the prefs matrix + wellbeing. Rounds out the full member/leader experience on the new
shell.

**Phase 3 — The duties.** The Manage hub with claim-gated sections: leader Requests, owner
Approvals (minors + leader applications), admin Safety (reports, appeals, incidents, transparency,
bans). The highest-stakes, lowest-frequency surfaces — built once the queue/badge patterns are
proven.

**Phase 4 — Watch Together, org & polish.** Watch Together inside Groups, the org dashboard
(latent → live as T54 lands), search-everywhere scoping, and an offline/PWA edge-state pass. Sets
up the org-admin overlay and growth (shareable join link) without further restructure.

---

*End of proposal. Nothing here is built; this is a direction to react to. Tell me which principles
and screens land, which don't, and we'll cut the agreed parts into tickets.*
