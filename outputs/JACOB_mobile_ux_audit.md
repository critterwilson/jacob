# JACOB — mobile UX audit

Audited against origin/main @ e8aef67 (2026-05-20), iPhone-class viewport (~390×844).

The audit is driven by reading the component source and CSS tokens. The live staging walkthrough was used to verify the surfaces render; mobile emulation via Chrome MCP did not take effect on this machine, so live measurements were taken against the desktop layout. Where rendered dimensions are quoted, they come from CSS source (Tailwind utility classes) which are deterministic.

## Severity summary

| Severity | Count | Headline issues |
|---|---|---|
| BLOCKER | 4 | Message actions hover-only; chat composer below the viewport; ThreadPanel covers chat on mobile; search has no mobile entry point |
| HIGH | 8 | No safe-area handling; sub-44px tap targets; nav is hamburger-only; smooth-scroll yanks the page; `h-screen` everywhere; `text-sm` on the search input zooms on iOS focus |
| MEDIUM | 11 | Body scroll not locked behind modals; no drawer/sheet transitions; dialog focus restoration; long-URL overflow; tap padding on icon buttons; etc. |
| LOW | 7 | Undefined `text-cream-dim` token (13 call-sites); `text-xs` status indicators; polling cadence; copy nits |

---

## BLOCKERS

### B1 — Mobile users cannot reply, react, edit, delete, pin, announce, report, or flag any message
- **Surface:** group chat — message list
- **File:** `frontend/components/chat/MessageItem.tsx:328-401`
- **Problem:** the action chip row is wrapped in `className="absolute right-4 top-2 hidden gap-1 group-hover:flex"`. On touch there is no hover state, so the entire action set is unreachable. ReactionPicker, ReportButton, and WellbeingFlagButton are inside this same hover-gated row.
- **Severity:** BLOCKER. The chat is described as JACOB's most-used surface; the moderation flow and reactions are listed as primary features.
- **Fix:** reveal the action row on tap. Two viable patterns:
  1. **Tap-to-toggle row** (smallest change): track `activeMessageId` state on the parent; show the row when `data-message-id === activeMessageId || group-hover`. Tapping the message body toggles it. The row already exists as inline chips so the layout doesn't change.
  2. **Bottom-sheet menu** (richer): tap the message → open a sheet with the same actions as a vertical list. Larger tap targets, fewer overflow concerns on small screens.
  - Picked #1 in PR B because it ships in this PR without redesign.

### B2 — Chat composer sits below the visible viewport on mobile
- **Surface:** group chat — page layout
- **File:** `frontend/app/(authed)/groups/[gid]/chat/page.tsx:88`
- **Problem:** the chat page returns `<main className="flex h-screen flex-col …">`, but it is rendered as `{children}` inside `AuthedLayout` which wraps every authed page in `AppShell` + `<SearchBar />` + `<PushPrompt />` + `<InstallPrompt />`. On mobile that stack is: AppShell mobile header (~52 px) → SearchBar (`null` in normal state) → PushPrompt/InstallPrompt banners (~64-80 px each when shown). The chat then claims another 100 vh below all of that, so its bottom (PresenceBar header + MessageInput) is pushed below the viewport. iOS Safari also includes the URL-bar area in 100 vh, compounding the problem.
- **Severity:** BLOCKER. Users cannot reach the composer without scrolling inside the outer `<main className="flex-1 overflow-y-auto">` of AppShell.
- **Fix:** make the chat page fill the AppShell `<main>` instead of demanding its own viewport:
  - Change `h-screen` → `min-h-0 flex-1` and remove the outer-main scroll for this route (or set `<main>` of AppShell to `flex` so children with `flex-1` fill it).
  - On mobile, skip rendering `SearchBar` / `PushPrompt` / `InstallPrompt` on chat routes (they belong to lower-friction surfaces).
  - Add `100dvh` height tracking so iOS dynamic viewport changes don't push the composer below the keyboard.

### B3 — ThreadPanel covers the chat on mobile (fixed 320 px side panel)
- **Surface:** group chat — thread
- **File:** `frontend/components/chat/ThreadPanel.tsx:64-167`
- **Problem:** `<aside className="flex h-full w-80 shrink-0 flex-col border-l …">`. On a 390 px iPhone the parent chat column is left with ~70 px; on a 360 px Android, the thread overflows. The thread always renders next to the chat with no responsive break.
- **Severity:** BLOCKER. Opening any thread effectively breaks the chat layout.
- **Fix:** on `md:` and up keep the side-by-side panel. On mobile, render as a full-screen sheet that slides from the right: `fixed inset-0 z-50` with a back button.

### B4 — Search is unreachable on mobile (Cmd-K only)
- **Surface:** global — search
- **File:** `frontend/components/search/SearchBar.tsx:24-37`
- **Problem:** the SearchBar dialog is triggered exclusively by Cmd-K / Ctrl-K. There is no visible button, anywhere. Mobile users have no keyboard shortcut → search is dead.
- **Severity:** BLOCKER for the feature. (Not a P0 blocker for chat itself.)
- **Fix:** add a Search icon button in the mobile AppShell header that opens the same dialog. Lift the open state to AppShell (or expose a global event).

---

## HIGH

### H1 — No safe-area-inset handling anywhere; no `viewport-fit=cover`
- **Surface:** global
- **Files:** `frontend/app/layout.tsx` (no viewport export, no `viewport-fit`), `frontend/styles/tokens.css` (no `env(safe-area-inset-*)` anywhere), `frontend/components/nav/AppShell.tsx` (mobile header has no top-padding inset, drawer no bottom-padding inset), `frontend/components/chat/MessageInput.tsx` (composer has no bottom-padding inset), `frontend/components/chat/PinnedSheet.tsx` (bottom sheet has no bottom-padding inset).
- **Problem:** when JACOB is installed to home screen on iPhone (the install flow encourages this) or run in standalone Safari, content collides with the notch at top and home indicator at bottom. The mobile drawer, sticky banners, and chat composer all sit against the home indicator with zero clearance.
- **Severity:** HIGH. Affects every PWA install.
- **Fix:**
  1. Export Next.js viewport config: `viewportFit: 'cover'`.
  2. Tokens: add `--safe-area-inset-{top,right,bottom,left}: env(safe-area-inset-{…})` and Tailwind utilities (`pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, plus `min-h-svh` / `min-h-dvh`).
  3. Apply: AppShell mobile header (top inset), drawer + sign-out container (bottom inset), MessageInput (bottom inset), PinnedSheet (bottom inset), all sticky banners.

### H2 — Sub-44 px touch targets across the app
- **Surfaces:** forms, chat, lists
- **Files:**
  - `frontend/components/ui/Button.tsx:38-45` — `md = h-10 (40 px)`, `sm = h-8 (32 px)`, `lg = h-12 (48 px)`.
  - `frontend/components/ui/Input.tsx:13` — `h-10` (40 px).
  - `frontend/components/onboarding/ProfileForm.tsx:229` — community-guidelines checkbox `h-4 w-4` (16 px) with no padded hit area.
  - `frontend/components/auth/SignUpForm.tsx` (similar checkbox).
  - `frontend/components/chat/MessageItem.tsx:168-171` — action chips `px-2 py-0.5 text-caption` (~24 px tall).
  - `frontend/components/chat/PhotoAttachButton.tsx:50` — `px-3 py-1 text-caption` (~28 px tall).
  - `frontend/components/chat/PinnedSheet.tsx:68-83` — "Jump" / "Unpin" are pure `text-caption` text links (~16 px tall).
  - `frontend/components/chat/ReactionPicker.tsx:33-40` — `+` trigger is `px-2 py-0.5` (~24 px).
  - `frontend/components/nav/AppShell.tsx:163-169` — hamburger button `p-1` around a 20 px icon ≈ 28 px square.
  - `frontend/components/nav/InstallPrompt.tsx:42-61` — `px-3 py-1` (~28 px) install / dismiss buttons.
  - `frontend/components/nav/PushPrompt.tsx:111-120` — same dimensions.
- **Apple HIG floor:** 44 × 44 pt. Material: 48 × 48 dp. We are well below.
- **Severity:** HIGH. Mis-taps and frustration are the primary feel-cramped vector.
- **Fix:**
  - `Button.md` → `h-11` (44 px). `Button.sm` left at 32 px but only for dense rows (inline-edit cancel, etc.).
  - `Input` → `h-11`.
  - Checkbox → `h-5 w-5` (20 px) with extra label padding so the whole row is a 44 px target.
  - Chat action chips and attach button → `h-9 min-w-9 px-3` for chip-like density (36 px is the threshold below which we wrap them in a parent that's still ≥44 effectively via padding).
  - Hamburger / close-drawer buttons → `p-2.5` around a `h-5 w-5` (44 px).
  - "Jump" / "Unpin" in PinnedSheet → upgrade to small Buttons.

### H3 — Mobile nav is hamburger-only; primary actions buried in a drawer
- **Surface:** global nav
- **File:** `frontend/components/nav/AppShell.tsx:130-216`
- **Problem:** every navigation tap on mobile requires (1) open the drawer, (2) tap the link, (3) drawer closes. Moving between Chats / Feed / Boards is two extra interactions vs. a bottom-tab. Also makes the top header feel barren while the user is anywhere but home.
- **Severity:** HIGH for ergonomics. (Judgment call on whether to add a bottom-tab — see "Items left for Christopher" below.)
- **Fix proposed for this audit:** keep the drawer; **add a search icon button next to the wordmark** so search has a mobile entry point. A separate follow-up can introduce a mobile bottom-tab — not landed in this audit because it borders on visual redesign and Christopher asked us to preserve the look.

### H4 — `scrollIntoView({behavior:"smooth"})` scrolls the nearest scrollable ancestor — often the page, not the chat
- **Surface:** group chat, threads
- **Files:** `frontend/components/chat/MessageList.tsx:67-74`, `frontend/components/chat/ThreadPanel.tsx:46-54`.
- **Problem:** `bottomRef.current.scrollIntoView` walks up the DOM and scrolls the first `overflow:auto` ancestor. With chat nested inside AppShell `<main className="flex-1 overflow-y-auto">`, it can scroll the *outer page*, yanking the AppShell header / search prompt out of view as new messages arrive.
- **Severity:** HIGH (jank).
- **Fix:** keep a ref to the local scroll container; set `container.scrollTop = container.scrollHeight` (with an `auto`/`smooth` behavior option via `container.scrollTo`). Bonus: respect "stick to bottom" — only auto-scroll if the user was already within ~120 px of the bottom.

### H5 — `h-screen` used pervasively; should be `dvh` / `svh`
- **Surfaces:** chat, discover/[gid], all loading states
- **Files:** 30+ matches (see `grep h-screen frontend/`).
- **Problem:** on iOS Safari, `100vh` includes the area behind the URL bar — so a centered loading spinner is positioned below the visible viewport; chat composers get hidden under the keyboard.
- **Severity:** HIGH.
- **Fix:** introduce `min-h-svh` / `min-h-dvh` / `h-dvh` utilities (one-line config) and replace `h-screen` / `min-h-screen` on user-facing surfaces.

### H6 — SearchBar input is `text-sm` (14 px) → iOS focus-zoom on tap
- **Surface:** global search dialog
- **File:** `frontend/components/search/SearchBar.tsx:74`
- **Problem:** Mobile Safari zooms the page when an `<input>` with font-size < 16 px gains focus. The page never zooms back out by itself.
- **Severity:** HIGH for the search dialog.
- **Fix:** use `text-body` (1 rem / 16 px) on the input.

### H7 — Drawer / sheet / modal open and close with no transition
- **Surfaces:** AppShell drawer, ThreadPanel, PinnedSheet, ReportDialog, WellbeingFlagDialog, GroupArchiveDialog, SearchBar
- **Problem:** every overlay flips between mounted and unmounted, no transform/opacity transition. On mobile this reads as "snap" not "smooth," which is the user's exact complaint.
- **Severity:** HIGH for "smooth."
- **Fix:** a small CSS module (or single Tailwind utility) for `data-state=open|closed` slide-in transitions, opt-in on each overlay. Respect `prefers-reduced-motion` (already wired in tokens).

### H8 — Group list page header overflows on narrow viewports
- **Surface:** `/groups`
- **File:** `frontend/app/(authed)/groups/page.tsx:33-49`
- **Problem:** `h1` "Your groups" + two pill links in one `justify-between` row. At 360 px the row clips; on long group names the per-row "members" badge can collide with `truncate`.
- **Severity:** HIGH for ergonomics on small phones.
- **Fix:** wrap actions on a new line below the heading (`flex-wrap` or stack), or move "New group" into a sticky bottom button on mobile.

---

## MEDIUM

### M1 — Body scroll not locked behind open drawer/modal
- AppShell drawer (`AppShell.tsx:174-216`), PinnedSheet, ReportDialog: backdrop overlays but body still scrolls behind. Standard fix: set `document.body.style.overflow = "hidden"` while open.

### M2 — No focus restoration on modal close
- `useFocusTrap` does not return focus to the opener. Re-open / re-close cycles bounce focus to `<body>`.

### M3 — Onboarding form has many fields stacked vertically with `space-y-6`; long on small screens
- Acceptable for now; a segmented/stepped form would feel better but is a redesign.

### M4 — Long URLs in messages overflow horizontally
- `MessageBody.tsx`: no `break-words` / `overflow-wrap: anywhere`. A pasted long URL forces horizontal scroll on the whole chat.

### M5 — PhotoView in MessageItem: `max-h-64 w-auto` but no max-width
- Tall portrait photos can extend the column wider than the viewport at narrow widths.

### M6 — InstallPrompt / PushPrompt placed above chat in AuthedLayout
- See B2 — also creates surface noise across the app. They should appear once on home and dismiss-quickly elsewhere; not every page.

### M7 — Reaction picker dropdown anchored to `left:0` — can clip off the left edge on narrow screens
- Reposition based on viewport edge or use a sheet on touch.

### M8 — Mention dropdown is a fixed 13 rem (208 px) wide list above the textarea
- Fine at 390 px, tight at 320 px. Constrain to `max-w-[calc(100%-2rem)]`.

### M9 — Sign-up checkbox + label tap region is small (`gap-2` + 16 px box + 13 px text)
- Increase the label's padding so the whole row is a tap target.

### M10 — Header "← Back to ___" links use `text-caption` / `text-xs` (~12 px tall) — small, no padding
- e.g. `frontend/app/(authed)/groups/[gid]/chat/page.tsx:90`, boards back link. Upgrade to ≥36 px tap area.

### M11 — `IncidentBanner` and `Banner` rendered before AppShell mobile header — collides with the notch when no safe-area inset is applied (fixed once H1 lands).

---

## LOW

### L1 — `text-cream-dim` referenced 13 times but **not defined** in Tailwind theme or tokens
- Renders as the inherited default (cream) → silently wrong color. Search: `grep -rn "text-cream-dim" frontend`.
- Fix: replace with `text-cream-muted` (one-line sed).

### L2 — PresenceBar / TypingIndicator use `text-xs` (12 px)
- Status indicators; acceptable but on the small side.

### L3 — Polling at 10 s for chat is fine; non-chat polls 30-60 s. Aligns with the CLAUDE.md spec.

### L4 — Onboarding `<input type="date">` placeholder rendering varies by browser on mobile — no fix needed but worth noting if Christopher hears complaints.

### L5 — `<Avatar size="sm">` (28-32 px) feels small for chat author thumb — design choice.

### L6 — `SearchResultRow` (not read in detail) probably re-uses small text — verify when fixing H6.

### L7 — TimeStamp text uses tabular-nums (good — keeps timestamps from jittering).

---

## Items being fixed in this audit

| Group | Items | PR |
|---|---|---|
| Global mobile primitives | H1 (safe-area + viewport-fit), H2 (touch-target floor), H5 (`h-dvh`/`svh` utilities), H7 (transition primitives), L1 (cream-dim sweep) | **PR A** |
| Chat mobile rework | B1, B2, B3, H4, H6 | **PR B** |
| Mobile nav search | B4 | **PR C** |

## Items left for Christopher to approve

- **HIGH H3 (mobile bottom-tab nav).** This is the single biggest ergonomic upgrade for cross-surface navigation but borders on a visual addition. Recommendation: ship a discreet bottom-tab on mobile only, with the same gold-on-ink palette as the desktop sidebar. Quick separate PR if approved.
- **HIGH H8 (groups list header layout).** Trivial fix (flex-wrap), but the right answer depends on whether you want a sticky "New group" FAB on mobile (richer change) or just wrap. Defaulting to wrap if you say go.
- **MEDIUM M3 (segmented onboarding).** A multi-step flow would feel less daunting than the current 6-field card but is design work, not ergonomics. Park for follow-up.
- **MEDIUM M6 (InstallPrompt/PushPrompt placement).** Confining them to `/home` removes them from every other surface. Want to keep them on every authed page (current behavior) or scope to home?
- All MEDIUM and LOW not listed above — flagging for your call; happy to ship if approved.

---

## Verification plan

For each merged PR, I'll re-open the staging URL at a mobile viewport (when the resize-window MCP cooperates) or on a real device, and confirm: composer is reachable; tap targets feel comfortable; safe area respected on PWA install; transitions are smooth; search has a button.
