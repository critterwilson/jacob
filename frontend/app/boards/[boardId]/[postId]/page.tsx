"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { NewReplyForm } from "@/components/boards/NewReplyForm";
import { PostCard } from "@/components/boards/PostCard";
import { ReplyList } from "@/components/boards/ReplyList";
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
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }
  if (!user) return null;

  const board = boards.find((b) => b.boardId === boardId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link
        href={`/boards/${boardId}`}
        className="text-xs text-blue-600 hover:underline"
      >
        ← {board?.name ?? "Board"}
      </Link>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading post…</p>
        ) : !post ? (
          <p className="text-sm text-gray-500">Post not found.</p>
        ) : (
          <PostCard boardId={boardId} post={post} />
        )}
      </div>

      <h2 className="mt-6 mb-3 text-sm font-semibold text-gray-700">Replies</h2>
      <ReplyList replies={replies} />

      <div className="mt-6">
        <NewReplyForm
          boardId={boardId}
          postId={postId}
          archived={board?.archivedAt != null}
        />
      </div>
    </main>
  );
}
