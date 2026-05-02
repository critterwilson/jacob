"use client";

import { useState } from "react";

import { usePinnedMessages } from "@/lib/hooks/usePinnedMessages";
import { PinnedSheet } from "./PinnedSheet";

type Props = {
  gid: string;
  isLeader: boolean;
};

export function PinnedBar({ gid, isLeader }: Props) {
  const { pinned, pinnedIds, loading, togglePin } = usePinnedMessages(gid);
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
        className="flex shrink-0 items-center gap-2 border-b border-yellow-200 bg-yellow-50 px-4 py-1.5 text-sm"
      >
        <span className="shrink-0 text-yellow-600" aria-hidden>
          📌
        </span>
        <p className="min-w-0 flex-1 truncate text-gray-800">
          {preview}
          {truncated && "…"}
        </p>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="shrink-0 text-xs font-medium text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
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
