"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { NewPostForm } from "@/components/boards/NewPostForm";
import { PostCard } from "@/components/boards/PostCard";
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
        href="/boards"
        className="text-xs text-blue-600 hover:underline"
      >
        ← All boards
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{board?.name ?? "Board"}</h1>
      {board?.description && (
        <p className="mb-4 text-sm text-gray-500">{board.description}</p>
      )}

      <div className="mb-6">
        <NewPostForm boardId={boardId} archived={board?.archivedAt != null} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-500">
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
