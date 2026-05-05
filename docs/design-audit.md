# Design audit — Phase 1–3 surfaces

A snapshot of the current visual state, taken at `db9c7e0` (post-T65). Phase 1–3 shipped functionality; this audit records what the user sees today and where the gaps are. It is the input to `docs/design-system.md` and the foundation work that follows.

Scope: the ten most-trafficked surfaces, plus the AppShell. Not exhaustive.

## How we got here

Tailwind is configured with `theme.extend = {}` (`frontend/tailwind.config.ts:8`) and `frontend/app/globals.css` contains only the three `@tailwind` directives. There is **no design token layer, no primitive component library, and no color/typography system.** Every surface composes its own buttons, inputs, and cards from raw Tailwind utilities. The result is *consistent enough to feel like one app* but *dull enough to feel unfinished* — defaulted greys and blues, no typographic personality, low visual hierarchy.

Patterns that recur across the app (and will be the things we replace first):

- **Form input:** `rounded border border-gray-300 px-3 py-2` (e.g. `frontend/components/auth/SignInForm.tsx:80,98`).
- **Primary button:** `rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50` (e.g. `frontend/components/auth/SignInForm.tsx:113-119`).
- **Secondary button:** `rounded border border-gray-300 px-4 py-2 font-medium` (e.g. `SignInForm.tsx:121-127`).
- **Card:** `rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50` (e.g. `frontend/app/(authed)/home/page.tsx:69-77`).
- **Heading:** `text-2xl font-semibold` (no leading override, no display family).

These are the seams where the new system will land first.

## Surfaces

### 1. AppShell — `frontend/components/nav/AppShell.tsx`

**What works.** The skeleton is sound: a 56-unit (`w-56`) sidebar on `md+` (`AppShell.tsx:75`), a hamburger drawer on mobile (`:89-145`). `aria-expanded`, `aria-controls`, focus-trap-friendly markup. The sign-out button has a pending state.

**What's flat.** Pure `bg-white`, `border-gray-200`, `text-gray-700`. The brand wordmark "JACOB" (`:77`, `:110`, `:127`) is set in default sans at `text-lg font-semibold tracking-tight` — no sense of identity. Active nav state is `bg-blue-50 text-blue-700` (`:28`) — the same Tailwind blue-on-blue every Next starter has worn since 2021. Hamburger and close buttons are inline SVGs (`:98-108`, `:134-144`) with no shared icon component.

**Implications for the system.** The shell needs the most identity work: brand wordmark in the display serif, gold accent on active nav, ink ground throughout. APIs are already small enough that this is a visual change, not a refactor.

### 2. Marketing / Landing — `frontend/app/page.tsx`

**What works.** Tight one-screen hero, centered copy, two clear CTAs (`page.tsx:36-47`). Description copy reads well already.

**What's flat.** Text-3xl wordmark on plain white (`:30`). Same blue-600 / grey-300 button pair seen everywhere else (`:38`, `:44`). No imagery, no atmosphere — looks identical to the auth surfaces because they share the same primitives. For a landing page that is supposed to invite people in, this is the highest-leverage surface to redesign.

**Implications.** Hero needs the display serif, ink ground, gold accent on the primary CTA, and one large symbolic motif (dove/light) used reverently. This is where the new direction will be most felt.

### 3. Sign-in — `frontend/app/(auth)/sign-in/page.tsx` + `frontend/components/auth/SignInForm.tsx`

**What works.** Form structure is clean — label-input-error triplets (`SignInForm.tsx:71-87`, `:89-105`), `react-hook-form` + zod validation, humanized auth errors via `humanizeAuthError` (`:48`). `aria-label="Sign in"` on the form (`:69`).

**What's flat.** Inputs have no focus state beyond browser default (`:80`). No padding/leading on labels — they butt against the input. The "Continue with Google" button (`:121-127`) has no Google glyph, no focus ring, no hover treatment. Forgot-password / Create-account links (`:130-135`) are blue-underlined, the most generic possible treatment.

**What breaks.** Submit button has no focus ring; only `disabled:opacity-50` for state. On the dark direction this combination will be invisible — focus rings are mandatory on ink.

### 4. Sign-up — `frontend/app/(auth)/sign-up/page.tsx` + `frontend/components/auth/SignUpForm.tsx`

Same patterns as sign-in. The password strength helper (text-xs, text-gray-600) is functional but visually swallowed. Same focus-ring gap. No differentiation from sign-in in mood, even though sign-up is the one moment where we get to set tone for new users.

### 5. Onboarding — `frontend/app/onboarding/page.tsx` + `frontend/components/onboarding/ProfileForm.tsx`

**What works.** `mx-auto max-w-lg px-4 py-10` container is the right shape for a focused single-task surface. Required vs. optional fields are distinguished by helper text.

**What's flat.** Raw `<input type="checkbox">` for the community-guidelines acknowledgment — browser-default, indistinguishable from a debugger UI. Photo upload component is functional but visually a grey rectangle. No sense that this is a moment of welcome.

**Implications.** Onboarding needs warmth — display-serif heading, generous spacing, and a custom checkbox/toggle primitive so the guidelines acknowledgment feels like an intentional moment, not a checkbox bin.

### 6. Home — `frontend/app/(authed)/home/page.tsx`

**What works.** Layout is sensible: maintenance banner, welcome heading, daily-verse, groups list, recent activity (`home/page.tsx:18-99`). Empty-state for "no groups yet" is a dashed-border centered card with two CTAs (`:48-64`) — the one moment of design intent on this surface.

**What's flat.** Greeting is `text-2xl font-semibold` (`:29`) — no display serif, no warmth. The DailyVerse card (`frontend/components/home/DailyVerse.tsx`) wraps in `rounded-lg border border-blue-100 bg-blue-50` — generic Tailwind alert blue, the wrong palette for scripture. Group rows (`:71`) are bordered grey cards with no visual identity per group (no avatar, no member-count emphasis, no last-message-preview).

**What breaks.** The maintenance banner uses `bg-yellow-50 border-yellow-200 text-yellow-800` (`:22`) — the same yellow that is in every Tailwind tutorial. Will need to be retuned to the warmer parchment-amber from the new palette.

### 7. Group chat — `frontend/app/groups/[gid]/chat/page.tsx` + `frontend/components/chat/MessageItem.tsx`

**What works.** The layout is correct: full-height flex, sticky header, scrollable message list, sticky input. The MessageItem renders all the right pieces — author, timestamp, body with mentions, stickers, photos, reaction bar, thread reply — and gracefully handles deleted/edited/auto-hidden states.

**What's flat — and this is the worst-affected surface.**

- Messages have **no bubble**, no background, no avatar (`MessageItem.tsx:136`). Each message is `flex flex-col gap-1 px-4 py-2 hover:bg-gray-50`. From a glance the chat reads as a typewritten transcript, not a conversation.
- Author name is `text-sm font-semibold text-gray-900` (`:139`) — no color or sticker-tone differentiation between authors.
- Timestamp is `text-xs text-gray-400` (`:142`). Too dim, too small.
- Hover-only message actions (`:281`) are a row of `rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-white` chips — visually noisy when they appear.
- Reactions are bare emoji with no chip styling.
- Edit textarea (`:171`) and edit-action buttons (`:178`, `:188`) reuse the same primary/secondary button shapes as the rest of the app, just smaller — no consistent "compact" variant.

**Implications.** Chat is the highest-traffic surface and will need the most thought. The system needs an explicit Message component (avatar, name+timestamp row, body, footer with reactions/threads) — not just primitives. That work belongs *after* the foundation lands; flagging here so we don't pretend it's a primitives-only fix.

### 8. Boards — `frontend/app/boards/page.tsx` + `frontend/components/boards/PostCard.tsx`

**What works.** Index list (`page.tsx`) is `mx-auto max-w-2xl px-4 py-10` with `space-y-3` cards. Detail page (`boards/[boardId]/page.tsx`) shows posts as bordered cards.

**What's flat.** Identical "rounded border border-gray-200" cards everywhere; no per-board visual identity, no thread-depth indicator on replies, no read/unread cue. Markdown bodies render plain (no prose styling). Reaction bar shares the same un-chipped emoji treatment as chat.

### 9. Group settings — `frontend/app/groups/[gid]/settings/page.tsx` + `frontend/components/groups/GroupSettingsForm.tsx`

**What works.** Three logical sections (avatar, metadata, danger zone) and a back-link in the header. Form input focus state here is the *one* place I found a focus ring (`focus:outline-none focus:ring-2 focus:ring-blue-500`) — useful precedent.

**What's flat.** Sections are three independent `rounded border border-gray-200 p-4` boxes with no shared section-header treatment. Danger zone (red border, red text) reads as "warning" not "destructive consequences" — the archive button is the same shape and weight as a benign Save button. No visual hierarchy between primary fields (name) and meta fields (description).

**Implications.** This surface needs a Section primitive (eyebrow + heading + description + body) and a destructive Button variant. Both belong in the primitives PR.

### 10. Devotionals — `frontend/app/devotionals/page.tsx` + `frontend/app/devotionals/[slug]/page.tsx`

**What works.** Index uses `mx-auto max-w-3xl space-y-4 p-6`. Each devotional card has title + scripture reference + body preview.

**What's flat.** Title is `text-lg font-medium text-blue-700 hover:underline` — Tailwind blue, sans-serif. For a devotional title this is the *exact* place the display serif should appear. Scripture reference is `text-xs text-gray-500` — the smallest-allowed treatment for what should be a key piece of metadata.

**Implications.** Devotionals (and sermons, below) are the surfaces where the "study-Bible" tone matters most. Display serif for titles, gold-accented scripture references, body text in `body-lg` (18px) with generous leading.

### 11. Sermon archive — `frontend/app/groups/[gid]/sermons/page.tsx` + `[sermonId]/page.tsx`

Same pattern as devotionals: title-as-link in default sans-serif blue, no display treatment, no embedded-video styling, no notes/scripture distinction. Same fixes apply: display serif on the title, body-lg on notes, gold accents on scripture references.

### 12. Settings / Notifications — `frontend/app/(authed)/settings/notifications/page.tsx`

**What works.** This is the **best-designed surface in the app.** Toggle switch (custom-styled, animated knob with `translate-x-5` / `translate-x-0`) is the one piece of UI with intentional polish. Single rounded container with `divide-y divide-gray-100` row separators is a strong pattern.

**What's flat.** Same generic blue (`bg-blue-600`) for active toggle. Helper text below each toggle is `text-xs text-gray-500` — readable but timid.

**Implications.** Use this layout pattern as the model for the SettingsList primitive in the next pass — it's already good.

## Cross-cutting issues

Things that hurt the look across many surfaces, regardless of which page you land on:

1. **No focus rings on dark backgrounds.** Switching to ink without retrofitting focus states will produce keyboard-invisible UI. The new Button/Input primitives must ship with explicit `:focus-visible` rings (gold-on-ink works; we'll spec this).
2. **No consistent loading state.** A mix of "Loading…" text (`page.tsx:22`, `home/page.tsx:46`) and `animate-pulse` skeleton blocks (DailyVerse). One Skeleton primitive should replace both.
3. **No toast / banner abstraction.** Errors render as inline `<p role="alert" className="text-sm text-red-600">`. There's no persistent notification surface; success is invisible. A Toast/Banner primitive is needed before any surface can express "saved" or "sent."
4. **Inline `<svg>` icons everywhere** (AppShell hamburger/close, group archive icons elsewhere). Lucide is *not* currently a dep — see `frontend/package.json`. Decision deferred (see *Open calls* in `design-system.md`); for now I'll group the few in-tree icons into a small `components/icons/` set rather than add a library.
5. **Sticker badge palette** (`docs/design-tokens.md`) was sized for a light ground. The vivid Tailwind primaries (`#2563EB`, `#7C3AED`, `#DC2626`) will look acidic on navy. Retuning is out of scope for the foundation pass; flagging as the first follow-up after the sweep.
6. **No prose styling.** Devotional bodies, sermon notes, and the About page (`prose prose-gray max-w-none`) currently rely on Tailwind's default prose plugin (which isn't even installed — the class is dead). A small `Prose` wrapper that sets line-length, leading, and serif drop-cap is the right primitive for long-form content.

## What this audit is *not*

This audit does **not** prescribe a redesign of every surface — it identifies what's there and where the leverage is. The system spec (`design-system.md`) defines the tokens and rules; PR B lands the foundation; PR C lands the primitives; the per-surface sweep happens *after* user review. Some surfaces (admin/, transparency/, appeals/) are intentionally not audited because they are leader/operator-facing and lower-traffic; they will inherit the new primitives transparently.
