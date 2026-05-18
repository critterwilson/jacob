"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BoardCard } from "@/components/boards/BoardCard";
import { Eyebrow, Heading } from "@/components/ui";
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
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <Eyebrow>Cross-group</Eyebrow>
        <Heading level={1} size="md">
          Boards
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Cross-group conversations. Anyone signed in can read and post.
        </p>
      </header>

      {boards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-ink-raised p-8 text-center text-body-sm text-cream-muted">
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
