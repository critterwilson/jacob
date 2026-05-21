# JACOB tag/sticker system — declutter findings

_Investigated on staging (https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app) at 390×844px, signed in as Christopher's account, group "Test"._

## Where the system lives

- **Catalog (15 entries):** `firestore/seed/stickers.ts` seeds 6 Christian, 6 BJJ, 3 general stickers. Backend `/api/stickers` returns them filtered by audience. Frontend `useStickers()` caches per session.
- **Picker:** `frontend/components/stickers/StickerPicker.tsx` — used by `MessageInput` (chat) and `NewPostForm` (boards). Always-visible grid of all visible stickers; up to 2 may be chosen; if zero chosen, a `DEFAULT_STICKER_SLUG = "check-in"` is sent.
- **Display chip:** `frontend/components/stickers/StickerBadge.tsx` — currently a single style (filled, tinted pill). Used in two places: the picker itself (`size="md"`) and on rendered messages (`size="sm"`).
- **On-message render:** `frontend/components/chat/MessageItem.tsx` ~L279 — a `flex flex-wrap gap-1 pt-1` row below the message body.

Note: board posts (`PostCard.tsx`) don't render the tag at all despite collecting it. Out of scope for this PR but worth flagging — see "Open questions."

## What's cluttered

Screenshot from the live staging chat (mobile 390px):

| Region                        | Vertical space | Problem |
|-------------------------------|----------------|---------|
| Picker above the composer     | ~120px (3 rows × ~40px) | All 15 chips always rendered, all filled with their tint colour, all the same visual weight. Reads as a wall of saturated labels rather than an option set — there's no "rest state." Selected-vs-unselected differs only by a faint ring, which is hard to spot against the busy ground. |
| Composer chrome (incl. picker) | ~180px total | Picker dominates the input region. The actual "Say something…" textarea + Send + Attach photo collectively use less space than the picker. |
| On-message tag chip           | ~24px row     | Same loud pill style as the picker chips. The chip competes with the message body text for attention rather than reading as metadata. |

Specifically:

1. **Picker is always expanded.** No collapsed/closed state. Every time the user opens a chat or a board, they see 15 colored chips.
2. **Picker chips are full-saturation tinted pills** (`bg = color + "26"` = 15% alpha + `text-${color}`). There's no contrast between selected and unselected — both share the filled pill style; selection adds a faint `ring`. On the dark ink ground, all 15 chips fight each other for attention.
3. **Picker size is the "md" variant** — `px-3 py-1 text-sm`. Picker chips are essentially the same size as a destructive button.
4. **On-message tag and picker chip use the same `StickerBadge` component** — same visual weight, even though one is metadata (set, read-only) and one is an interactive control. No hierarchy between "I am a label on a message" and "I am a button you can press."
5. **Per-message vertical footprint** — the tag chip occupies a full row below the message text, with `pt-1` above it. That's a row of bright tint per message.

The combined effect: the tag system, which is meant to feel like a quiet metadata layer over the conversation, instead reads as the loudest thing on screen.

## Hard constraints (per Christopher)

- Don't remove categories or change the model (still: pick 0–2 from the catalog; default to check-in when zero).
- Don't touch the broader design system (ink/gold/cream stays).
- Flag interaction-model changes — don't just make them.

## Decluttering directions

This PR implements **(A)** and **(B)**. **(C)** and **(D)** are flagged as open questions rather than shipped.

### (A) — Picker: outlined chips, dot-of-colour, "rest state" by default

- Unselected chip: thin `border-line` pill with a 6px dot of the sticker's colour, body text in `text-cream-muted`. No tinted fill.
- Selected chip: filled pill with the sticker's color tint (current style), border in the sticker colour, weight `font-medium`.
- Smaller padding (`px-2.5 py-0.5 text-xs`) and tighter container gap (`gap-1` instead of `gap-2`).

This drops the picker's resting weight dramatically (15 outlined chips at ~22px tall vs. 15 filled chips at ~28px) while making the selected state finally pop. Interaction model is **unchanged** — still tap-to-toggle, still capped at 2, still defaults to check-in.

### (B) — On-message badge: metadata, not label

- New `size="sm"` style: a 6px coloured dot + the name in `text-caption text-cream-muted`. No pill, no fill.
- The colour identity is preserved (it's the dot), but the chip stops competing with the message body for attention.
- `size="md"` (not used in product code now that the picker has its own chips) keeps the existing pill rendering for back-compat with tests.

Vertical footprint of the tag row drops from ~24px (pill) to ~16px (text-caption line). On a busy chat, that's noticeable.

### (C) — Picker collapse (flagged, NOT implemented)

A natural next step: collapse the picker behind a single "Tag…" button by default, opening into a popover/sheet only when tapped. That would reclaim the full ~120px above every composer instantly. But it adds one tap to the send flow, and since tagging is JACOB's differentiator, I want Christopher's call on whether that's a model change he's willing to make.

### (D) — Render the tag on board posts (flagged, NOT implemented)

`PostCard.tsx` doesn't display the tag the author picked. Probably a latent gap rather than an intentional decision — but it's a behavior change, not a declutter, so I'm leaving it alone.

## Changes shipped in this PR

- `frontend/components/stickers/StickerPicker.tsx` — chip rendering is now local to the picker. Outlined by default, filled+coloured when selected. Smaller padding, tighter gap.
- `frontend/components/stickers/StickerBadge.tsx` — `size="sm"` (on-message variant) becomes dot + muted-text. `size="md"` left intact for test back-compat.
- No backend/API changes. No catalog changes. No interaction-model changes.

## Open questions for Christopher

1. **Picker collapse (C above):** willing to add one tap and recover ~120px of composer real estate? Or keep always-expanded?
2. **Render tag on board posts (D above):** is this a real gap, or intentional?
