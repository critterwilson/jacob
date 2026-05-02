"use client";

import { useEffect, useRef } from "react";

import { useThreadMessages } from "@/lib/hooks/useThreadMessages";
import { ThreadReplyInput } from "@/components/chat/ThreadReplyInput";
import { MessageItem } from "@/components/chat/MessageItem";
import { useReactions } from "@/lib/hooks/useReactions";
import type { Message } from "@/lib/hooks/useGroupMessages";

type Props = {
  gid: string;
  parentMessage: Message;
  isLeader: boolean;
  currentUserUid: string;
  archived?: boolean;
  onClose: () => void;
};

export function ThreadPanel({ gid, parentMessage, isLeader, currentUserUid, archived = false, onClose }: Props) {
  const { messages, loading, loadingOlder, hasMore, loadOlder } =
    useThreadMessages(gid, parentMessage.id);
  const { isMyReaction, toggle: toggleReaction } = useReactions(gid);
  const onToggleReaction = (mid: string, slug: string) => void toggleReaction(mid, slug);

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

  const hasParticipated = parentMessage.participants?.includes(currentUserUid) ?? false;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Thread
          {hasParticipated && (
            <span
              aria-label="You have participated in this thread"
              className="ml-2 inline-block h-2 w-2 rounded-full bg-blue-500"
            />
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Original message
        </p>
        <MessageItem
          gid={gid}
          message={parentMessage}
          isLeader={isLeader}
          archived={archived}
          isMyReaction={isMyReaction}
          onToggleReaction={onToggleReaction}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-gray-500">Loading replies…</span>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingOlder ? "Loading…" : "Load earlier replies"}
                </button>
              </div>
            )}

            {messages.length === 0 && (
              <p className="mt-8 text-center text-sm text-gray-400">
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
