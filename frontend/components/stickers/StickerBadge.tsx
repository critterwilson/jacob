import type { Sticker } from "@/lib/hooks/useStickers";

type Props = {
  sticker: Sticker;
  size?: "sm" | "md";
};

export function StickerBadge({ sticker, size = "md" }: Props) {
  if (size === "sm") {
    return (
      <span
        data-sticker={sticker.slug}
        className="inline-flex items-center gap-1.5 text-xs text-cream-muted"
        style={{ color: sticker.color }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-current"
        />
        <span className="text-cream-muted">{sticker.name}</span>
      </span>
    );
  }

  return (
    <span
      data-sticker={sticker.slug}
      className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
      style={{
        backgroundColor: sticker.color + "26",
        color: sticker.color,
      }}
    >
      {sticker.name}
    </span>
  );
}
