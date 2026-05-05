"use client";

import Link from "next/link";

import { ReactionBar } from "@/components/chat/ReactionBar";
import { Card } from "@/components/ui";
import { useBoardPostReactions } from "@/lib/hooks/useBoardPostReactions";
import type { BoardPost } from "@/lib/hooks/useBoardPosts";

type Props = {
  boardId: string;
  post: BoardPost;
};

function formatTime(post: BoardPost): string {
  const ts = post.createdAt;
  if (!ts) return "";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString();
}

export function PostCard({ boardId, post }: Props) {
  const { isMyReaction, toggle } = useBoardPostReactions(boardId, post.postId);
  const hidden = post.moderation?.state === "hidden";

  return (
    <Card surface="raised" padding="md" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption text-cream-muted">
          {post.pinnedAt && (
            <span className="font-semibold text-parchment-amber">
              Pinned ·{" "}
            </span>
          )}
          {formatTime(post)}
        </span>
        <span className="text-caption text-cream-dim">
          {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
        </span>
      </div>

      {hidden ? (
        <p className="italic text-body-sm text-cream-dim">
          This post was hidden by automated moderation.
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-body text-cream">{post.body}</p>
      )}

      <ReactionBar
        mid={post.postId}
        reactionCounts={post.reactionCounts}
        isMyReaction={isMyReaction}
        onToggle={toggle}
      />

      <div>
        <Link
          href={`/boards/${boardId}/${post.postId}`}
          className="rounded-sm text-caption text-gold-soft transition-colors duration-fast hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
        >
          Open post →
        </Link>
      </div>
    </Card>
  );
}
