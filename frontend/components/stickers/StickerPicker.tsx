"use client";

import { useStickers } from "@/lib/hooks/useStickers";

/** Slug used when the user submits without choosing a sticker. */
export const DEFAULT_STICKER_SLUG = "check-in";

type Props = {
  value: string[];
  onChange: (slugs: string[]) => void;
  /**
   * T56 — when set, only stickers whose `audience` matches OR equals
   * `general` are surfaced. Pass the parent group's audience so a BJJ
   * group can't surface christian-only stickers and vice versa. Omit
   * to show every sticker (legacy behaviour).
   */
  groupAudience?: "christian" | "bjj" | "general";
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
        className="h-6 w-48 animate-pulse rounded bg-ink-overlay"
      />
    );
  }

  return (
    <div
      role="group"
      aria-label="Select stickers (up to 2)"
      className="flex flex-wrap gap-1"
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
            data-sticker={sticker.slug}
            style={
              selected
                ? {
                    color: sticker.color,
                    borderColor: sticker.color,
                    backgroundColor: sticker.color + "26",
                  }
                : undefined
            }
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs " +
              "transition-colors duration-fast " +
              "focus-visible:outline-none focus-visible:shadow-glow-gold " +
              "disabled:opacity-40 " +
              (selected
                ? "font-medium"
                : "border-line bg-transparent text-cream-muted hover:text-cream")
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: sticker.color }}
            />
            {sticker.name}
          </button>
        );
      })}
    </div>
  );
}
