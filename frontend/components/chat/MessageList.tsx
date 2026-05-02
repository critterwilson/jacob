"use client";

import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
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
};

export function MessageList({
  gid,
  messages,
  loading,
  loadingOlder,
  hasMore,
  isLeader,
  onLoadOlder,
  onReply,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

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

      {messages.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-400">
          No messages yet. Be the first to say something!
        </p>
      )}

      <div className="flex flex-col">
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            gid={gid}
            message={msg}
            isLeader={isLeader}
            onReply={onReply}
          />
        ))}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
