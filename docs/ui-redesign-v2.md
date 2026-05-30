# JACOB — Greenfield UI Redesign Proposal (v2)

*Drafted 2026-05-29. A clean-sheet design derived from what JACOB **does**, not from the
current frontend. Grounded in ADR 0016 (data model), 0011 (roles), 0009 (onboarding/approval),
0010 (notifications), 0012 (events), 0013 (boards), 0014 (plans), 0015 (moderation),
0007 (org), 0004 (realtime). No existing screens were read while writing this — the intent
is a fresh idea, not a cleanup of what exists.*

This is a proposal to react to, not a spec to build. Pick a direction; we'll turn the chosen
parts into tickets afterward.

---

## 0. The app in one breath

A member opens JACOB to answer one of three questions: *what did my group say, what's
coming up, and what should I read today.* A leader adds a fourth: *who's waiting on me.* The
owner adds a fifth: *is anything wrong.* Everything below is built to make each of those
questions answerable in one tap from a cold open.

The unit of belonging is the **group** (`groups/{gid}`). Everything else — boards, events,
plans, the daily verse — orbits it. The design treats the group as the gravity well and
refuses to bury it under a generic "feed."

---

## 1. Design principles

Six commitments. Each one is a tiebreaker we can hold a screen against.

### 1.1 One screen answers one question
Every top-level destination has a single job and a single primary action. Groups answers
"what's new in my group." Events answers "what's coming up, am I going." Grow answers "what
do I read today." We do **not** build a dashboard home that answers all of them at once —
dashboards answer everything and nothing, and on a phone they push the real content below
the fold. *Why:* the data model is cleanly partitioned (`messages`, `events`, `boards`,
`plans`); the UI should inherit that partition instead of blending it into a soup.

### 1.2 The group is the gravity well — land people in it
The most frequent session, by a wide margin, is "read/post in my group." So the default
landing for an approved member is their group chat (single-group) or a one-tap group list
(multi-group) — not a synthetic activity feed assembled from six collections. *Why:*
`lastMessageAt`/`lastMessagePreview` are denormalised onto `groups/{gid}` precisely so the
group list is cheap and fast; the home that's cheapest to render is also the one people
actually want.

### 1.3 Minors are never invisible to the owner
Per ADR 0011, minor approval never delegates — it always escalates to the owner. The UI
makes the owner's view of pending minors a first-class, badged, always-reachable surface,
visually distinct from adult approvals. A minor in the system is never more than one tap from
the owner's attention. *Why:* this is the single most safety-critical flow in the product
(`isMinor`, `guardianUid`, guardian consent, owner approval); it earns dedicated pixels, not a
row in a generic list.

### 1.4 Duties are work queues, not settings
Approvals (`members.status == "pending"`), reports (`reports.status == "open"`), and the
moderation queue (`flaggedAt` + reports) are *inboxes with counts and one-tap actions*, not
configuration screens you navigate into and hunt around. A leader or owner should see a number,
tap it, and clear it. *Why:* these are recurring obligations with a clear "done" state — the
inbox-with-badge pattern is the honest representation; a settings page is not.

### 1.5 Role widens the same app — it is not a different app
There is no separate "admin app" and no `/admin` section that feels like a different product.
Members, leaders, and owners share one shell. Privileges appear inline where the work is
(a pin action in chat, a "create event" button on the group, an approve button on a member
row) and the queue-shaped duties collect in a single role-gated **Manage** destination. *Why:*
in v1 the owner and org admin are the same person (ADR 0011 §org-admin overlay); the role
boundary is fluid and should feel like permission, not partition.

### 1.6 Optimistic, quiet, never blank
Chat is SSE; everything else polls (ADR 0004). After first load we never show a full-screen
spinner — last data stays on screen, a thin "updating" hairline shows sync, and chat sends
optimistically and reconciles. *Why:* the runtime is polling + PWA + church-wifi; a design that
flashes spinners on every 30s poll would feel broken even when it's working perfectly.

---

## 2. User archetypes

Five people. The first three drive 95% of sessions.

### 2.1 The Ministry Owner — "Jacob"
The founder. One per org. Lives in the app daily, mostly on his phone between sessions on the
mat. He created the org (ADR 0007), creates groups, appoints leaders, and is the *only* person
who can approve a minor or resolve a report. **A typical session:** opens from a push
("a minor requests approval"), clears the Manage queue (1 minor pending + 1 flagged image),
drops an announcement on the org board, RSVPs himself to Friday's open mat, closes the app.
~2 min, high-stakes. He is the only user who routinely touches every surface.

### 2.2 The Group Leader — a coach
Leads exactly one group (sometimes two). Appointed by the owner. Approves *adult* join
requests for their group, posts to the leaders board, creates the group's events, moderates
their own chat. **A typical session:** opens from a push ("2 people want to join Tuesday
Teens"), approves both adults, sees a minor request he *can't* action (disabled, "handled by
the ministry owner"), posts "bring a gi for new folks" to chat, creates next week's event.
A few times a week.

### 2.3 The Adult Member — a regular
The bulk of users. Comes to chat, RSVP, and read. Doesn't manage anything. **A typical
session:** opens from a push ("Sarah replied to you"), reads the thread, sends a reaction and a
reply, checks if there's anything on Saturday, marks "going," taps today's plan day on the way
out. 60–90 seconds, several times a week. Mobile, often one-handed, often on a flaky
connection in a gym.

### 2.4 The Minor Member — a teen
Same jobs as an adult — chat, events, plans — but wrapped in safety. Signed up under 18, so
`isMinor: true` and a `guardianUid` is on file. Could not enter until a guardian consented
*and* the owner approved (ADR 0009). **A typical session:** identical to the adult member's,
plus the system around them is doing more — their content is the most likely to be reviewed,
and the owner is one tap from anything about them. The minor never sees this machinery; they
just see chat.

### 2.5 The Org Admin — latent
In v1 the same human as the owner (ADR 0011). The role exists so a ministry can later split
"spiritual leadership" (owner) from "platform/billing administration" (admin) without a schema
change. **Design stance:** we surface billing and org-profile editing inside the owner's Manage
hub now, behind an "Org" section, structured so it can later be gated to an admin-only role
without moving anything. We do not build a separate admin persona UI in v1.

---

## 3. Jobs to be done

Per archetype, ranked by frequency (most frequent first). Each job names the entities it
touches so §4 can map it to a destination.

### Adult / Minor Member
1. **Read & post in my group** — `messages` (text/image), `replyToId`, reactions. *Many times/week.*
2. **Catch up on what I missed** — unread in `groups` (via `lastMessageAt`), notifications.
3. **React / reply to a specific message** — `reactionCount`, `replyToId`.
4. **See what's coming up & RSVP** — `events`, `events/{eid}/rsvps/{uid}`.
5. **Read today's verse / my plan day** — `daily_verse`, `plans`, `plan_progress`.
6. **Read announcements & prayer requests** — `boards` (org scope), reactions.
7. **Check who else is in my group** — `groups/{gid}/members`, member profiles.
8. **Manage my own notifications** — `notificationPrefs` (channel × category).
9. **Report something / block someone** — `reports`, `users/{uid}/blocks`.
10. **Join another group** — public `groups`, new `members` doc (`status: pending`).

### Group Leader (adds, on top of member jobs)
1. **Approve adults waiting on my group** — `members.status: pending` → `active`. *The signature job.*
2. **Post to chat as the leader / pin the important thing** — `messages`, `pinnedAt`.
3. **Create & manage my group's events** — `events`, cancel sets `cancelledAt`.
4. **Moderate my group** — soft-delete (`deletedAt`), see `flaggedAt`.
5. **Post to the leaders board** — `boards` (leaders scope).
6. **See who's pending vs active in my group** — `members.status`.

### Ministry Owner (adds, on top of leader jobs)
1. **Approve minors** — `members.status` for `isMinor` users, org-wide. *Never delegated.*
2. **Triage the moderation queue** — `flaggedAt` messages + open `reports`.
3. **Ban / handle appeals** — `bannedAt`, `appeals`.
4. **Create groups & appoint leaders** — `groups`, `members.role`.
5. **Post org-wide announcements** — `boards` (Announcements, owner/leader-post).
6. **Author & publish plans** — `plans`, `days`, `isPublished`.
7. **Watch the org at a glance** — `memberCount`, `groupCount`, pending/flag counts.
8. **Manage org profile, slug, billing** — `orgs/{orgId}`, `org_slugs`.

---

## 4. Information architecture

### 4.1 The form: a role-aware bottom tab bar

**Decision: a persistent bottom tab bar, 4 tabs for members, a 5th badged "Manage" tab for
leaders and owners. Notifications and profile live in a slim top bar. Search is scoped inside
each surface, never a global tab.**

Why a bottom tab bar over a hamburger drawer or a side rail:

- **Thumb reach.** This is a one-handed, mobile-first, PWA experience used in a gym. The four
  most-frequent destinations must be reachable by the thumb without a menu tap. A hamburger
  drawer hides the primary navigation behind a deliberate gesture — wrong for surfaces people
  hit dozens of times a week. A side rail is a desktop idiom that wastes horizontal space on a
  phone.
- **Few enough destinations.** The member's jobs (§3) collapse cleanly into exactly four
  buckets. Four is inside the "tab bars should be ≤5" rule with room for the role-gated fifth.
- **Predictable shell.** The four member tabs never move or reorder by role. A leader's app is
  a member's app *plus* a Manage tab — same muscle memory, wider surface (principle 1.5).

Why **not** put notifications or profile in the tab bar: notifications are a transient inbox
you visit and leave, not a place you dwell — a top-right **bell with an unread badge** is the
honest control. Profile/settings is infrequent — a top-left (or top-right) **avatar** is enough.
Putting either in the bottom bar would spend a precious thumb slot on a low-frequency action.

Why search is **not** a tab: per ADR 0008 search is keyword-only and *scoped* — messages within
a group, posts within a board, members within an org. A global search box would promise
cross-everything results the backend can't give. Search lives as a contextual control inside
Groups (find a message), Boards (find a post), and the member list (find a person).

### 4.2 The destinations

```
┌─ Top bar (every screen) ───────────────────────────────┐
│  [avatar]            JACOB / context title      [🔔 3]  │
└────────────────────────────────────────────────────────┘
        … screen content …
┌─ Bottom tab bar ───────────────────────────────────────┐
│  [Groups]   [Boards]   [Events]   [Grow]   [Manage•]    │
│   chat       church-     what's     read     queue       │
│   home       wide        coming    today    (leader/     │
│                          up                  owner only) │
└────────────────────────────────────────────────────────┘
```

| Tab | Job it owns | Entities | Who sees it |
|-----|-------------|----------|-------------|
| **Groups** | Read & post; catch up; the gravity well | `groups`, `messages`, `members` | everyone |
| **Boards** | Announcements, prayer, leaders discussion | `boards`, posts, replies, reactions | everyone (leaders board gated within) |
| **Events** | What's coming up; RSVP | `events`, `rsvps` | everyone |
| **Grow** | Daily verse + plans + progress | `daily_verse`, `plans`, `plan_progress` | everyone |
| **Manage** | Approvals + moderation + org admin | `members(pending)`, `reports`, `appeals`, `orgs`, `groups` | leaders, owners |
| 🔔 Bell | Activity inbox | `notifications` | everyone |
| avatar | Self + settings + prefs | `users/{uid}`, `notificationPrefs`, `devices`, `blocks`, `mutes` | everyone |

### 4.3 Pre-shell state: the waiting room

An unapproved user (no `members` doc with `status: active` anywhere) gets **no tab bar at all**
— just the waiting-room screen (ADR 0009): their pending requests, a browse-public-groups list,
and a "what happens next" explainer. The shell appears the moment they're approved into their
first group. *Why:* tabs that lead to empty, permission-denied surfaces would be a confusing
first impression; the waiting room is a deliberate, single-purpose pre-state.

### 4.4 Job → destination map (every §3 job lands somewhere)

| Job | Destination |
|-----|-------------|
| Read & post in my group | Groups → chat |
| Catch up on what I missed | Groups (unread badges) + 🔔 |
| React / reply to a message | Groups → chat (long-press / inline) |
| See what's coming up & RSVP | Events |
| Read verse / plan day | Grow |
| Announcements & prayer | Boards |
| See group members | Groups → group landing → Members |
| Manage my notifications | avatar → Settings → Notifications |
| Report / block | inline overflow on the content + avatar → Settings → Blocked |
| Join another group | Groups → "Find a group" + waiting-room browse |
| Approve adults (leader) | Manage → Approvals |
| Pin / moderate (leader) | Groups → chat (inline, role-gated) |
| Create/manage events (leader) | Events → "+" (role-gated) + group landing |
| Post to leaders board | Boards → Leaders |
| Approve minors (owner) | Manage → Approvals → Minors (distinct section) |
| Triage moderation | Manage → Review |
| Ban / appeals | Manage → Review → user / Appeals |
| Create groups / appoint leaders | Manage → Org → Groups |
| Org-wide announcements | Boards → Announcements ("+") |
| Author/publish plans | Grow → "+" (role-gated) / Manage → Org → Plans |
| Org at a glance | Manage (hub top card) |
| Org profile / slug / billing | Manage → Org → Settings |

Every job has exactly one obvious home. Nothing is orphaned; nothing is in two places.

---

## 5. Key screens

Text wireframes. For each: what's above the fold, the **primary** action, secondary actions,
and what's behind overflow (`⋯`). Mobile width assumed (~390px).

### 5.1 Waiting room (pre-shell)

```
┌──────────────────────────────────────────┐
│ Welcome to [Org Name]                     │
│ You're almost in.                         │
├──────────────────────────────────────────┤
│ YOUR REQUESTS                             │
│  • Tuesday Teens      ⏳ Awaiting leader  │
│  • Friday Open Mat    ⏳ Awaiting owner   │  ← minor → owner
├──────────────────────────────────────────┤
│ BROWSE GROUPS                             │
│  ┌────────────────────────────────────┐  │
│  │ Saturday Fundamentals   [Request →]│  │
│  │ 12 members · public                │  │
│  └────────────────────────────────────┘  │
│  … more public groups …                   │
├──────────────────────────────────────────┤
│ ⓘ What happens next                       │
│   A leader reviews adult requests; the    │
│   ministry owner approves under-18s.      │
└──────────────────────────────────────────┘
```
- **Above fold:** your pending requests with *who* is the approver (leader vs owner — honest
  about the delegated flow).
- **Primary:** Request to join a public group.
- **Secondary:** none — this screen does one thing.
- **For minors:** if `isMinor` and guardian consent is still outstanding, a banner replaces the
  browse list: "We've emailed your guardian for permission. You'll get in once they say yes and
  the owner approves."

### 5.2 Groups — home (multi-group member)

```
┌──────────────────────────────────────────┐
│ [avatar]   Groups               [🔔 3]    │
├──────────────────────────────────────────┤
│ 🔎 Search your groups                     │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ ● Tuesday Teens                12:04│   │  ● = unread dot
│ │   Marcus: bring a gi for new fol…   │   │  ← lastMessagePreview
│ ├────────────────────────────────────┤   │
│ │   Friday Open Mat              Mon  │   │
│ │   You: see everyone there 🙏        │   │
│ ├────────────────────────────────────┤   │
│ │   Saturday Fundamentals       3d    │   │
│ │   Coach Dan pinned a message        │   │
│ └────────────────────────────────────┘   │
│                                           │
│              [ + Find a group ]           │
└──────────────────────────────────────────┘
        [Groups] Boards Events Grow
```
- **Above fold:** ordered by `lastMessageAt`, newest first; unread dot; `lastMessagePreview`.
- **Primary:** tap a group → chat.
- **Secondary:** search; "Find a group" (browse public, request to join).
- **Single-group member:** skip this list entirely — land directly in the one group's chat.
  The list only earns its keep when there's more than one group.

### 5.3 Group chat (the most important screen)

```
┌──────────────────────────────────────────┐
│ ‹  Tuesday Teens          [👥]    [⋯]     │  ⋯ = group landing/overflow
├──────────────────────────────────────────┤
│ 📌 Coach Dan: No class next Mon (holiday) │  ← pinned strip (tap to jump)
├──────────────────────────────────────────┤
│                                           │
│   Marcus  11:58                           │
│   bring a gi for new folks                │
│   👍 3   🙏 1                             │
│                                           │
│        ┌──────────────────────────────┐  │
│        │ on it — got two spares    You│  │  ← own msg, right-aligned
│        │ 12:01                  ✓ sent │  │
│        └──────────────────────────────┘  │
│                                           │
│   Sarah  12:04                            │
│   ↳ replying to Marcus: "bring a gi…"     │  ← replyToId quote chip
│   what sizes?                             │
│                                           │
├──────────────────────────────────────────┤
│ [＋] [ Message…              ] [🙂] [➤]   │
└──────────────────────────────────────────┘
```
- **Above fold:** the pinned strip (if `pinnedAt` exists) + the latest messages. SSE-live;
  optimistic send shows `✓ sent` then reconciles.
- **Primary:** send a message.
- **Secondary (inline):** long-press a message → React / Reply / Copy / (leader+) Pin / (leader+
  or author) Delete / Report.
- **`[＋]`:** attach image (routes through moderation before it's visible per ADR 0015).
- **Overflow `[⋯]`:** group landing (members, about, events, leave group), search this group's
  messages.
- **System messages** (`type: system` — joins, event created/cancelled, welcome) render as
  centered, muted, full-width lines — never as a person's bubble.
- **Polling/SSE affordance:** a 2px hairline under the header pulses on reconnect; never a
  blocking spinner (principle 1.6).

### 5.4 Group landing / about

Reached from the chat overflow `[⋯]` or the `[👥]` header icon. This is the group's "home base"
when you need more than the message stream.

```
┌──────────────────────────────────────────┐
│ ‹  Tuesday Teens                          │
├──────────────────────────────────────────┤
│ [ group photo ]                           │
│ Tuesday Teens · public · 14 members       │
│ "Teen class, ages 13–17. Gi required."    │  ← description
├──────────────────────────────────────────┤
│ 📌 Pinned (2)                          ›   │
│ 📅 Next: Open Mat · Fri 6pm            ›   │  ← next event for this group
├──────────────────────────────────────────┤
│ MEMBERS                          🔎        │
│  ◆ Coach Dan      leader                   │
│    Marcus         member                    │
│    Sarah          member                    │
│    Aiden          member · 16  ⚠           │  ← minor marker (owner/leader see it)
│  … (14)                                     │
├──────────────────────────────────────────┤
│ [ Mute notifications ]   [ Leave group ]   │
│ — leader only —                            │
│ [ + Create event ]  [ Edit group ]  [⋯]    │
└──────────────────────────────────────────┘
```
- **Above fold:** identity (photo, name, visibility, count, description), pinned + next event.
- **Primary (member):** browse members / jump to pinned.
- **Secondary:** mute (`notificationsMuted`), leave, search members.
- **Leader/owner inline:** create event, edit group, manage members (appoint, remove).
- **Minor marker:** members who are `isMinor` carry a quiet age/guardian marker visible only to
  leaders and the owner — a small, consistent expression of principle 1.3.

### 5.5 Events — list

```
┌──────────────────────────────────────────┐
│ [avatar]   Events               [🔔 3]    │
├──────────────────────────────────────────┤
│ [ Upcoming ]  Past                        │  ← segmented; default Upcoming
├──────────────────────────────────────────┤
│ THIS WEEK                                 │
│ ┌────────────────────────────────────┐   │
│ │ Fri · Jun 5 · 6:00 PM              │   │
│ │ Open Mat                           │   │
│ │ Tuesday Teens · Main Dojo          │   │  ← groupId + location
│ │ ✅ Going (8)  · you're going        │   │  ← rsvpCount + your status
│ └────────────────────────────────────┘   │
│ ┌────────────────────────────────────┐   │
│ │ Sat · Jun 6 · 10:00 AM             │   │
│ │ Belt Testing       [CANCELLED]     │   │  ← cancelledAt badge, stays visible
│ │ Saturday Fundamentals              │   │
│ └────────────────────────────────────┘   │
│ LATER                                     │
│  …                                        │
│                          — leader only —  │
│                       [ + New event ]     │
└──────────────────────────────────────────┘
```
- **Above fold:** soonest events grouped by week; your RSVP status visible without tapping.
- **Primary (member):** tap → detail → RSVP.
- **Secondary:** Upcoming/Past toggle.
- **Leader/owner:** floating "+ New event" (creates for *their* group).
- Cancelled events stay listed with a badge (ADR 0012), not removed.

### 5.6 Event detail

```
┌──────────────────────────────────────────┐
│ ‹  Open Mat                        [⋯]    │
├──────────────────────────────────────────┤
│ Fri, Jun 5 · 6:00–8:00 PM                 │
│ 📍 Main Dojo                              │
│ Tuesday Teens                             │
├──────────────────────────────────────────┤
│ Open rolling for all levels. Bring water. │  ← description
├──────────────────────────────────────────┤
│ ARE YOU GOING?                            │
│ [  ✅ Going  ] [ 🤔 Maybe ] [ ✕ Can't ]   │  ← writes rsvps/{uid}.status
│                                           │
│ Going 8 · Maybe 3 · Can't 1              │  ← rsvpCount map
│  ▸ Marcus, Sarah, Aiden, +5              │  ← tap to expand roster
├──────────────────────────────────────────┤
│ + Add to calendar                         │
└──────────────────────────────────────────┘
```
- **Above fold:** when/where/which-group + the RSVP control (the whole point of the screen).
- **Primary:** set RSVP — three big targets, current choice highlighted, with an optional `note`.
- **Secondary:** see who's going; add to device calendar.
- **Overflow `[⋯]`** (leader/owner): edit, cancel (sets `cancelledAt`, posts a system message
  to the group chat per ADR 0012).

### 5.7 Boards — list

```
┌──────────────────────────────────────────┐
│ [avatar]   Boards               [🔔 3]    │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ 📣 Announcements                   │   │
│ │ "Belt testing moved to June" · 2h  │   │  ← lastPost preview + lastPostAt
│ │ 18 posts                           │   │
│ ├────────────────────────────────────┤   │
│ │ 🙏 Prayer Requests             ●   │   │  ● = new since last visit
│ │ "Pray for Marcus's grandma" · 5h   │   │
│ │ 31 posts                           │   │
│ ├────────────────────────────────────┤   │
│ │ 🔒 Leaders                         │   │  ← scope:"leaders", only if leader/owner
│ │ "Curriculum for new teens" · 1d    │   │
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```
- **Above fold:** the org's boards with last-post preview and a new-activity dot.
- **Primary:** open a board → its posts.
- **Visibility:** `scope: "leaders"` boards only appear for leaders/owner (ADR 0013). The
  Announcements board is read-for-all, post-for-owner/leader — the compose button simply isn't
  there for members.

### 5.8 Board / post detail

```
┌──────────────────────────────────────────┐
│ ‹  Prayer Requests                 🔎     │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │  ← a post (thread head)
│ │ Pray for Marcus's grandma          │   │  title
│ │ Coach Dan · 5h                     │   │
│ │ She's in surgery Thursday. 🙏       │   │  body
│ │ 🙏 12   ❤️ 4      · 6 replies  ›     │   │  reactions + replyCount
│ └────────────────────────────────────┘   │
│ ┌────────────────────────────────────┐   │
│ │ New season starting                │   │
│ │ Sarah · 1d · 🙏 8 · 2 replies   ›   │   │
│ └────────────────────────────────────┘   │
│                                           │
│                         [ + New post ]    │  ← gated on board scope/role
└──────────────────────────────────────────┘

  tap a post →
┌──────────────────────────────────────────┐
│ ‹  Pray for Marcus's grandma              │
│ Coach Dan · 5h                            │
│ She's in surgery Thursday. 🙏             │
│ [ 🙏 12 ] [ ❤️ 4 ] [ + ]                  │  ← one reaction per user per post
├──────────────────────────────────────────┤
│ REPLIES (6)                               │  ← flat, chronological (ADR 0013)
│  Sarah · 4h  · Praying now 🙏             │
│  Aiden · 3h  · 🙏🙏                        │
│  …                                        │
├──────────────────────────────────────────┤
│ [ Write a reply…                    ] [➤] │
└──────────────────────────────────────────┘
```
- **Above fold (board):** posts newest-active first; reaction + reply counts inline.
- **Above fold (post):** the post body and its reaction bar; replies below.
- **Primary:** reply to the post.
- **Secondary:** react (single emoji slug per user), search within board.
- **Overflow:** report; (author/leader/owner) edit/delete (`deletedAt`).
- **Replies are flat** — deliberately, per ADR 0013. No nested threading to design around.

### 5.9 Member profile (within a group)

```
┌──────────────────────────────────────────┐
│ ‹                                  [⋯]    │
├──────────────────────────────────────────┤
│            [ photo ]                      │
│            Sarah Klein                     │
│            member · Tuesday Teens          │
│            joined Apr 2026                  │
├──────────────────────────────────────────┤
│ ALSO IN                                   │
│  • Friday Open Mat                         │  ← shared groups only
├──────────────────────────────────────────┤
│ [ Message in group ]                      │  ← jumps to chat, no DMs in v1
├──────────────────────────────────────────┤
│ ⋯  Mute Sarah · Block Sarah · Report      │  overflow
└──────────────────────────────────────────┘
```
- **Above fold:** who they are, role in *this* group, tenure.
- **Primary:** there's no DM system in the data model — primary is "jump to where we both are"
  (the shared group chat). We don't invent private messaging.
- **Secondary/overflow:** mute (`mutes`), block (`blocks`), report (`reports`).
- **Owner/leader viewing a minor:** the profile shows the `isMinor` marker and `guardianUid`
  on file (guardian contact), plus a "View activity" affordance into the moderation context —
  again, principle 1.3.

### 5.10 Leader's "members to approve"  (Manage → Approvals)

```
┌──────────────────────────────────────────┐
│ ‹  Approvals                              │
├──────────────────────────────────────────┤
│ TUESDAY TEENS                             │
│ ┌────────────────────────────────────┐   │
│ │ [photo] Jordan Lee                 │   │
│ │ adult · requested 2h ago           │   │
│ │            [ ✕ Decline ] [ ✓ Approve ]│ │  ← status → active
│ ├────────────────────────────────────┤   │
│ │ [photo] Aiden Brooks               │   │
│ │ ⚠ minor (16) · requested 1h ago    │   │
│ │ Owner approval required            │   │  ← approve DISABLED for leader
│ │            [ ✕ Decline ] [ 🔒 ⓘ ]   │   │  tooltip: handled by owner
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```
- **Above fold:** pending `members` (`status: pending`) for the leader's group(s), oldest-waiting
  surfaced first.
- **Primary:** Approve (adult) — one tap flips `status` to `active`, fires `member_approved`
  notification + a welcome system message (ADR 0009).
- **Minor rows are present but the Approve action is locked** with the exact ADR 0011 copy:
  "Minor approvals are handled by the ministry owner." The leader still *sees* the request —
  transparency, not a hidden queue.
- **Secondary:** Decline (with optional reason); tap the row for the requester's profile.

### 5.11 Owner's "minors to approve"  (Manage → Approvals → Minors)

The owner's Approvals screen has two clearly separated sections; minors come **first** and are
visually loud.

```
┌──────────────────────────────────────────┐
│ ‹  Approvals                              │
├──────────────────────────────────────────┤
│ ⚠ MINORS — YOUR APPROVAL REQUIRED   (2)   │  ← amber section, top, can't collapse away
│ ┌────────────────────────────────────┐   │
│ │ [photo] Aiden Brooks · 16          │   │
│ │ wants to join: Tuesday Teens       │   │
│ │ Guardian: ✅ consented (mom@…)      │   │  ← guardian consent state, explicit
│ │ requested 1h ago                   │   │
│ │      [ View ]  [ ✕ Decline ] [ ✓ Approve ]│
│ ├────────────────────────────────────┤   │
│ │ [photo] Mia Tran · 14              │   │
│ │ wants to join: Saturday Fundamentals│  │
│ │ Guardian: ⏳ awaiting consent       │   │  ← approve disabled until consent
│ │      [ View ]            [ 🔒 waiting ] │ │
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ ADULTS  (across all groups)         (3)   │  ← normal weight, below
│  • Jordan Lee → Tuesday Teens  [✓][✕]     │
│  …                                        │
└──────────────────────────────────────────┘
```
- **Above fold:** minors, always first, in an amber band that doesn't collapse — the owner can
  never "scroll past" a waiting minor (principle 1.3).
- **Guardian consent is shown explicitly.** Approve is locked until both guardian consent *and*
  the owner's tap (ADR 0009); the lock states *why*.
- **Primary:** Approve a consented minor.
- **Secondary:** View (full minor profile + guardian contact), Decline, then the adult queue.

### 5.12 Manage hub (leaders / owners)

```
┌──────────────────────────────────────────┐
│ [avatar]   Manage               [🔔 3]    │
├──────────────────────────────────────────┤
│ ┌── at a glance ──────────────────────┐  │  ← owner only; counters from orgs/{orgId}
│ │ 96 members · 6 groups               │  │
│ │ ⚠ 2 minors waiting · 5 to approve   │  │
│ │ 🚩 3 to review                       │  │
│ └─────────────────────────────────────┘  │
│                                           │
│ 👥 Approvals                      (5) ›   │  ← §5.10 / §5.11
│ 🚩 Review (moderation)            (3) ›   │  ← owner only; §5.13
│ 📨 Appeals                        (1) ›   │  ← owner only
│ — Org — (owner)                           │
│ 🏠 Groups & leaders                   ›   │  create groups, appoint leaders
│ 📖 Plans                              ›   │  author/publish plans
│ ⚙ Org settings                       ›   │  name, slug, billing, share link
└──────────────────────────────────────────┘
```
- **Above fold:** the count card — the owner's "is anything wrong" answered in one glance,
  driven by denormalised counters + queue sizes.
- **Primary:** whichever queue has a non-zero badge; the design pulls the eye to the highest
  count.
- **Leader's Manage** is thinner: just Approvals (their groups) + their group's event/plan
  shortcuts. No Review/Appeals/Org.

### 5.13 Moderation review queue (owner)

```
┌──────────────────────────────────────────┐
│ ‹  Review                                 │
├──────────────────────────────────────────┤
│ [ All ] Flagged  Reported                 │  ← flaggedAt (auto) vs reports
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ 🚩 Auto-flagged image              │   │
│ │ in Tuesday Teens · by Marcus · 1h  │   │
│ │ [ thumbnail, blurred ]             │   │  ← Vision SafeSearch hit
│ │ Reason: possible violence (auto)   │   │
│ │  [ Dismiss ]  [ Remove ]  [ Ban ⋯ ]│   │
│ ├────────────────────────────────────┤   │
│ │ ⚑ Reported message                 │   │
│ │ "…" · reported by Sarah            │   │  ← reports/{reportId}
│ │ Reason: harassment                 │   │
│ │  [ Dismiss ]  [ Remove ]  [ View ] │   │
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```
- **Above fold:** one card per item, the offending content shown in context (blurred image until
  tapped), the reason, and the verb buttons.
- **Primary:** the decision — Remove (sets `deletedAt`) or Dismiss (clears from queue,
  `reports.status: dismissed`). Both are one tap; the queue advances.
- **Secondary:** Ban (overflow → reason → `bannedAt`), View full context (jump to the message in
  chat).
- **Honest about scope:** CSAM hash hits (ADR 0015) are *never* shown here — they're
  backend-only quarantine + NCMEC escalation. The UI never renders that content.

### 5.14 Notifications (the bell)

```
┌──────────────────────────────────────────┐
│ ‹  Notifications        [ Mark all read ] │
├──────────────────────────────────────────┤
│ ● Sarah replied to you            12:04   │  ● unread (readAt null)
│   "what sizes?" — Tuesday Teens           │  → deep link to message (linkPath)
│ ● ⚠ Aiden (16) requests approval   1h     │  → Manage → Approvals → Minors
│   You're the only one who can approve     │
│   Friday Open Mat · 6pm           Mon      │  ← event reminder
│   Coach Dan posted in Announcements 2d     │
└──────────────────────────────────────────┘
```
- **Above fold:** newest first; unread dot; each line carries `actorName`/`actorPhotoURL` and a
  `linkPath` so the tap lands exactly on the thing.
- **Primary:** tap → deep link to the entity (`entityType`/`entityId`).
- **Secondary:** mark all read.
- **No settings here** — prefs live in avatar → Settings (§5.15); the bell is purely the feed.
- Owner's `minor_pending` / `report_filed` lines are styled with the same amber accent as the
  Manage queue, so the safety signal is consistent everywhere it appears.

### 5.15 Settings (avatar)

```
┌──────────────────────────────────────────┐
│ ‹  You                                    │
├──────────────────────────────────────────┤
│ [ photo ]  Marcus Reed                     │
│ marcus@… · member                          │
│ [ Edit profile ]                           │
├──────────────────────────────────────────┤
│ 🔔 Notifications                       ›   │  ← the matrix, §below
│ 🔇 Muted & blocked                     ›   │  ← mutes / blocks
│ 📥 Download my data                    ›   │  ← exports
│ ❓ Help & guidelines                   ›   │  ← legal/guidelines
│ 🚪 Sign out                                │
└──────────────────────────────────────────┘

  Notifications →   (channel × category matrix, ADR 0010)
┌──────────────────────────────────────────┐
│ Notifications              Push   Email   │
│ Messages                   [ ✔]   [  ]    │
│ Events                     [ ✔]   [ ✔]    │
│ Boards                     [ ✔]   [  ]    │
│ Plans                      [ ✔]   [  ]    │
│ Approvals*                 [ ✔]   [ ✔]    │  *leaders/owners
│ System                     [ ✔]🔒  [ ✔]   │  ← system/push locked on
└──────────────────────────────────────────┘
```
- **Above fold:** identity + the handful of self-controls.
- **Primary:** edit notification prefs — the literal channel × category grid from ADR 0010,
  with the `system`/`push` cell locked on for incidents.
- **Secondary:** muted/blocked management, data export, sign out.
- **Approvals row** only renders for leaders/owners (they're the only ones who get those
  notifications).

### 5.16 Grow (plans + verse)

```
┌──────────────────────────────────────────┐
│ [avatar]   Grow                 [🔔 3]    │
├──────────────────────────────────────────┤
│ TODAY · May 29                            │
│ ┌────────────────────────────────────┐   │
│ │ "Be strong and courageous…"        │   │  ← daily_verse/{date}
│ │ Joshua 1:9 (ESV)                   │   │
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ YOUR PLAN                                 │
│ ┌────────────────────────────────────┐   │
│ │ Foundations of Faith               │   │  ← plan + plan_progress
│ │ Day 7 of 21  ▓▓▓▓▓▓░░░░░░          │   │  completedDays/dayCount
│ │ [ Read today's day → ]             │   │
│ └────────────────────────────────────┘   │
├──────────────────────────────────────────┤
│ MORE PLANS                                │
│  • New Believers (14 days)        [Start] │  ← isPublished, org/group scope
│  • Prayer & Fasting (7 days)      [Start] │
│                          — leader only —  │
│                         [ + New plan ]    │
└──────────────────────────────────────────┘
```
- **Above fold:** today's verse (zero-friction, no plan needed) + your in-progress plan with a
  visible streak/progress bar.
- **Primary:** "Read today's day" — resumes at `currentDay`, marks `completedDays`/`lastReadAt`.
- **Secondary:** start another published plan.
- **Leader/owner:** "+ New plan" → authoring (`days`, `isPublished` draft/publish).

### 5.17 Org dashboard (owner) — Manage → Org

```
┌──────────────────────────────────────────┐
│ ‹  Org                                    │
├──────────────────────────────────────────┤
│ [ Org logo ]  Christ-Centered BJJ          │
│ jacob.app/join/ccbjj      [ Copy link ]   │  ← org_slugs, shareable join URL
│ 96 members · 6 groups                      │  ← denormalised counters
├──────────────────────────────────────────┤
│ GROUPS & LEADERS                     [+]   │
│  Tuesday Teens     · Coach Dan      14  ›  │  ← tap to edit / appoint leader
│  Friday Open Mat   · Coach Dan      22  ›  │
│  Saturday Fund.    · (no leader)    9   ›  │  ← prompts to appoint
│  …                                        │
├──────────────────────────────────────────┤
│ ⚙ Org profile (name, logo, slug)      ›   │
│ 💳 Billing (free plan)                ›   │  ← plan: free | ministry (latent)
│ 📊 Transparency reports               ›   │  ← transparency_reports
└──────────────────────────────────────────┘
```
- **Above fold:** the org identity + the **share/join link** (the single most-used owner growth
  action) + the at-a-glance counts.
- **Primary:** copy the join link; create a group.
- **Secondary:** appoint/replace leaders (groups with no leader are flagged), edit org profile,
  billing, transparency.
- **Admin-overlay-ready:** this whole section is one role gate away from being admin-only later,
  exactly as ADR 0011 anticipates — no restructure needed.

---

## 6. Interaction patterns

The recurring micro-interactions, designed once and reused everywhere.

### 6.1 Replying in chat
Long-press (or hover on desktop) a message → action sheet → **Reply**. The composer gains a
quote chip showing the parent's author + truncated body; sending writes `replyToId`. In the
stream, a reply renders the quote chip above the new message (tap the chip → scroll to parent).
No nested threads in group chat — replies are inline context, not a sub-conversation. (Threads
as a separate surface stay out of scope; the data model doesn't model them for group chat.)

### 6.2 Reactions & pins
Reactions are a quick-react row in the same long-press sheet; tapping an existing reaction pill
toggles yours. Counts come from the denormalised `reactionCount` map — optimistic increment,
reconcile on poll. **Pin** appears in the sheet only for leaders/owners; pinning surfaces the
message in the chat's pinned strip (§5.3) and the group landing. One visual language for
reactions across chat *and* boards (boards = one reaction per user per post).

### 6.3 The approval flow (the product's signature interaction)
A join request lands as a `member_pending` (or `minor_pending`) notification **and** a badge on
the Manage tab. The approver opens Approvals — a queue, not a settings page (principle 1.4).
- **Adult, by leader or owner:** one tap Approve → `status: active` → the member is instantly in,
  gets `member_approved` (push + email), and a welcome system message posts to the group.
- **Minor, owner only:** the row sits in the amber MINORS band, Approve locked until guardian
  consent is recorded, then one tap. A leader who opens the same request sees it but the Approve
  button is locked with "Minor approvals are handled by the ministry owner."
The whole loop — request → notify → one-tap clear → member notified + welcomed — is designed to
take the approver under ten seconds and to make a waiting minor impossible to overlook.

### 6.4 Drafts, optimistic send & sync
Chat sends optimistically: the message appears immediately, right-aligned, with a `✓ sent`
→ confirmed state; on failure it shows a retry affordance and the text is preserved (never lost
to a failed send). Composer text persists per-conversation if you navigate away and back
(local draft, not a server entity). Board posts and event/plan creation use a normal
form-submit with a saving state, since they're deliberate, lower-frequency writes. Across every
polled surface: keep last data on screen, show a 2px "updating" hairline, never a full-screen
spinner after first load (ADR 0004, principle 1.6).

### 6.5 Moderation triage (owner)
The Review queue (§5.13) is built for speed: each item is a self-contained card with the content
in context, the reason, and verb buttons. Decisions are one tap and the card animates out as the
queue advances — Dismiss (`reports.status: dismissed`) or Remove (`deletedAt`), with Ban behind
an overflow that asks for a reason. Auto-flagged (`flaggedAt`, Vision/NL) and user-reported
(`reports`) items share the queue but carry distinct icons so the owner knows whether a human or
a machine raised the flag. The queue never surfaces CSAM-path content (backend-only).

### 6.6 RSVP
Three large, mutually-exclusive targets (Going / Maybe / Can't) on the event detail; tapping
writes `rsvps/{uid}.status` and optimistically updates the `rsvpCount` summary. An optional
one-line `note` field appears after you pick. Changing your mind is just tapping a different
target — no separate "edit RSVP" mode.

### 6.7 Notification → deep link
Every notification is a doorway, not a dead end. Each carries `linkPath` + `entityType`/
`entityId`; tapping lands you on the exact message, post, event, or approval — not a generic
list. Push and in-app share the same destination logic (one resolver). Reading a notification
sets `readAt`; the bell badge and the source surface's unread state clear together.

### 6.8 Scoped search
Search is always inside a context and labeled as such: "Search Tuesday Teens," "Search Prayer
Requests," "Find a member." Results are keyword matches against `searchTokens` (ADR 0008) — we
don't promise fuzzy or ranked results, and we don't offer a global search that the backend can't
honor. Empty/!found states say plainly "keyword search only — try a different word."

---

## 7. What's different from where we are today

The eight–twelve changes a reviewer should weigh before committing — the delta from a typical
cleanup of the current `/home`, `/groups`, `/grow`, `/admin` + drawer + bottom-tab layout.

1. **The drawer is gone.** All navigation lives in the bottom tab bar + top bar. No hamburger,
   no hidden nav. (Principle 1.1 / §4.1.)
2. **`/home` is deleted as a destination.** There is no synthetic dashboard. Approved members
   land in their group (chat) or a one-tap group list; the daily verse moves to Grow. (1.2)
3. **`/admin` becomes a role-aware "Manage" tab, not a separate section.** It only appears for
   leaders/owners and is shaped as work queues with badges, not a settings area. (1.4 / 1.5)
4. **Minor approval gets its own loud, top-of-queue, amber surface** with explicit guardian-
   consent state — distinct from adult approvals, impossible to scroll past. (1.3 / §5.11)
5. **The tab set is role-invariant for members** (Groups, Boards, Events, Grow) and only *grows*
   by one for privileged users — the shell never reshuffles by role. (1.5 / §4.1)
6. **Notifications leave the tab bar** and become a top-bar bell with a badge; they're an inbox
   you visit, not a destination you dwell in. (§4.1 / §5.14)
7. **No global search.** Search is demoted to a scoped, in-context control inside Groups, Boards,
   and member lists — matching what `searchTokens` can actually do. (ADR 0008 / §6.8)
8. **Single-group members skip the group list entirely** and land straight in their one chat —
   the list only appears when it earns its keep. (§5.2)
9. **The group "landing/about" is split out from the chat stream** as a deliberate home-base
   screen (members, pinned, next event, leader controls) rather than controls crammed into the
   chat header. (§5.4)
10. **Moderation is a one-tap triage queue with content-in-context**, not a table of rows you
    click into — built for clearing, not browsing. (§5.13 / §6.5)
11. **Org admin is structured but latent** — billing/org-profile lives under Manage → Org now,
    gated so it can split to an admin role later with zero restructure. (ADR 0011 / §5.17)
12. **One reaction/pin/optimistic-send language across chat and boards** instead of per-surface
    patterns. (§6.1–6.2 / §6.4)

---

## 8. Recommended rollout

If this direction is chosen, stage it so each phase ships something usable and the riskiest
surfaces come last.

**Phase 1 — The shell + the gravity well.** New navigation (role-aware bottom tabs + top bar,
drawer removed), the waiting room, Groups (list + chat with replies/reactions/pins/optimistic
send), and the group landing. This is 80% of member value and validates the IA before we invest
in the rest.

**Phase 2 — The orbit.** Boards (list + post detail), Events (list + detail + RSVP), Grow (verse
+ plans + progress), Notifications bell + deep links, Settings + the prefs matrix. Rounds out
the full member/leader experience on the new shell.

**Phase 3 — The duties.** The Manage hub, Approvals (adult + the minor-specific owner surface),
the moderation Review queue, Appeals. The highest-stakes, lowest-frequency surfaces — built once
the shared patterns (queue cards, one-tap actions, badges) are proven in Phase 1–2.

**Phase 4 — The org & polish.** Org dashboard (groups/leaders, join link, billing-latent,
transparency), plan authoring, search-everywhere scoping, and a pass on offline/PWA edge states.
Sets up the admin-overlay split and growth (shareable `/join/{slug}`) without further
restructure.

---

*End of proposal. Nothing here is built; this is a direction to react to. Tell me which
principles and screens land, which don't, and we'll cut the agreed parts into tickets.*
