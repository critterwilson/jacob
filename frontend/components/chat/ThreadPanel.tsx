"use client";

import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { ThreadReplyInput } from "@/components/chat/ThreadReplyInput";
import { Eyebrow, cn } from "@/components/ui";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useReactions } from "@/lib/hooks/useReactions";
import { useThreadMessages } from "@/lib/hooks/useThreadMessages";
import type { Message } from "@/lib/hooks/useGroupMessages";

type Props = {
  gid: string;
  parentMessage: Message;
  isLeader: boolean;
  currentUserUid: string;
  archived?: boolean;
  onClose: () => void;
};

export function ThreadPanel({
  gid,
  parentMessage,
  isLeader,
  currentUserUid,
  archived = false,
  onClose,
}: Props) {
  const { messages, loading, loadingOlder, hasMore, loadOlder } =
    useThreadMessages(gid, parentMessage.id);
  // Include the parent message in hydration so reactions on the parent are
  // also recovered after a refresh (the parent isn't in `messages`).
  const allForReactions: Message[] = [parentMessage, ...messages];
  const {
    isMyReaction,
    toggle: toggleReaction,
    mergeReactionCounts,
  } = useReactions(gid, allForReactions);
  const onToggleReaction = (mid: string, slug: string) =>
    void toggleReaction(mid, slug);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Same pattern as MessageList: scroll the local container, not the page.
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
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  const hasParticipated =
    parentMessage.participants?.includes(currentUserUid) ?? false;

  const trapRef = useFocusTrap<HTMLElement>({
    active: true,
    onEscape: onClose,
  });

  return (
    <aside
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Thread"
      className={cn(
        // Mobile: full-screen overlay sliding in from the right.
        "fixed inset-0 z-40 flex flex-col bg-ink-raised pt-safe-t pb-safe-b pr-safe-r",
        // Desktop: classic side panel embedded next to the chat column.
        "md:static md:z-auto md:h-full md:w-80 md:shrink-0 md:border-l md:border-line md:pt-0 md:pb-0 md:pr-0",
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-body-sm font-semibold text-cream">
          Thread
          {hasParticipated && (
            <span
              aria-label="You have participated in this thread"
              className="inline-block h-2 w-2 rounded-full bg-gold"
            />
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          className={
            "-mr-2 inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted transition-colors duration-fast " +
            "hover:bg-ink hover:text-cream " +
            "focus:outline-none focus-visible:shadow-glow-gold"
          }
        >
          ✕
        </button>
      </div>

      <div className="shrink-0 border-b border-line bg-ink px-4 py-2">
        <Eyebrow className="block">Original message</Eyebrow>
        <MessageItem
          gid={gid}
          message={parentMessage}
          isLeader={isLeader}
          archived={archived}
          isMyReaction={isMyReaction}
          onToggleReaction={onToggleReaction}
          mergeReactionCounts={mergeReactionCounts}
        />
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-momentum bg-ink-raised"
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-body-sm text-cream-muted">
              Loading replies…
            </span>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className={
                    "rounded border border-line bg-ink px-3 py-1 text-caption text-cream-muted " +
                    "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
                    "focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
                  }
                >
                  {loadingOlder ? "Loading…" : "Load earlier replies"}
                </button>
              </div>
            )}

            {messages.length === 0 && (
              <p className="mt-8 text-center text-body-sm text-cream-muted">
                No replies yet. Start the thread!
              </p>
            )}

            <div className="flex flex-col">
              {messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  gid={gid}
                  message={msg}
                  isLeader={isLeader}
                  archived={archived}
                  isMyReaction={isMyReaction}
                  onToggleReaction={onToggleReaction}
                  mergeReactionCounts={mergeReactionCounts}
                />
              ))}
            </div>

            <div ref={bottomRef} />
          </>
        )}
      </div>

      <ThreadReplyInput
        gid={gid}
        parentMessageId={parentMessage.id}
        parentStickerIds={parentMessage.stickerIds}
      />
    </aside>
  );
}
