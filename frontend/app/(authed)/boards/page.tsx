"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BoardCard } from "@/components/boards/BoardCard";
import { ButtonLink, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBoards } from "@/lib/hooks/useBoards";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function BoardsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { boards, loading } = useBoards();
  // Board creation is admin-only and lives at /admin/boards. Surface a
  // path to it from here so admins don't have to know the admin-console
  // URL — without this the Boards tab is a dead end for them.
  const claims = useRoleClaims();
  const isAdmin = claims?.isAdmin === true;

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || loading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <Eyebrow>Cross-group</Eyebrow>
        <div className="flex items-center justify-between gap-4">
          <Heading level={1} size="md">
            Boards
          </Heading>
          {isAdmin && (
            <ButtonLink href="/admin/boards" variant="secondary" size="sm">
              Manage boards
            </ButtonLink>
          )}
        </div>
        <p className="text-body-sm text-cream-muted">
          Cross-group conversations. Anyone signed in can read and post.
        </p>
      </header>

      {boards.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed border-line bg-ink-raised p-8 text-center">
          <p className="text-body-sm text-cream-muted">No boards yet.</p>
          {isAdmin ? (
            <ButtonLink href="/admin/boards" variant="primary" size="sm">
              Create the first board
            </ButtonLink>
          ) : (
            <p className="text-caption text-cream-muted">
              Check back soon — boards are created by the JACOB team.
            </p>
          )}
        </div>
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
