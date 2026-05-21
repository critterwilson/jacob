"use client";

import Link from "next/link";

import { Card, Eyebrow, Heading, Skeleton } from "@/components/ui";
import type { MinistryPost } from "@/lib/hooks/useMinistryFeed";

type Props = {
  posts: MinistryPost[];
  loading: boolean;
};

const PREVIEW_CHARS = 140;
const POST_LIMIT = 2;

function stripMarkdown(body: string): string {
  return body.replace(/[*_#`>]/g, "").replace(/\n+/g, " ").trim();
}

export function MinistryHighlights({ posts, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const visible = posts.filter((p) => !p.deletedAt).slice(0, POST_LIMIT);

  if (visible.length === 0) {
    return (
      <Card surface="raised" className="space-y-2">
        <Eyebrow>From your ministry</Eyebrow>
        <p className="text-body-sm text-cream-muted">
          Nothing posted yet. When your ministry shares a sermon or update
          here, it&apos;ll appear at the top of your home.
        </p>
        <Link
          href="/feed"
          className="inline-block pt-1 text-caption text-gold-soft hover:text-gold underline-offset-4 hover:underline"
        >
          Open ministry feed →
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((post) => {
        const preview = stripMarkdown(post.body).slice(0, PREVIEW_CHARS);
        const isPinned = Boolean(post.pinnedAt);
        return (
          <Link
            key={post.postId}
            href="/feed"
            className="block rounded-lg no-underline focus:outline-none focus-visible:shadow-glow-gold"
          >
            <Card surface="raised" interactive className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <Eyebrow>{isPinned ? "Pinned" : "From your ministry"}</Eyebrow>
              </div>
              <Heading level={2} size="sm">
                {post.title}
              </Heading>
              {preview && (
                <p className="line-clamp-3 text-body-sm text-cream-muted">
                  {preview}
                </p>
              )}
              {post.sermonUrl && (
                <p className="text-caption text-gold-soft">▶ Sermon attached</p>
              )}
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
