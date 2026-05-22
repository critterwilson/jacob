# JACOB design system

The visual language for JACOB. **Study-Bible meets restrained Swiss** — reverence, warmth, restraint.

This document is the spec. Tokens land in `frontend/tailwind.config.ts` and `frontend/styles/tokens.css` (PR B). Primitives that compose them live in `frontend/components/ui/` (PR C). Surface-by-surface application happens after user review.

> **Mood.** Quiet, not flashy. A reader of scripture should feel at home. A first-time visitor should feel something is *built well*, not *decorated*. Whitespace is a feature, not an afterthought.

## 1. Color

The palette is **dark-first**. A page sits on deep ink navy. Type is warm cream. Gold is the single accent — used like a leather bookmark, not wallpaper.

### Surfaces (the ground)

| Token              | Hex       | Use                                                         |
|--------------------|-----------|-------------------------------------------------------------|
| `ink`              | `#0E1726` | Page background. Bible-binding navy with a faint blue cast. |
| `ink-raised`       | `#15233A` | Cards, message containers, sticky bars.                     |
| `ink-overlay`      | `#1C2D49` | Modals, popovers, dropdowns.                                |

### Lines and borders

| Token              | Hex       | Use                                                          |
|--------------------|-----------|--------------------------------------------------------------|
| `line`             | `#243149` | Default border. Reads as "edge of paper" on ink.             |
| `line-strong`      | `#3A4D6E` | Emphasized boundaries (active card, focused input outline).  |

### Text (cream on ink)

| Token              | Hex       | Use                                                                 |
|--------------------|-----------|---------------------------------------------------------------------|
| `cream`            | `#F5EFE0` | Primary text. Warm off-white. ~16.5:1 on ink (AAA).                 |
| `cream-muted`      | `#C9C2B3` | Secondary/tertiary text. Helper copy, timestamps, captions, eyebrows. ~10.2:1 on ink (AAA), AA on raised/overlay. |

Cream is reserved for ink/raised/overlay grounds. Never put cream on cream. There is no `text-black` — pages don't go light without an explicit decision.

### Accent (the gold bookmark)

| Token              | Hex       | Use                                                                  |
|--------------------|-----------|----------------------------------------------------------------------|
| `gold`             | `#C9A95C` | Default accent. Primary CTA, active nav, focus ring, key inline emphasis. ~7.4:1 on ink (AAA). |
| `gold-soft`        | `#D9BE7C` | Hover state for gold-backed surfaces and gold links.                 |
| `gold-deep`        | `#A8893E` | Pressed/active state. Borders on gold-tinted cards.                  |

**Use sparingly.** A surface should have at most *one* gold element drawing the eye. Gold for entire panels, full-width banners, or background blocks is forbidden — it cheapens the accent.

### Semantic (warm, never vivid)

The semantic palette is intentionally muted to sit inside the same world as the gold/cream/ink. Don't reach for Tailwind's default red-500 or green-600 — they fight the mood.

| Token                | Hex       | Use                                                              |
|----------------------|-----------|------------------------------------------------------------------|
| `terracotta`         | `#C16B5C` | Danger, destructive actions, validation errors. ~4.9:1 on ink.   |
| `sage`               | `#7E9B7C` | Success. Restrained green. ~6.0:1 on ink.                        |
| `parchment-amber`    | `#D9B068` | Warning, maintenance banners. Sits inside the gold family.       |
| `lake`               | `#6E8AA9` | Info. Muted slate-blue, won't compete with gold.                 |

> **Verify before merge:** the contrast ratios above are computed; double-check each token pair with the WebAIM Contrast Checker before promoting tokens to production.

### Sticker palette (open follow-up)

`docs/design-tokens.md` defines the existing sticker hex values, sized for a light surface. They will read garish on navy. **Out of scope for the foundation pass.** Tracked as the first design follow-up after the per-surface sweep — the fix is to raise luminance ~10% and slightly desaturate, keeping each sticker's identity recognizable.

## 2. Typography

**Two families, no third.** A serif for display and a sans for everything else.

### Families

| Token             | Family                                | Source                  | Use                                                                            |
|-------------------|----------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| `font-display`    | EB Garamond                            | Google Fonts (free)     | Page titles, hero headlines, devotional/sermon titles, scripture excerpts.     |
| `font-sans`       | Inter                                  | Google Fonts (free)     | Body, UI labels, buttons, inputs. Default for everything not display.          |

**Why EB Garamond.** Digital revival of Claude Garamont's 16th-century types — the lineage of nearly every printed Bible since the Reformation. Reads as biblical-publishing weight without becoming a costume. SIL Open Font License. Variable font available (single file, all weights). Self-hosted via `next/font/google` so we keep the same-origin guarantees and zero third-party tracking.

(Considered and rejected: **Lora** — reads as "modern editorial," too contemporary for the mood we want. **Adobe Garamond Pro** — paid license, fails the project's free-only constraint.)

**Why Inter.** Designed by Rasmus Andersson explicitly for screen UI. Excellent x-height for small UI text, large optical sizes hold up at hero scale, and the variable-font version is one file. SIL OFL. Already familiar to most users from countless Next.js apps — that's a feature, not a bug; it disappears, leaving the serif to carry the personality.

**Loading strategy.**
- `next/font/google` self-hosts both fonts; subset to `latin` only.
- Use the variable file for both — single download per family.
- `display: 'swap'`. We never accept invisible-text-during-load.
- Combined bundle impact: ~50 KB. Well within the project's bundle-weight constraint.

### Type scale

A 1.2 ratio for tight reading hierarchy, deliberately compressed at the upper end so display sizes feel reverent rather than corporate.

#### Display (EB Garamond, weight 500–600)

| Token            | Size  | Line-height | Weight | Use                                                  |
|------------------|-------|-------------|--------|------------------------------------------------------|
| `display-xl`     | 56 px | 1.05        | 600    | Landing hero only (one per app).                     |
| `display-lg`     | 40 px | 1.10        | 600    | Section heroes, devotional/sermon page titles.       |
| `display-md`     | 32 px | 1.15        | 600    | Standard page titles (sign-in, settings, group).     |
| `display-sm`     | 24 px | 1.25        | 600    | Subsection titles, modal titles.                     |

#### Body (Inter, weight 400)

| Token            | Size  | Line-height | Weight | Use                                                          |
|------------------|-------|-------------|--------|--------------------------------------------------------------|
| `body-lg`        | 18 px | 1.60        | 400    | Long-form reading: devotionals, sermon notes, About page.    |
| `body`           | 16 px | 1.55        | 400    | Default body. Form fields, dense paragraph text.             |
| `body-sm`        | 14 px | 1.50        | 400    | Secondary UI text, helper text.                              |
| `caption`        | 12 px | 1.40        | 500    | Meta, timestamps, footnote-grade.                            |

#### UI (Inter)

| Token            | Size  | Line-height | Weight | Use                                                          |
|------------------|-------|-------------|--------|--------------------------------------------------------------|
| `label`          | 13 px | 1.30        | 500    | Form labels, button text.                                    |
| `eyebrow`        | 11 px | 1.30        | 600    | Section eyebrows. `tracking-wider`, `uppercase`.             |

**Rules.**
- Display is for display only. Never set buttons, labels, or body in serif.
- Body uses `body` (16 px) by default. Reach for `body-lg` (18 px) deliberately — it signals "sit and read."
- Headings stack: page = `display-md`; subsection = `display-sm`; subsection within a panel = `label` in `cream-muted`. Don't invent intermediate sizes.
- Generous leading: 1.5+ on body, 1.05+ on display.

## 3. Spacing

Tailwind's default 4-px scale (`0.25rem` step) is correct. The system adds **one** custom value:

- `space-18` (4.5 rem / 72 px): vertical breathing room between major sections. Replaces ad-hoc `mt-16` + `mt-20` mixing.

Vertical rhythm: 8 px multiples within a section; section breaks are 48 px (`space-12`) or 72 px (`space-18`). Don't mix 60 / 64 / 80 — pick one of the two and commit.

## 4. Radius

| Token             | Value   | Use                                                  |
|-------------------|---------|------------------------------------------------------|
| `rounded-sm`      | 4 px    | Chips, badges, sticker pills.                        |
| `rounded` (md)    | 6 px    | **Default.** Buttons, inputs, small interactives.    |
| `rounded-lg`      | 10 px   | Small cards, message containers.                     |
| `rounded-xl`      | 16 px   | Large cards, settings panels.                        |
| `rounded-2xl`     | 24 px   | Hero panels, modal sheets.                           |
| `rounded-full`    | 9999 px | Avatars, circular controls.                          |

(Default Tailwind has 4/6/8/12. We're nudging the mid-range slightly larger — 10 px reads as "considered" on dark surfaces; 8 px reads as "default" against the heavier visual weight of an ink ground.)

## 5. Shadow

On dark surfaces, drop shadows are weak by themselves. The system pairs them with subtle inner-edge highlights so cards lift cleanly off the ink.

| Token                  | CSS                                                                                  | Use                                       |
|------------------------|---------------------------------------------------------------------------------------|-------------------------------------------|
| `shadow-raise`         | `inset 0 1px 0 rgba(255,255,255,.04), 0 8px 24px -12px rgba(0,0,0,.6)`               | Cards on the ink ground.                  |
| `shadow-pop`           | `inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px -20px rgba(0,0,0,.8)`              | Modals, popovers, dropdowns.              |
| `shadow-glow-gold`     | `0 0 0 1px rgba(201,169,92,.30), 0 0 0 4px rgba(201,169,92,.12)`                     | Focus rings on interactive elements.      |

`shadow-glow-gold` is the **only** focus ring. It works on every interactive surface in the system because it sits on top of any background.

## 6. Motion

Restrained. Things move because they need to, not to celebrate themselves.

| Token              | Value   | Use                                                            |
|--------------------|---------|----------------------------------------------------------------|
| `duration-fast`    | 120 ms  | Hover, button press, color shifts.                             |
| `duration-base`    | 180 ms  | Standard transitions.                                          |
| `duration-slow`    | 280 ms  | Overlays, drawers, modal enter/exit.                           |

Easing: `ease-out` for enters, `ease-in` for exits, `ease-in-out` for stateful transitions (drawer open ↔ close). No bouncy springs. No long fades.

**`prefers-reduced-motion: reduce`** drops every transition to 0 ms. The token CSS will set this via `@media`.

## 7. Iconography

- Stroke 1.5 px, no fills, `currentColor`.
- Standard sizes: 16 / 20 / 24 px. Pick the size that matches the line-height of the adjacent text.
- Each icon gets room: minimum 8 px of inline space around it.

**Library decision:** **deferred.** Lucide is not currently a dep (see `frontend/package.json`). For the foundation pass, in-tree icons (the AppShell hamburger, close, etc.) will be consolidated into a small `frontend/components/icons/` set as inline SVGs — zero added bundle weight. We'll revisit Lucide if/when icon usage exceeds ~10 distinct symbols. See *Open calls* below.

## 8. Symbolic imagery

The brief calls for sparing use of dove, light, water motifs. Treat them as **furniture**, not decoration:

- One per surface, large, decorative-only (`aria-hidden="true"`).
- Rendered as `currentColor` SVG so it tones to the surface and respects text color.
- Kept under 5 KB each, stored under `frontend/public/motifs/` and imported as React components.
- **Never repeated** as background pattern, never tinted gold (the gold is for emphasis, not for decoration).

The starter set (to be designed in tandem with PR C):
1. **Dove** — landing hero.
2. **Open book** — devotionals/sermons hero.
3. **Light from clouds** — auth surfaces.

User decision needed on these before the per-surface sweep — see *Open calls*.

## 9. Component composition rules

These rules govern how primitives combine. Surface designs that violate them go back for revision.

1. The default page background is `ink`. Cards elevate to `ink-raised` (`shadow-raise`). Modals to `ink-overlay` (`shadow-pop`).
2. Every interactive element has a `:focus-visible` state using `shadow-glow-gold`. No exceptions.
3. **Gold is for one thing per surface.** Primary CTA, *or* active nav, *or* a single inline emphasis — pick one.
4. Borders are `line` by default. Reach for `line-strong` only when an interactive boundary is the focal point of the surface.
5. Display serif (EB Garamond) is for display only. Never on body, labels, buttons, or links.
6. Body text defaults to `body` (16 px). Long-form (devotionals, sermons, About) uses `body-lg` (18 px).
7. Forms: label above input, helper text below. Error text replaces helper text — do not stack both. Error text is `terracotta`, never the bright Tailwind red.
8. Empty states: dashed-border container, centered illustration or icon, one-line explanation, one or two CTAs (primary + secondary). The dashed border is the *only* place dashed borders appear.
9. Loading: a single `Skeleton` primitive replaces the current mix of "Loading…" text and `animate-pulse` blocks. Skeleton blocks are `ink-raised`-tinted, not grey.
10. Toasts: bottom-right on desktop, top-center on mobile. Auto-dismiss 5 s for success / info, manual-dismiss for errors. One toast at a time; queue the rest.

### Button usage — the one standard

JACOB has exactly one button primitive (`Button`) and one navigational-CTA primitive (`ButtonLink` — an anchor with identical styling). **Never hand-roll a button** from raw Tailwind, and never nest a `<Button>` inside a link. The rules below are the *single* standard; they apply to every surface — auth, onboarding, home, groups, chat, boards, feed, settings, admin, dialogs.

**Variant — what each is for.**

| Variant | Use |
|---|---|
| `primary` | The one dominant action of a view — form submit, dialog confirm, the main page CTA. Gold. |
| `secondary` | Supporting actions beside or below the primary — Cancel, "Continue with Google", an alternate path. Bordered. |
| `ghost` | Tertiary actions in dense UI where even a border is too loud — inline actions, "Skip", dismiss-in-passing. |
| `destructive` | Actions that delete/remove data or revoke access — delete, remove, revoke, ban, block, archive, detach, release, withdraw. Terracotta. |

- **Exactly one `primary` per view.** If two actions look equally important, one of them isn't — make it `secondary`. (This is rule 3 above, applied to buttons.)
- The **confirm** button of a destructive flow is always `destructive`. The **trigger** that opens the confirm dialog is `destructive` only when it is the surface's main action (a Danger Zone); when it is one row action among many, the trigger is `ghost`/`secondary` and the dialog's confirm carries the terracotta.
- "Reject" / "Decline" of a *pending* item (an application, a join request, a moderation queue item) is **`secondary`**, not `destructive`. `destructive` is for removing access or data that already exists — not routine triage. (Banning *is* destructive.)
- Cancel/dismiss next to a primary in a form or dialog is `secondary`. `ghost` is reserved for genuinely tertiary actions.

**Size.**

| Size | Height | Use |
|---|---|---|
| `md` | 44 px | **Default — everything**, unless a rule below says otherwise: form submits, dialog actions, page-header CTAs, card CTAs. |
| `lg` | 48 px | Auth / onboarding / landing only — sign-in, sign-up, forgot-password, verify-email, awaiting-approval, onboarding, the landing CTA. |
| `sm` | 36 px | Inline actions inside a dense row — a table row, a list-item row, a chat message, inline-edit Save/Cancel. Below the 44 px touch floor; only valid when the parent row supplies padded hit area. |

The admin console is **not** a fourth size system: admin table-row actions are `sm`; admin form submits, dialog actions, and page-level actions are `md`.

- **Repeated row actions** — a list/table where every row carries the same action set: actions are `sm`, the affirmative action is `secondary`, lesser actions `ghost`, destructive actions `destructive`. Never `primary` for a row action — that keeps gold reserved for the one page/form/dialog-level action so a list of N rows never shows N gold buttons.

**Placement.**

- A form's action row is the last block of the form, after every field; a dialog's action row is the last block of the dialog.
- Action-row markup is always the same: `<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">`, DOM order `[Cancel] [Submit]`.
- One consistent result everywhere: on mobile the buttons stack with the **primary on top**; on `sm+` they sit in a **right-aligned row, Cancel left of the primary**.
- A lone submit (no cancel) uses the same right-aligned row — bottom-right of the form/dialog.
- Page-header CTAs sit top-right of the page header.

**Mobile full-width.**

- Form-submit and dialog-action buttons are `fullWidth="mobile"` — full-width below `sm`, auto-width inside the right-aligned row at `sm+`. This is what makes the stacked-mobile / row-desktop placement above work.
- Auth / onboarding / landing buttons are `fullWidth` (all viewports): those surfaces are a fixed narrow column where stacked full-width CTAs are the established pattern. Paired with `lg`.
- Inline-row actions, page-header CTAs, and chip-like controls are never full-width.

**Navigational CTAs.** A link that should look like a button uses `ButtonLink` (same `variant` / `size` / `fullWidth` props; renders an `<a>`). Never hand-roll gold classes onto an `<a>`/`<Link>`.

## 10. Accessibility

Quick reference for the contrast pairs we'll actually use. **Verify each pair with WebAIM Contrast Checker before merging tokens.**

| Foreground          | Background       | Approx. ratio | Verdict                          |
|---------------------|------------------|---------------|----------------------------------|
| `cream`             | `ink`            | 16.5 : 1      | AAA (large + body)               |
| `cream`             | `ink-raised`     | 14.0 : 1      | AAA (large + body)               |
| `cream-muted`       | `ink`            | 10.2 : 1      | AAA (large + body)               |
| `cream-muted`       | `ink-raised`     | 8.9 : 1       | AAA (large + body)               |
| `cream-muted`       | `ink-overlay`    | 7.8 : 1       | AAA (large + body)               |
| `gold`              | `ink`            | 7.4 : 1       | AAA (large + body)               |
| `gold`              | `ink-raised`     | 6.3 : 1       | AAA (large), AA (body)           |
| `terracotta`        | `ink`            | 4.9 : 1       | AA (large + body) — borderline   |
| `sage`              | `ink`            | 6.0 : 1       | AA (large + body)                |

If any pair drops below the listed ratio after measurement, retune toward the next token: `terracotta` shifts toward `#CD7C6D` if the 4.9 measurement comes in lower, etc.

Other accessibility commitments:
- **Focus.** `shadow-glow-gold` ring on every interactive. `outline: none` is allowed only when paired with the ring.
- **Hit targets.** Minimum 44 × 44 px on touch surfaces (buttons, toggles, nav links). Aligns with the iOS HIG; Material's 48 dp is the looser sibling and we don't always meet it on dense chip rows but always meet 44.
- **Motion.** `prefers-reduced-motion: reduce` collapses all transitions.
- **Form fields.** Every input has a visible label (no placeholder-as-label). Errors are `aria-live="polite"`.
- **Color is never the only signal.** Errors get an icon as well as `terracotta` text. Status pills include a label, not just a hue.

## 11. Open calls — user input needed before per-surface sweep

These are decisions I deliberately did not make on the user's behalf; they affect tone and bundle in ways the user should weigh in on.

1. **Iconography library.** Stay on inline SVG (zero bundle weight, recommended) or add Lucide React (~2 KB tree-shaken per icon, ~80 KB cold load before tree-shake)? My recommendation: stay inline. Revisit at >10 distinct icons.
2. **Symbolic motifs.** I propose three to start (dove / open book / light-from-clouds). Confirm the set, or substitute. They will be hand-drawn SVGs committed to `frontend/public/motifs/`, not stock.
3. **Body type for long-form scripture content.** Default in this spec is Inter `body-lg` (18 px). An alternative — set scripture excerpts in EB Garamond at 18 px — would give devotionals a "set type" feel but is a stronger commitment to the serif on a high-traffic surface. Recommend trying both in PR C's `/_design` route and deciding from screenshots.
4. **Light mode.** Brief is dark-first; this spec does not define a light variant. Tokens are structured so a future light variant can be added (`ink` / `ink-raised` invert to `paper` / `paper-warm`) without restructuring. **Do nothing now** unless the user asks.
5. **Sticker palette retune.** Out of scope for the foundation, but the existing palette will look harsh on ink. Recommend a separate follow-up task after the sweep.

## 12. What this system is *not*

- It's not a component library. PR C lands a small set of primitives; per-surface application happens after user review.
- It's not a brand book. Marketing/illustration/motion identity beyond the motifs above is out of scope for this pass.
- It's not exhaustive. Surfaces not covered in `docs/design-audit.md` (admin, transparency, appeals) will inherit the new primitives transparently and can be revisited in their own pass if needed.
