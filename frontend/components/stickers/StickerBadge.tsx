import type { Sticker } from "@/lib/hooks/useStickers";

type Props = {
  sticker: Sticker;
  size?: "sm" | "md";
};

export function StickerBadge({ sticker, size = "md" }: Props) {
  const cls =
    size === "sm"
      ? "px-2 py-0.5 text-xs font-normal"
      : "px-3 py-1 text-sm font-medium";

  return (
    <span
      data-sticker={sticker.slug}
      className={`inline-flex items-center rounded-full ${cls}`}
      style={{
        backgroundColor: sticker.color + "26",
        color: sticker.color,
      }}
    >
      {sticker.name}
    </span>
  );
}
