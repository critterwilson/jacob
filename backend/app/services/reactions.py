"""Canonical emoji reaction allowlist.

Reactions are deliberately separate from message stickers/tags:

  * Stickers (`stickers/{slug}`) are author-applied categorical labels —
    "Prayer Request", "Praise Report", etc. — attached at compose time
    via `stickerIds` on the message document.

  * Reactions (this allowlist) are reader responses — the small emoji a
    member taps to acknowledge a message via the React picker.

The two surfaces were previously crossed: the reaction picker pulled
from the stickers collection so members saw "Prayer Request" buttons
when they tapped "react". The picker now renders the canonical emoji
set below; this list is the server-side validation that mirrors it.

`react_to_message` accepts any slug in this set OR (for back-compat
with reactions already persisted under sticker slugs before this
split) any slug that resolves to a sticker document. New reactions go
through this set; legacy data still toggles cleanly.
"""

from __future__ import annotations

EMOJI_REACTION_SLUGS: frozenset[str] = frozenset(
    {
        "like",
        "love",
        "pray",
        "laugh",
        "wow",
        "sad",
    }
)


__all__ = ["EMOJI_REACTION_SLUGS"]
