"use client";

import { useEffect, useRef, useState } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { useBlocks } from "@/lib/hooks/useBlocks";
import { useMutes } from "@/lib/hooks/useMutes";
import type { Message } from "@/lib/hooks/useGroupMessages";

type Props = {
  gid: string;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  isLeader: boolean;
  onLoadOlder: () => void;
  onReply?: (message: Message) => void;
  pinnedIds?: string[];
  onTogglePin?: (mid: string) => void;
  onAnnounce?: (mid: string) => void;
};

/**
 * Renders a list of messages. T21:
 *   - Blocked users' messages are hidden entirely.
 *   - Muted users' messages are collapsed to a "Muted user · Show" stub
 *     until the viewer expands them in the current session.
 *   - The author always sees their own messages regardless.
 */
export function MessageList({
  gid,
  messages,
  loading,
  loadingOlder,
  hasMore,
  isLeader,
  onLoadOlder,
  onReply,
  pinnedIds,
  onTogglePin,
  onAnnounce,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const { isMuted } = useMutes();
  const { isBlocked } = useBlocks();
  const [expandedMutes, setExpandedMutes] = useState<Set<string>>(new Set());

  // Scroll to bottom only when new messages arrive (not on older-page loads).
  useEffect(() => {
    if (
      messages.length > prevCountRef.current &&
      typeof bottomRef.current?.scrollIntoView === "function"
    ) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Hide blocked-author messages entirely. They never render.
  const visible = messages.filter((m) => !isBlocked(m.authorUid));

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-500">Loading messages…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingOlder ? "Loading…" : "Load older messages"}
          </button>
        </div>
      )}

      {visible.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-400">
          No messages yet. Be the first to say something!
        </p>
      )}

      <div className="flex flex-col">
        {visible.map((msg) => {
          const muted = isMuted(msg.authorUid) && !expandedMutes.has(msg.id);
          if (muted) {
            return (
              <div
                key={msg.id}
                className="flex items-center gap-2 px-4 py-2 text-xs italic text-gray-400 hover:bg-gray-50"
              >
                <span>Muted user</span>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedMutes((prev) => new Set(prev).add(msg.id))
                  }
                  className="text-blue-600 hover:underline"
                >
                  Show
                </button>
              </div>
            );
          }
          return (
            <MessageItem
              key={msg.id}
              gid={gid}
              message={msg}
              isLeader={isLeader}
              onReply={onReply}
              pinnedIds={pinnedIds}
              onTogglePin={onTogglePin}
              onAnnounce={onAnnounce}
            />
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
