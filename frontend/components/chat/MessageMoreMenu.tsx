"use client";

import { type ReactNode } from "react";

import { cn } from "@/components/ui";
import { useMessageMenu } from "@/components/chat/MessageMenuContext";

export type MoreMenuItem = {
  key: string;
  label: string;
  /** Called after the user picks this item. The menu closes either way. */
  onSelect: () => void;
  /** Renders the row in terracotta — for Delete/Remove. */
  destructive?: boolean;
  /** Optional leading icon node. */
  icon?: ReactNode;
};

function KebabIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

type Props = {
  mid: string;
  items: MoreMenuItem[];
};

/**
 * The "kebab" overflow menu on a chat message. Holds the actions that
 * were previously crammed onto the inline pill — Edit, Delete, Pin,
 * Announce, Report, Flag concern — so the visible affordance row stays
 * short (Reply / React / More).
 *
 * Open/close state is shared via `MessageMenuContext`: opening it
 * closes any other open menu, and outside-tap / scroll / Esc all
 * dismiss it. Nothing here owns local visibility state.
 */
export function MessageMoreMenu({ mid, items }: Props) {
  const { isOpen, toggle, close } = useMessageMenu();
  const open = isOpen(mid, "more");

  if (items.length === 0) return null;

  return (
    <div className="relative" data-message-menu>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle(mid, "more");
        }}
        className={
          "inline-flex h-9 w-9 items-center justify-center rounded-full text-cream-muted " +
          "transition-colors duration-fast hover:bg-ink hover:text-cream " +
          "focus:outline-none focus-visible:shadow-glow-gold"
        }
      >
        <KebabIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="More actions"
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-ink-overlay shadow-pop"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                it.onSelect();
                close();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm transition-colors duration-fast " +
                  "focus:outline-none focus-visible:bg-ink-raised",
                it.destructive
                  ? "text-terracotta hover:bg-ink-raised"
                  : "text-cream hover:bg-ink-raised",
              )}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
