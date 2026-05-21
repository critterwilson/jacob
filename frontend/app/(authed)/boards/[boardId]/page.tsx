"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { NewPostForm } from "@/components/boards/NewPostForm";
import { PostCard } from "@/components/boards/PostCard";
import { Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBoardPosts } from "@/lib/hooks/useBoardPosts";
import { useBoards } from "@/lib/hooks/useBoards";

export default function BoardPage() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { boards } = useBoards();
  const { posts, loading } = useBoardPosts(boardId);

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

  const board = boards.find((b) => b.boardId === boardId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <Link href="/boards" variant="muted" className="text-caption">
        ← All boards
      </Link>

      <header className="space-y-2">
        <Heading level={1} size="md">
          {board?.name ?? "Board"}
        </Heading>
        {board?.description && (
          <p className="text-body-sm text-cream-muted">{board.description}</p>
        )}
      </header>

      <NewPostForm boardId={boardId} archived={board?.archivedAt != null} />

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-ink-raised p-8 text-center text-body-sm text-cream-muted">
          No posts yet. Start the conversation.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.postId}>
              <PostCard boardId={boardId} post={post} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
