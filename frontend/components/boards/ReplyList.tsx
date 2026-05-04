"use client";

import type { BoardReply } from "@/lib/hooks/useBoardPost";

type Props = {
  replies: BoardReply[];
};

function formatTime(reply: BoardReply): string {
  const ts = reply.createdAt;
  if (!ts) return "";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString();
}

export function ReplyList({ replies }: Props) {
  if (replies.length === 0) {
    return (
      <p className="py-4 text-sm text-gray-500">No replies yet. Be the first.</p>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Replies">
      {replies
        .filter((r) => r.deletedAt == null)
        .map((reply) => {
          const hidden = reply.moderation?.state === "hidden";
          return (
            <li
              key={reply.replyId}
              className="rounded border border-gray-200 bg-gray-50 p-3"
            >
              <p className="text-xs text-gray-500">{formatTime(reply)}</p>
              {hidden ? (
                <p className="mt-1 italic text-gray-500">
                  This reply was hidden by automated moderation.
                </p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                  {reply.body}
                </p>
              )}
            </li>
          );
        })}
    </ul>
  );
}
