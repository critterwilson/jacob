"use client";

import { StickerBadge } from "@/components/stickers/StickerBadge";
import { useStickers } from "@/lib/hooks/useStickers";

/** Slug used when the user submits without choosing a sticker. */
export const DEFAULT_STICKER_SLUG = "check-in";

type Props = {
  value: string[];
  onChange: (slugs: string[]) => void;
  /**
   * T56 — when set, only stickers whose `audience` matches OR equals
   * `general` are surfaced. Pass the parent group's audience so a
   * general group can't surface christian-only stickers and vice
   * versa. Omit to show every sticker (legacy behaviour).
   */
  groupAudience?: "christian" | "general";
};

export function StickerPicker({ value, onChange, groupAudience }: Props) {
  const { stickers, loading } = useStickers();
  const visible = groupAudience
    ? stickers.filter(
        (s) => s.audience === groupAudience || s.audience === "general",
      )
    : stickers;

  const toggle = (slug: string) => {
    if (value.includes(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else if (value.length < 2) {
      onChange([...value, slug]);
    }
  };

  if (loading) {
    return (
      <div
        aria-label="Loading stickers"
        className="h-7 w-48 animate-pulse rounded bg-ink-overlay"
      />
    );
  }

  return (
    <div className="relative">
      <div
        role="group"
        aria-label="Select stickers (up to 2)"
        className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visible.map((sticker) => {
          const selected = value.includes(sticker.slug);
          const atMax = value.length >= 2;
          return (
            <button
              key={sticker.slug}
              type="button"
              onClick={() => toggle(sticker.slug)}
              disabled={!selected && atMax}
              aria-pressed={selected}
              className={`shrink-0 rounded-full ring-2 transition-all focus-visible:outline-none focus-visible:ring-offset-1 ${
                selected ? "ring-current" : "ring-transparent"
              } disabled:opacity-40`}
            >
              <StickerBadge sticker={sticker} size="sm" />
            </button>
          );
        })}
      </div>
      {/* Right-edge fade indicating overflow content */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-ink to-transparent"
      />
    </div>
  );
}
