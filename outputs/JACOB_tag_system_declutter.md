# JACOB Tag/Sticker System — Declutter Findings

*Audited 2026-05-21. Viewport: 390×844 (iPhone 14 equivalent). Branch: `style/declutter-sticker-picker`.*

---

## What's Cluttered

### 1. The picker wraps to 3 rows on mobile (worst offender)

At 390px viewport the sticker picker in `MessageInput` renders all **15 stickers** as a wrapping flex grid:

```
[Check-In] [Prayer Request] [Praise Report] [Offering Help] [Need Help]
[Event / Meetup] [Roll Partner Needed] [Tournament Prep] [Technique Question]
[Recovery] [Conditioning] [Milestone] [Encouragement] [Question] [Praise]
```

Measured heights:
- Picker: **75px** (3 rows × 21px + 2 × 6px gap)
- Full compose form: **190px**
- **The picker alone = 39% of the compose form height.**

A user scrolling chat hits this block every time they tap to compose. The visual mass competes with the message textarea.

### 2. Group-audience filtering was built but never wired

`StickerPicker` already accepts `groupAudience?: "christian" | "bjj" | "general"` (added in T56, comment in code). It filters to 9 stickers for a christian group. But `MessageInput` never receives this prop and never passes it through — so every group, regardless of type, shows all 15 stickers including BJJ-specific ones ("Roll Partner Needed", "Tournament Prep", "Technique Question", "Conditioning") in a christian group and vice versa.

This isn't a clutter choice — it's a wiring bug. The feature was built; it just wasn't plumbed from the chat page down.

### 3. Tag badges on messages carry `font-medium` weight

Every message in the list renders its sticker as a colored pill with `font-medium` (`StickerBadge size="sm"`). Because every single message has a tag (fallback to "Check-In" ensures this), the bold-ish pill appears under every message body. The visual weight of the badge competes with the message text above it rather than reading as metadata.

Measured: each badge row is **15px tall** + `pt-1` (4px) = ~19px added per message. Over a chat log of 20 messages that's ~380px of tag-row pixels — a second floor of content stacked under every message.

### 4. Picker chip size is "medium" (`px-3 py-1 text-sm`) for a pure-toggle UI

The `md` size is designed for display contexts (like the board post card). In the picker, the chip is just a toggle — it doesn't need to carry much visual weight. Smaller chips mean more fit per row and less visual noise.

---

## What Was Changed

### Fix 1 — Picker: horizontal scroll row (StickerPicker.tsx)

**Before:** `flex flex-wrap gap-2` → 3 rows, 75px height  
**After:** `flex gap-1.5 overflow-x-auto pb-1 [scrollbar]` with each button as `shrink-0` → 1 scrollable row, ~27px height

The picker collapses from 75px to 27px — a **48px savings** in compose-form height (form goes from 190px to ~142px). The user can scroll horizontally to reach all tags. A subtle right-edge fade indicates there's more to scroll.

All chips use `size="sm"` in the picker context (passed as a prop to `StickerBadge`). Smaller, lighter toggle buttons.

### Fix 2 — Audience filtering wired through (MessageInput + ChatPage)

Added `groupAudience?: "christian" | "bjj" | "general"` to `MessageInput` props. `ChatPage` passes `group?.audience` (narrowed to the allowed union). A christian group's picker now shows 9 stickers (6 christian + 3 general); a BJJ group shows 9 (6 BJJ + 3 general). General groups and any group with `null` audience fall back to all 15 (unchanged behavior).

No sticker categories were removed. No interaction model was changed.

### Fix 3 — Tag badges: font-normal on sm (StickerBadge.tsx + MessageItem.tsx)

`StickerBadge size="sm"` changes from `font-medium` to `font-normal`. The colored pill remains; the ink weight drops so tags read as metadata rather than a second headline. The `md` size (used in the picker buttons) retains `font-medium` for clear tap targets.

`MessageItem` tightens the sticker row: `pt-1` → `pt-0.5` (2px gap instead of 4px between message text and badge row). Modest vertical savings × every message.

---

## What Was NOT Changed

- **Tag categories**: all 15 stickers remain in the system; no category was removed.
- **Selection model**: picking tags is still how you post. The fallback to "Check-In" on submit is unchanged.
- **Max selection (2)**: unchanged.
- **Boards `NewPostForm`**: also gets the horizontal-scroll picker since `StickerPicker` is a shared component, but no audience filtering (boards are cross-group by design).
- **ReactionBar / ReactionPicker**: left as-is. Reactions are a secondary surface; their current text-name display is acceptable and is a separate system from the intent-tagging picker.
- **Design system colors**: no color, font, or motif changes. Still ink/gold/cream.

---

## Flag for Christopher: Should the picker label be a label?

The picker currently appears above the textarea with no label — it's described by `aria-label="Select stickers (up to 2)"` but there's no visible prompt. Users who are new may not understand what the row of colored chips is for.

**Question**: Would a small label line — e.g. `Tag your message:` in `text-caption text-cream-muted` above the picker — help new-user clarity? This is a UX addition, not a declutter change, so I flagged it rather than adding it.

---

## Metric Summary

| Surface | Before | After |
|---|---|---|
| Picker height (390px viewport) | 75px / 3 rows | ~27px / 1 scrollable row |
| Compose form total height | 190px | ~142px |
| Stickers shown (christian group) | 15 | 9 |
| Tag badge font weight (messages) | medium | normal |
| Tag badge top gap (messages) | 4px | 2px |
