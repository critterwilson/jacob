import type { Sticker } from "@/lib/hooks/useStickers";

type Props = {
  sticker: Sticker;
  size?: "sm" | "md";
};

export function StickerBadge({ sticker, size = "md" }: Props) {
  const cls =
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span
      data-sticker={sticker.slug}
      className={`inline-flex items-center rounded-full font-medium ${cls}`}
      style={{
        backgroundColor: sticker.color + "26",
        color: sticker.color,
      }}
    >
      {sticker.name}
    </span>
  );
}
