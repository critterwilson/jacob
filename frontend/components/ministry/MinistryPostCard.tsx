"use client";

import { ReactionBar } from "@/components/chat/ReactionBar";
import { Card, Link } from "@/components/ui";
import type { MinistryPost } from "@/lib/hooks/useMinistryFeed";
import { useMinistryPostReactions } from "@/lib/hooks/useMinistryPostReactions";

type Props = {
  post: MinistryPost;
};

function formatTime(post: MinistryPost): string {
  if (!post.createdAt) return "";
  const ms = Date.parse(post.createdAt);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString();
}

export function MinistryPostCard({ post }: Props) {
  const { isMyReaction, toggle } = useMinistryPostReactions();

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
      </div>

      <h2 className="text-h3 font-semibold text-cream">{post.title}</h2>

      {post.coverImageRef && (
        // Cover images are admin-uploaded into the moderated public
        // bucket; using <img> directly avoids Next/Image config plumbing
        // for a single greenfield surface.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.coverImageRef}
          alt=""
          className="w-full rounded-md border border-line bg-ink-overlay object-cover"
        />
      )}

      <p className="whitespace-pre-wrap text-body text-cream">{post.body}</p>

      {post.sermonUrl && (
        <Link
          href={post.sermonUrl}
          variant="muted"
          className="text-body-sm"
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch / listen →
        </Link>
      )}

      <ReactionBar
        mid={post.postId}
        reactionCounts={post.reactionCounts}
        isMyReaction={isMyReaction}
        onToggle={toggle}
      />
    </Card>
  );
}
