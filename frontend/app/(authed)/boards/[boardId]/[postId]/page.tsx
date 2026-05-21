"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { NewReplyForm } from "@/components/boards/NewReplyForm";
import { PostCard } from "@/components/boards/PostCard";
import { ReplyList } from "@/components/boards/ReplyList";
import { Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBoardPost } from "@/lib/hooks/useBoardPost";
import { useBoards } from "@/lib/hooks/useBoards";

export default function BoardPostPage() {
  const params = useParams<{ boardId: string; postId: string }>();
  const { boardId, postId } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { boards } = useBoards();
  const { post, replies, loading } = useBoardPost(boardId, postId);

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
      <Link
        href={`/boards/${boardId}`}
        variant="muted"
        className="text-caption"
      >
        ← {board?.name ?? "Board"}
      </Link>

      <div>
        {loading ? (
          <p className="text-body-sm text-cream-muted">Loading post…</p>
        ) : !post ? (
          <p className="text-body-sm text-cream-muted">Post not found.</p>
        ) : (
          <PostCard boardId={boardId} post={post} />
        )}
      </div>

      <div className="space-y-3">
        <Heading level={2} size="sm">
          Replies
        </Heading>
        <ReplyList replies={replies} />
      </div>

      <NewReplyForm
        boardId={boardId}
        postId={postId}
        archived={board?.archivedAt != null}
      />
    </main>
  );
}
