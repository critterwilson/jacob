"use client";

import { useStickers } from "@/lib/hooks/useStickers";

type Props = {
  mid: string;
  reactionCounts?: Record<string, number>;
  isMyReaction: (mid: string, slug: string) => boolean;
  onToggle: (mid: string, slug: string) => void;
};

export function ReactionBar({ mid, reactionCounts, isMyReaction, onToggle }: Props) {
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
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine
                ? "border-blue-400 bg-blue-50 font-medium text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span>{sticker?.name ?? slug}</span>
            <span>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
