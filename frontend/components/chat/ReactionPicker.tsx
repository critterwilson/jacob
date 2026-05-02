"use client";

import { useState } from "react";
import { useStickers } from "@/lib/hooks/useStickers";

type Props = {
  mid: string;
  isMyReaction: (mid: string, slug: string) => boolean;
  onToggle: (mid: string, slug: string) => void;
  disabled?: boolean;
};

export function ReactionPicker({ mid, isMyReaction, onToggle, disabled = false }: Props) {
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
        className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-white"
      >
        +
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Reaction picker"
          className="absolute bottom-full left-0 z-10 mb-1 flex flex-wrap gap-1 rounded border border-gray-200 bg-white p-2 shadow-sm"
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
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  mine ? "bg-blue-100 font-medium" : "hover:bg-gray-100"
                }`}
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
