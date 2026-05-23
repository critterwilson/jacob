/**
 * Canonical emoji reaction set.
 *
 * Reactions are deliberately **separate** from message stickers/tags:
 *   - Stickers (`frontend/components/stickers/`) are author-applied
 *     categorical labels: "Prayer Request", "Praise Report", etc.
 *     They live in the `stickers/{slug}` collection and are picked at
 *     compose time on the message itself.
 *   - Reactions (this file) are reader responses — the small emoji a
 *     member taps to acknowledge a message. They are picked from the
 *     ReactionPicker affordance on someone else's message.
 *
 * The server (`backend/app/routers/messages.py`) accepts either a slug
 * in this allowlist OR — for backward compatibility — an existing
 * sticker slug. New reactions go through this set; legacy sticker-slug
 * reactions in already-persisted data still render in the bar.
 */
export type EmojiReaction = {
  slug: string;
  emoji: string;
  label: string;
};

export const EMOJI_REACTIONS: readonly EmojiReaction[] = [
  { slug: "like", emoji: "👍", label: "Like" },
  { slug: "love", emoji: "❤️", label: "Love" },
  { slug: "pray", emoji: "🙏", label: "Pray" },
  { slug: "laugh", emoji: "😂", label: "Laugh" },
  { slug: "wow", emoji: "😮", label: "Wow" },
  { slug: "sad", emoji: "😢", label: "Sad" },
];

const BY_SLUG: Record<string, EmojiReaction> = Object.fromEntries(
  EMOJI_REACTIONS.map((r) => [r.slug, r]),
);

export function emojiForSlug(slug: string): EmojiReaction | undefined {
  return BY_SLUG[slug];
}
