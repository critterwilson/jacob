"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BoardCard } from "@/components/boards/BoardCard";
import { useAuth } from "@/lib/auth-context";
import { useBoards } from "@/lib/hooks/useBoards";

export default function BoardsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { boards, loading } = useBoards();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Boards</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cross-group conversations. Anyone signed in can read and post.
      </p>

      {boards.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-500">
          No boards yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {boards.map((board) => (
            <li key={board.boardId}>
              <BoardCard board={board} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
