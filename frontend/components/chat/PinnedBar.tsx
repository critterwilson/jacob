"use client";

import { useState } from "react";
import { PinnedSheet } from "@/components/chat/PinnedSheet";
import { usePinnedMessages } from "@/lib/hooks/usePinnedMessages";

type Props = {
  gid: string;
  isLeader: boolean;
};

export function PinnedBar({ gid, isLeader }: Props) {
  const { pinned, togglePin, loading } = usePinnedMessages(gid);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || pinned.length === 0) return null;

  const latest = pinned[0];
  const preview = (latest.message.body ?? "").replace(/\n/g, " ").slice(0, 80);
  const truncated = (latest.message.body ?? "").length > 80;

  return (
    <>
      <div
        role="status"
        aria-label="Pinned message"
        className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2"
      >
        <span className="text-xs font-semibold text-amber-700">📌</span>
        <p className="flex-1 truncate text-xs text-amber-900 md:whitespace-normal">
          {preview}
          {truncated && "…"}
        </p>
        {pinned.length > 1 || isLeader ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={`View all pinned messages (${pinned.length})`}
            className="shrink-0 text-xs text-amber-700 hover:underline"
          >
            View all ({pinned.length})
          </button>
        ) : null}
      </div>

      {sheetOpen && (
        <PinnedSheet
          pinned={pinned}
          isLeader={isLeader}
          onUnpin={(mid) => void togglePin(mid)}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
