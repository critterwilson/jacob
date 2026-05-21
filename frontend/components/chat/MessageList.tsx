"use client";

import { useEffect, useRef, useState } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { Banner } from "@/components/ui";
import { useBlocks } from "@/lib/hooks/useBlocks";
import { useMembers } from "@/lib/hooks/useMembers";
import { useMutes } from "@/lib/hooks/useMutes";
import { useReactions } from "@/lib/hooks/useReactions";
import type { Message } from "@/lib/hooks/useGroupMessages";

type Props = {
  gid: string;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  isLeader: boolean;
  archived?: boolean;
  offline?: boolean;
  onLoadOlder: () => void;
  onReply?: (message: Message) => void;
  pinnedIds?: string[];
  onTogglePin?: (mid: string) => void;
  onAnnounce?: (mid: string) => void;
  readonly?: boolean;
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
  archived = false,
  offline = false,
  onLoadOlder,
  onReply,
  pinnedIds,
  onTogglePin,
  onAnnounce,
  readonly = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const { isMuted } = useMutes();
  const { isBlocked } = useBlocks();
  const { members } = useMembers(gid);
  const {
    isMyReaction,
    toggle: toggleReaction,
    mergeReactionCounts,
  } = useReactions(gid, messages);
  const [expandedMutes, setExpandedMutes] = useState<Set<string>>(new Set());

  // Scroll to bottom only when new messages arrive (not on older-page loads),
  // and only when the user is already near the bottom — otherwise we yank
  // them down while they're reading earlier history. Scrolls the local
  // container, not the page; `scrollIntoView` would walk up to the nearest
  // scrollable ancestor (often AppShell's <main>) and yank chrome.
  useEffect(() => {
    if (messages.length <= prevCountRef.current) {
      prevCountRef.current = messages.length;
      return;
    }
    prevCountRef.current = messages.length;
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight);
    if (distanceFromBottom > 120) return;
    // jsdom's Element doesn't implement scrollTo; fall back to scrollTop
    // when the method isn't present.
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  // Hide blocked-author messages entirely. They never render.
  const visible = messages.filter((m) => !isBlocked(m.authorUid));

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-body-sm text-cream-muted">Loading messages…</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-momentum bg-ink"
    >
      {offline && (
        <Banner
          tone="warning"
          role="status"
          className="sticky top-0 z-10 rounded-none border-x-0 border-t-0"
        >
          Offline — showing your last loaded messages.
        </Banner>
      )}
      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className={
              "rounded border border-line bg-ink-raised px-3 py-1 text-caption text-cream-muted " +
              "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
            }
          >
            {loadingOlder ? "Loading…" : "Load older messages"}
          </button>
        </div>
      )}

      {visible.length === 0 && (
        <p className="mt-12 text-center text-body-sm text-cream-muted">
          No messages yet. Be the first to say something!
        </p>
      )}

      {/*
        T62 — `role="log"` + `aria-live="polite"` lets a screen reader
        announce new messages without interrupting the user. We rely
        on the default `aria-relevant="additions"` so deletes/edits
        don't re-trigger announcements.
      */}
      <div
        className="flex flex-col"
        role="log"
        aria-live="polite"
        aria-label="Group chat message log"
      >
        {visible.map((msg) => {
          const muted = isMuted(msg.authorUid) && !expandedMutes.has(msg.id);
          if (muted) {
            return (
              <div
                key={msg.id}
                className="flex items-center gap-2 px-4 py-2 text-caption italic text-cream-muted transition-colors duration-fast hover:bg-ink-raised"
              >
                <span>Muted user</span>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedMutes((prev) => new Set(prev).add(msg.id))
                  }
                  className="rounded-sm text-gold-soft hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
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
              onReply={readonly ? undefined : onReply}
              pinnedIds={pinnedIds}
              onTogglePin={readonly ? undefined : onTogglePin}
              onAnnounce={readonly ? undefined : onAnnounce}
              members={members}
              archived={archived}
              isMyReaction={readonly ? undefined : isMyReaction}
              onToggleReaction={
                readonly
                  ? undefined
                  : (mid, slug) => void toggleReaction(mid, slug)
              }
              mergeReactionCounts={readonly ? undefined : mergeReactionCounts}
              readonly={readonly}
            />
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
