"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/ui";
import { useStickers } from "@/lib/hooks/useStickers";

type Props = {
  mid: string;
  isMyReaction: (mid: string, slug: string) => boolean;
  onToggle: (mid: string, slug: string) => void;
  disabled?: boolean;
};

function SmileyAddIcon({ className }: { className?: string }) {
  // A small smiley + plus glyph reads as "react" the same way every
  // other messenger does — much friendlier than a bare "+".
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
      <path d="M19 3v4" />
      <path d="M17 5h4" />
    </svg>
  );
}

export function ReactionPicker({
  mid,
  isMyReaction,
  onToggle,
  disabled = false,
}: Props) {
  const { stickers } = useStickers();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (disabled) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Add reaction"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          "inline-flex h-8 w-8 items-center justify-center rounded-full text-cream-muted " +
          "transition-colors duration-fast hover:bg-ink hover:text-cream " +
          "focus:outline-none focus-visible:shadow-glow-gold"
        }
      >
        <SmileyAddIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Reaction picker"
          className="absolute bottom-full right-0 z-20 mb-1 flex max-w-[calc(100vw-2rem)] flex-wrap gap-1 rounded-lg border border-line bg-ink-overlay p-2 shadow-pop"
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
