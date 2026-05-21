"use client";

import { useState } from "react";

import { cn } from "@/components/ui";
import { useStickers } from "@/lib/hooks/useStickers";

type Props = {
  mid: string;
  isMyReaction: (mid: string, slug: string) => boolean;
  onToggle: (mid: string, slug: string) => void;
  disabled?: boolean;
};

export function ReactionPicker({
  mid,
  isMyReaction,
  onToggle,
  disabled = false,
}: Props) {
  const { stickers } = useStickers();
  const [open, setOpen] = useState(false);

  if (disabled) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Add reaction"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          "rounded border border-line bg-ink px-2 py-0.5 text-caption text-cream-muted " +
          "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
          "focus:outline-none focus-visible:shadow-glow-gold"
        }
      >
        +
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Reaction picker"
          className="absolute bottom-full right-0 z-10 mb-1 flex max-w-[calc(100vw-2rem)] flex-wrap gap-1 rounded-lg border border-line bg-ink-overlay p-2 shadow-pop"
        >
          {stickers.slice(0, 6).map((s) => {
            const mine = isMyReaction(mid, s.slug);
            return (
              <button
                key={s.slug}
                type="button"
                aria-pressed={mine}
                aria-label={s.name}
                onClick={() => {
                  onToggle(mid, s.slug);
                  setOpen(false);
                }}
                className={cn(
                  "rounded px-2 py-1 text-caption transition-colors duration-fast " +
                    "focus:outline-none focus-visible:shadow-glow-gold",
                  mine
                    ? "bg-gold/15 font-medium"
                    : "hover:bg-ink",
                )}
                style={{ color: s.color }}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
