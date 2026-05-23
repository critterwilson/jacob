"use client";

import { cn } from "@/components/ui";
import { EMOJI_REACTIONS } from "@/lib/emojiReactions";
import { useMessageMenu } from "@/components/chat/MessageMenuContext";

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

/**
 * Emoji reaction picker. Renders the canonical `EMOJI_REACTIONS` set —
 * NOT message stickers (which are an author-applied tag concept living
 * in `frontend/components/stickers/`). The two were previously crossed:
 * the picker pulled from `useStickers()`, so tapping "react" surfaced
 * "Prayer Request", "Praise Report", etc. instead of an emoji set.
 *
 * Open/close state is held in `MessageMenuContext` so opening another
 * message's menu, tapping outside, scrolling, or pressing Esc all
 * dismiss the popover.
 */
export function ReactionPicker({
  mid,
  isMyReaction,
  onToggle,
  disabled = false,
}: Props) {
  const { isOpen, toggle, close } = useMessageMenu();
  const open = isOpen(mid, "reactions");

  if (disabled) return null;

  return (
    <div className="relative" data-message-menu>
      <button
        type="button"
        aria-label="Add reaction"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle(mid, "reactions");
        }}
        className={
          "inline-flex h-9 w-9 items-center justify-center rounded-full text-cream-muted " +
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
          className="absolute bottom-full right-0 z-20 mb-1 flex max-w-[calc(100vw-2rem)] gap-1 rounded-lg border border-line bg-ink-overlay p-2 shadow-pop"
        >
          {EMOJI_REACTIONS.map((r) => {
            const mine = isMyReaction(mid, r.slug);
            return (
              <button
                key={r.slug}
                type="button"
                aria-pressed={mine}
                aria-label={r.label}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(mid, r.slug);
                  close();
                }}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none transition-colors duration-fast " +
                    "focus:outline-none focus-visible:shadow-glow-gold",
                  mine ? "bg-gold/15" : "hover:bg-ink",
                )}
              >
                <span aria-hidden="true">{r.emoji}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
