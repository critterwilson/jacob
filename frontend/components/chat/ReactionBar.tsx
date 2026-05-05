"use client";

import { cn } from "@/components/ui";
import { useStickers } from "@/lib/hooks/useStickers";

type Props = {
  mid: string;
  reactionCounts?: Record<string, number>;
  isMyReaction: (mid: string, slug: string) => boolean;
  onToggle: (mid: string, slug: string) => void;
};

export function ReactionBar({
  mid,
  reactionCounts,
  isMyReaction,
  onToggle,
}: Props) {
  const { stickers } = useStickers();

  if (!reactionCounts) return null;

  const chips = Object.entries(reactionCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (chips.length === 0) return null;

  const stickerMap = Object.fromEntries(stickers.map((s) => [s.slug, s]));

  return (
    <div className="flex flex-wrap gap-1 pt-1" aria-label="Reactions">
      {chips.map(([slug, count]) => {
        const sticker = stickerMap[slug];
        const mine = isMyReaction(mid, slug);
        return (
          <button
            key={slug}
            type="button"
            onClick={() => onToggle(mid, slug)}
            aria-pressed={mine}
            aria-label={`${sticker?.name ?? slug} ${count}`}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption " +
                "transition-colors duration-fast " +
                "focus:outline-none focus-visible:shadow-glow-gold",
              mine
                ? "border-gold bg-gold/15 font-medium text-gold-soft"
                : "border-line bg-ink-overlay text-cream-muted hover:bg-ink hover:text-cream",
            )}
          >
            <span>{sticker?.name ?? slug}</span>
            <span>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
