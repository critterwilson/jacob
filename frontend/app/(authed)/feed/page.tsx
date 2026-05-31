"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { MinistryPostCard } from "@/components/ministry/MinistryPostCard";
import {
  Banner,
  ButtonLink,
  Eyebrow,
  FloatingActionBar,
  Heading,
  Link,
} from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useMinistryFeed } from "@/lib/hooks/useMinistryFeed";
import { useMinistryOwner } from "@/lib/hooks/useMinistryOwner";

export default function MinistryFeedPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isOwner = useMinistryOwner();
  const { posts, loading, error } = useMinistryFeed();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }
  if (!user) return null;

  return (
    <main
      id="main"
      className="mx-auto max-w-2xl px-4 py-10 space-y-6"
      aria-labelledby="ministry-feed-heading"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Eyebrow>From your ministry</Eyebrow>
          <Heading id="ministry-feed-heading" level={1} size="md">
            Ministry feed
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Sermons, devotionals, and announcements from the ministry team.
            Pinned posts stay at the top.{" "}
            <Link href="/settings/notifications" variant="muted" className="underline">
              Manage notifications
            </Link>
            .
          </p>
        </div>
        {/* Desktop CTAs. On mobile the FloatingActionBar below carries the
         * primary action — see docs/design-system.md §9 (one primary). */}
        {isOwner === true && (
          <div className="flex gap-2">
            <ButtonLink
              href="/feed/weekly-sermon"
              variant="secondary"
              aria-label="Manage weekly sermon"
              className="hidden md:inline-flex"
            >
              Weekly sermon
            </ButtonLink>
            <ButtonLink
              href="/feed/new"
              variant="primary"
              aria-label="New post"
              className="hidden md:inline-flex"
            >
              New post
            </ButtonLink>
          </div>
        )}
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-ink-raised p-8 text-center text-body-sm text-cream-muted">
          Nothing posted yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.postId}>
              <MinistryPostCard post={post} />
            </li>
          ))}
        </ul>
      )}

      {isOwner === true && (
        <FloatingActionBar label="New post" href="/feed/new" />
      )}
    </main>
  );
}
