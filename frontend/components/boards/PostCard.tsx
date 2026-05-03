"use client";

import Link from "next/link";

import { ReactionBar } from "@/components/chat/ReactionBar";
import { useBoardPostReactions } from "@/lib/hooks/useBoardPostReactions";
import type { BoardPost } from "@/lib/hooks/useBoardPosts";

type Props = {
  boardId: string;
  post: BoardPost;
};

function formatTime(post: BoardPost): string {
  const ts = post.createdAt;
  if (!ts) return "";
  try {
    const d = ts.toDate();
    return d.toLocaleString();
  } catch {
    return "";
  }
}

export function PostCard({ boardId, post }: Props) {
  const { isMyReaction, toggle } = useBoardPostReactions(boardId, post.postId);
  const hidden = post.moderation?.state === "hidden";

  return (
    <article className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-gray-500">
          {post.pinnedAt ? <strong>📌 Pinned · </strong> : null}
          {formatTime(post)}
        </span>
        <span className="text-xs text-gray-400">
          {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
        </span>
      </div>

      {hidden ? (
        <p className="mt-2 italic text-gray-500">
          This post was hidden by automated moderation.
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
          {post.body}
        </p>
      )}

      <ReactionBar
        mid={post.postId}
        reactionCounts={post.reactionCounts}
        isMyReaction={isMyReaction}
        onToggle={toggle}
      />

      <div className="mt-3">
        <Link
          href={`/boards/${boardId}/${post.postId}`}
          className="text-xs text-blue-600 hover:underline"
        >
          Open post →
        </Link>
      </div>
    </article>
  );
}
