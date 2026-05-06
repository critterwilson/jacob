"use client";

import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { ThreadReplyInput } from "@/components/chat/ThreadReplyInput";
import { Eyebrow } from "@/components/ui";
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (
      messages.length > prevCountRef.current &&
      typeof bottomRef.current?.scrollIntoView === "function"
    ) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const hasParticipated =
    parentMessage.participants?.includes(currentUserUid) ?? false;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-ink-raised">
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
            "rounded p-1 text-cream-muted transition-colors duration-fast " +
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

      <div className="flex flex-1 flex-col overflow-y-auto bg-ink-raised">
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
              <p className="mt-8 text-center text-body-sm text-cream-dim">
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
