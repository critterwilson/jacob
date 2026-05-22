# JACOB chat revamp — findings & changes

_Mobile-first audit at ~390px on staging, plus code read. The complaint
was the chat "feels clunky." Goal: keep what chat does, fix how it
feels._

## What was clunky

Findings, in order of severity:

### Composer

1. **Textarea was being squeezed to ~176 px wide on a 500 px window — about half its intended width.** The biggest single source of "clunky." `MentionInput` rendered a wrapping `<div className="relative">` around the textarea; the parent `MessageInput` put `flex-1` on the textarea's *className* prop, which landed on the textarea itself but **not on the wrapper div** — so the wrapper hugged its content and the textarea couldn't expand. Measured: x=12, right=188, even though the available width was ~468 px. Result: 2–3 words per visual line, send button looking lonely with a huge gap.
2. **Textarea did not auto-grow.** `rows={2}` was hard-coded. Typing 5 lines created a *scrollbar inside the textarea* — you couldn't see what you were writing.
3. **Composer was 135 px tall — ~19% of viewport on a mobile screen.** Three stacked rows: always-on sticker chip strip + textarea+Send + Attach-photo button on its own row.
4. **Sticker chip strip was always visible.** Nine chips with horizontal scroll, taking up a full row, even though most sends use the default `check-in` sticker (post-#280 declutter).
5. **"Attach photo" was a labelled text button on its own row** — wasted vertical space relative to a small icon next to Send.
6. **Send blocked the next message.** `await apiPost(...)` then `reset()`: the input froze until the network round-trip returned. On a flaky mobile connection, you had to wait 200–800 ms before typing the next thought.
7. **No keyboard shortcut.** Multiline textareas without a Cmd/Ctrl+Enter shortcut feel sluggish to power users.
8. `ThreadReplyInput` had every one of the same bugs.

### Message list

1. **Consecutive same-author messages didn't group.** Two messages from "You" each got a full avatar + name + timestamp row — the same chrome repeated, eating ~30 px per message it didn't need to.
2. **No day dividers.** Only `HH:MM AM/PM` ever rendered — a multi-day conversation had no temporal anchor.
3. **Action chips overflowed the right edge.** With Reply / Edit / Delete / Pin / Announce / + (reaction) / Report / Wellbeing, the cluster wrapped or sat on top of the timestamp on 390 px. The chip styling was a 36 px bordered rectangle that doesn't visually read as a cluster.
4. **Reaction-picker trigger was a literal `+` character** in a bordered box — felt like an unfinished placeholder.
5. **Reaction picker had no outside-click dismiss** — once open, you had to click `+` again to close.

### Scroll

1. **Initial load smooth-scrolled from the top.** First paint set scroll position at top, then a useEffect smooth-scrolled to bottom — visible jank.
2. **No "jump to bottom" affordance.** If you scrolled up to read history and a new message arrived, the new-message indicator was non-existent — you only knew when you scrolled down.
3. **Otherwise the polling/SSE merge was fine** — keeping that wholesale.

## What changed

One PR, applied within the existing design system (ink/gold/cream) and the established button-standard.

### Composer (`MessageInput`, `MentionInput`, `PhotoAttachButton`, `ThreadReplyInput`)

- Single-row layout: `[paperclip] [textarea] [stickers] [send]`. ~52 px collapsed height vs 135 px before.
- `MentionInput` exposes `containerClassName` and now applies `flex-1 min-w-0` to the wrapper so the textarea fills the row.
- Auto-growing textarea: 1 row when empty, grows up to 6 visible rows, then internally scrolls. Algorithm reads `lineHeight` from computed style, sets `height: auto` then `height: scrollHeight + padding + border`. Works for both `MessageInput` and `ThreadReplyInput`.
- Sticker chip strip is now collapsible — tap the sticker icon to expand the panel; a small gold badge on the icon shows how many are selected. Default-on stickers (check-in) still applied at send if nothing chosen.
- `PhotoAttachButton` got an `variant="icon"` mode: 44×44 paperclip icon button. Old labelled variant kept for non-chat callers.
- Send is a round 44×44 gold icon button (right-arrow glyph). Disabled-looking (dimmed) when nothing to send; clickable so the existing "Add a message or a photo" validation message still surfaces.
- **Optimistic clear.** Composer empties immediately on submit; if the POST fails, the body + stickers + attachments are restored verbatim so the user can retry without retyping.
- **Cmd/Ctrl+Enter** submits, matching the standard for multiline composers. Bare Enter still inserts a newline.

### Message list (`MessageList`, `MessageItem`)

- **Consecutive same-author messages within 5 min** render as continuations: hide avatar + author name, reserve the avatar gutter for alignment, hover surfaces the timestamp inline. Day boundaries and threaded replies always start a fresh row.
- **Sticky day dividers** ("Today", "Yesterday", "Monday, Mar 5", or `Mar 5, 2025` for prior years) inserted whenever the calendar day rolls over.
- **Action chips redesigned** as a floating 32-px pill cluster sitting on the top-right edge of the message (above-line by translate-y-1/2), with `bg-ink-raised/95 backdrop-blur` so it reads as a toolbar rather than competing with the body. Fits at 390 px without wrapping.
- **Reaction-picker trigger** is now a smiley-with-plus SVG icon, consistent in size with the other 8-px-padding chips. Outside-click closes the popover.

### Scroll + arrival (`MessageList`)

- **Initial scroll is instant.** First non-empty render uses `useLayoutEffect` to set `scrollTop = scrollHeight` synchronously, then locks out the auto-scroll effect. No smooth-scroll on first paint.
- **Subsequent updates** smooth-scroll only when the user is within 120 px of the bottom — otherwise the message slides in off-screen.
- **Jump-to-bottom pill** appears when a new message arrives while the user is scrolled up. The pill shows a gold unread-count badge and dismisses itself once the user is back near the bottom (via a scroll listener), or on click (smooth-scrolls and clears the counter).

### Hard constraints kept

- No change to what chat *does*: same SSE/polling transport, same tag mechanic (default check-in still applied), same reactions/threads/mentions semantics, same data model.
- Did not undo the tag declutter (#280) — extended it by hiding the chip strip behind an icon. Did not undo the mobile-UX pass (#274) — kept tap-to-reveal actions, just shrank the chip cluster. Did not undo the button-consistency sweep — every new button uses `bg-gold`/`bg-ink-overlay` per the standard.
- 390 px-first, desktop unaffected (the changes don't reach for breakpoints).
- No new dependencies. CSS-only animations.

## Verification

- `pnpm test`: 731 passed / 5 skipped.
- `pnpm type-check`: clean.
- `pnpm lint`: no warnings or errors.
- Test updates: one assertion in `tests/message-input.test.tsx` opens the sticker panel before selecting "Prayer Request" — matching the new collapsed-by-default UX.
- Staging visual verification: pre-merge done by code-read + local-window probe at the 390 px viewport (window forced wider by Chromium's minimum but composer + message list logic verified). Post-merge will be re-verified at the staging URL once App Hosting redeploys.
