"use client";

import { useState } from "react";

import { PinnedSheet } from "./PinnedSheet";
import { usePinnedMessages } from "@/lib/hooks/usePinnedMessages";

type Props = {
  gid: string;
  isLeader: boolean;
};

function PinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76V8.5a1 1 0 0 1 .386-.79l4.228-2.952A1 1 0 0 1 15.2 5.6V13a1 1 0 0 1-.6.917l-4.2 1.85a1 1 0 0 1-1.4-.917V13" />
      <path d="M5 13h14" />
    </svg>
  );
}

export function PinnedBar({ gid, isLeader }: Props) {
  const { pinned, loading, togglePin } = usePinnedMessages(gid);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || pinned.length === 0) return null;

  const latest = pinned[pinned.length - 1];
  const preview = latest.body.replace(/\n/g, " ").slice(0, 80);
  const truncated = latest.body.length > 80;

  return (
    <>
      <div
        role="complementary"
        aria-label="Pinned message"
        className="flex shrink-0 items-center gap-2 border-b border-line bg-ink-raised px-4 py-2 text-body-sm"
      >
        <span className="shrink-0 text-parchment-amber">
          <PinIcon />
        </span>
        <p className="min-w-0 flex-1 truncate text-cream-muted">
          {preview}
          {truncated && "…"}
        </p>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="shrink-0 rounded-sm text-caption font-medium text-gold-soft transition-colors duration-fast hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
          aria-label={`View all pinned messages (${pinned.length})`}
        >
          View all {pinned.length > 1 ? `(${pinned.length})` : ""}
        </button>
      </div>

      {sheetOpen && (
        <PinnedSheet
          gid={gid}
          pinned={pinned}
          isLeader={isLeader}
          onUnpin={(mid) => void togglePin(mid)}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
