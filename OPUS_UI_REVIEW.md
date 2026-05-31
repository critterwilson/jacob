# JACOB UI Clutter Review

The authed app, taken as a whole, reads as mostly calm and deliberate. Several surfaces (the groups list, devotionals/reading-plans/sermons indexes, discover, analytics, notification settings, the chat composer) carry inline comments documenting prior de-cluttering work, and it shows: one clear primary action per page, a consistent `FloatingActionBar`-on-mobile / inline-on-desktop pattern, and good progressive disclosure of forms. The clutter that remains is concentrated in a few places: the **Events** surface (both list and detail) is the worst offender — dense, repetitive, and visually inconsistent with the rest of the app; the **group landing page** stacks a redundant top bar against two competing navigation blocks; the **admin nav** is a flat 13-item list that's hard to scan on mobile; and there are a handful of smaller redundancies (the `/grow` hub mirroring the drawer, settings entries duplicated between drawer and page, org audience shown three times). Nothing is outright broken, so there are no true P0s.

> Scope note: `/home` and `frontend/components/home/*` are excluded — they are redesigned in this same PR (weekly-sermon hero + recent-chat-activity). Everything below is the rest of the authed app.

## P0

_None. Every reviewed surface is usable in its normal flow; the issues below are friction and noise, not breakage. No inline fixes were required for this PR._

## P1

### Events list — RSVP buttons crowd every list row, competing with "open event"
**File:** `frontend/app/(authed)/groups/[gid]/events/page.tsx:219-239`
**Problem:** Each event row already has a title link (the primary action — open the event), a date line, and a location, then renders three more inline buttons (Going / Maybe / Can't) plus an "N going" count. On a list of several events that's 3 competing action buttons per card before the user has opened anything, and it duplicates the RSVP control that already lives on the event detail page (`events/[eventId]/page.tsx:231-245`).
**Fix:** Remove the inline RSVP buttons from the list rows. Keep the title, date, location, and a single read-only "N going" summary. RSVP belongs on the detail page where the user has context; the list should be a scannable index, not an action grid.

### Events detail — three stacked bordered cards plus six actions on one screen
**File:** `frontend/app/(authed)/groups/[gid]/events/[eventId]/page.tsx:226-280`
**Problem:** Below the header (which already holds Edit + Delete for leaders) the page stacks three separately-bordered sections in a row: an "RSVP" card, a "Member actions" strip ("I'm here" + "Add to calendar"), and (for leaders) a "Who's coming" roster. That's RSVP buttons, a stats line, a check-in button, a calendar button, edit, delete, and a roster all competing on one screen. The RSVP buttons are also lowercase ("going / maybe / no") while the list page labels them "Going / Maybe / Can't" — the same control with two different vocabularies.
**Fix:** Merge "RSVP" and "Member actions" into one "Your RSVP" block: the three status buttons, then "I'm here" and "Add to calendar" as secondary links beneath them, with the going/maybe/no counts as a single muted summary line. Drop one of the two border boxes. Normalize the button labels to match the list ("Going / Maybe / Can't").

### Group landing page — redundant nav header competing with two section blocks
**File:** `frontend/app/(authed)/groups/[gid]/page.tsx:62-93`
**Problem:** The top of the group page packs, in quick succession: an "All groups" link (top-right, line 73), a Report control (line 67), an "Open chat" primary button (line 89), a Mute button (line 92), then a 4-tile member sub-nav, then (for leaders) a 4-tile manage block. "Open chat" is the genuine primary action but it sits in a `flex-wrap` row beside Mute, and the page offers two visually similar 4-tile grids back to back. For a member the screen is one CTA + 4 tiles; for a leader it's one CTA + 8 tiles + 2 utility buttons + a back link.
**Fix:** Make "Open chat" unambiguously primary (full-width or visually dominant), and move the low-frequency Report control into an overflow / "…" menu rather than living in the title row next to "All groups". The two tile grids are fine as a pattern, but the leader "Manage group" block could collapse behind a single "Manage" disclosure since leaders visit it rarely compared to the member sections.

### Admin nav — flat 13-item list, unscannable as a horizontal mobile chip strip
**File:** `frontend/app/(authed)/admin/layout.tsx:10-27`
**Problem:** `ADMIN_NAV_LINKS` is a flat list of 13 destinations with no grouping. On desktop that's a long undifferentiated sidebar; on mobile (lines 67-90) it's a single horizontally-scrolling chip row where reaching "Wellbeing" (item 13) requires scrolling past everything. It also permanently surfaces "Applications (legacy)" (line 17) even though the comment says new signups never land there — a dead queue taking a top-level slot.
**Fix:** Group the links into sections (e.g. "Review": Queue / Leader applications / Minor reviews / NCMEC / Appeals; "Manage": Users / Groups / Boards; "Platform": Flags / Incidents / Transparency / Wellbeing) the same way the main drawer groups its nav. Move "Applications (legacy)" out of the primary list into the bottom of a "Review" group (or behind a "legacy" disclosure) so it stops occupying prime real estate.

### Grow hub duplicates the drawer's GROW section verbatim
**File:** `frontend/app/(authed)/grow/page.tsx:9-30`
**Problem:** `/grow` renders four cards — Devotionals, Reading plans, Discover groups, Search — which are the exact same four links the drawer already lists under its "Grow" group (`AppShell.tsx:50-58`). On desktop, where the drawer is always visible, this page is a second copy of navigation the user can already see. (The page comment acknowledges it exists mainly so the mobile "Grow" tab lands somewhere.)
**Fix:** Keep `/grow` as the mobile tab target, but on desktop either redirect `/grow` straight to `/devotionals` (its most-used child) or hide the redundant card grid at `md+` since the sidebar already provides those links. Don't maintain two parallel lists of the same four destinations.

## P2

### Org dashboard — "audience" shown three times
**File:** `frontend/app/(authed)/orgs/[orgId]/page.tsx:44-46, 96-97`
**Problem:** `org.audience` appears as the eyebrow above the title (line 45), again as a row in the "About this org" definition list (lines 96-97), and the "Created" date is likewise duplicated. The "About this org" card largely restates the header.
**Fix:** Drop the "Audience" row from the "About this org" dl (the eyebrow already states it). Keep only genuinely new facts (Created date) in the About card, or fold the whole card into the header so there's one canonical place for each fact.

### Group members — up to four controls per founder row
**File:** `frontend/app/(authed)/groups/[gid]/members/page.tsx:131-176`
**Problem:** A leader viewing the founder's row sees, inline: a "Flag concern" button, plus for other leaders Promote/Demote and "Make founder" — three role buttons that wrap onto a second line on mobile (`flex-wrap`, line 131). Across a member list this is a dense thicket of secondary buttons, and "Flag concern" (a moderation action) sits beside role-management actions that belong to a different mental category.
**Fix:** Collapse the per-row leader actions (Promote / Demote / Make founder) into a single "…" overflow menu per row, and move "Flag concern" into that same menu. The row then shows name + role badges with one quiet menu trigger, rather than 1-4 competing buttons.

### Board detail — always-expanded New Post form (with sticker picker) sits above the conversation
**File:** `frontend/app/(authed)/boards/[boardId]/page.tsx:53-57` (form defined in `frontend/components/boards/NewPostForm.tsx:100-162`)
**Problem:** The `NewPostForm` is rendered permanently expanded at the top of every board, including its full `StickerPicker` grid and a 3-row textarea, before any of the actual posts. A user arriving to read the board must scroll past a large composer every time, and the sticker grid is visually loud above quiet text posts.
**Fix:** Collapse the composer to a single "Share something…" prompt/button that expands the full form (sticker picker + textarea) on focus/click — the same progressive-disclosure pattern the Events page already uses for "New event". This keeps the reading surface calm and only surfaces the heavy form when someone actually wants to post.

### Sermons — preacher filter renders even with 0-1 preachers
**File:** `frontend/app/(authed)/groups/[gid]/sermons/page.tsx:74-88`
**Problem:** The "Filter by preacher" `Select` is always rendered, even on an empty archive or one with a single preacher, where it does nothing but add a control to an otherwise empty page. On the empty-state path the user sees a filter dropdown above a "No sermons yet" message.
**Fix:** Only render the filter when `preachers.length > 1`. With zero or one preacher there's nothing to filter, so the control is noise.

### Settings/drawer — Appeals, About, and FAQ appear in both the drawer and the /settings page
**File:** `frontend/components/nav/AppShell.tsx:60-65` and `frontend/app/(authed)/settings/page.tsx:20-30`
**Problem:** The drawer's "You" section lists Settings, Submit an appeal, About, FAQ. The `/settings` page then lists Account items, an Appeals section ("Submit an appeal"), and an Info section (About / FAQ / Guidelines / Terms / Privacy). So "Submit an appeal", "About", and "FAQ" each exist as a tap target in two places, and the drawer's "You" group is essentially a partial, less-complete copy of the /settings page it links to.
**Fix:** Reduce the drawer's "You" group to just "Settings" (and the conditional "Ministries") — let `/settings` be the single authoritative home for appeals/about/faq/legal. The drawer shouldn't half-duplicate a page it already links to.

## P3

### Members page — stray light-theme divider color on a dark surface
**File:** `frontend/app/(authed)/groups/[gid]/members/page.tsx:98`
**Problem:** The member list uses `divide-gray-200` while every other list in the app uses the theme token `divide-line`. On the dark `ink` background a near-white divider reads as a hard, out-of-palette line — small but it makes the one screen feel off compared to its siblings.
**Fix:** Change `divide-gray-200` to `divide-line` to match the rest of the app's lists (e.g. the settings and notifications lists).

### Events / event-edit forms — unstyled raw inputs that don't match the design system
**File:** `frontend/app/(authed)/groups/[gid]/events/page.tsx:104-141` and `events/[eventId]/page.tsx:166-203`
**Problem:** The event create/edit forms use bare `<input>`/`<textarea>` with only `border border-line` and no background or text color, so they inherit defaults rather than the `bg-ink-overlay text-cream` treatment used by `Input`/`Textarea` everywhere else. The title/description/location fields also have no visible labels (placeholder-only). It reads as a rougher, "unfinished" form than the rest of the app.
**Fix:** Replace the raw inputs with the shared `Input` / `Textarea` / `Select` components (as used in `GroupSettingsForm`), which carry the right colors, focus rings, and labels. This is consistency polish, not a structural change.

## Overall verdict

Excluding `/home`, the app reads as **mostly calm** — the core daily surfaces (chat, groups list, boards index, the Grow content indexes, settings) are clean, single-purpose, and show clear evidence of prior de-cluttering. The clutter is localized rather than pervasive. The three highest-leverage changes: (1) **fix the Events surface** end to end — strip RSVP buttons off list rows and merge the three stacked action cards on the detail page into one, since this is the densest and most inconsistent corner of the app; (2) **group the admin nav** into labeled sections so 13 flat destinations become scannable (and demote the legacy applications queue); (3) **stop the small duplications** — collapse the board composer behind a prompt, trim the drawer "You" group so it doesn't echo the /settings page, and skip the `/grow` card grid on desktop where the sidebar already covers it. None of these add features; they all subtract or consolidate. Per the task, P1+ items are left for a separate decision and are not implemented in this PR.
