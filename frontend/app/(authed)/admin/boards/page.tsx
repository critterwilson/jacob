"use client";

import { useCallback, useEffect, useState } from "react";

import {
  BoardForm,
  type BoardSubmitValues,
} from "@/components/admin/boards/BoardForm";
import {
  Banner,
  ButtonLink,
  Button,
  Card,
  Eyebrow,
  FloatingActionBar,
  Heading,
  Link,
} from "@/components/ui";
import { ApiError, apiDelete, apiGet, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Board = {
  boardId: string;
  name: string;
  slug: string;
  description: string;
  audience: "christian" | "general";
  archivedAt: string | null;
  postCount: number;
};

type BoardListResponse = {
  boards: Board[];
};

function errorMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function AdminBoardsPage() {
  const { user } = useAuth();

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [archiving, setArchiving] = useState<Record<string, boolean>>({});
  const [archiveError, setArchiveError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<BoardListResponse>("/api/boards");
      // Drop archived boards — there's no unarchive flow, so they'd be inert
      // rows. Parity with the public `useBoards` hook.
      setBoards(data.boards.filter((b) => b.archivedAt == null));
    } catch (e) {
      setLoadError(errorMsg(e, "Failed to load boards"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (board: Board) => {
    setEditingId(board.boardId);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (
    boardId: string,
    payload: BoardSubmitValues,
  ) => {
    if (payload.mode !== "edit") return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await apiPatch<Board>(
        `/api/admin/boards/${boardId}`,
        payload.values,
      );
      setBoards((prev) =>
        prev.map((b) => (b.boardId === boardId ? { ...b, ...updated } : b)),
      );
      setEditingId(null);
    } catch (e) {
      setEditError(errorMsg(e, "Failed to save changes"));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (boardId: string) => {
    if (
      !confirm("Archive this board? Members will no longer be able to post.")
    ) {
      return;
    }
    setArchiving((s) => ({ ...s, [boardId]: true }));
    setArchiveError((s) => ({ ...s, [boardId]: "" }));
    try {
      await apiDelete(`/api/admin/boards/${boardId}`);
      setBoards((prev) => prev.filter((b) => b.boardId !== boardId));
    } catch (e) {
      setArchiveError((s) => ({
        ...s,
        [boardId]: errorMsg(e, "Failed to archive"),
      }));
    } finally {
      setArchiving((s) => ({ ...s, [boardId]: false }));
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Eyebrow>Admin</Eyebrow>
          <Heading level={1} size="md">
            Boards
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Cross-group forums anyone in JACOB can read and post to.
          </p>
        </div>
        {/* Mobile gets the FloatingActionBar below; this CTA covers desktop. */}
        <ButtonLink
          href="/admin/boards/new"
          variant="primary"
          className="hidden shrink-0 md:inline-flex"
        >
          New board
        </ButtonLink>
      </header>

      {loadError && <Banner tone="error">{loadError}</Banner>}

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : boards.length === 0 ? (
        <Card
          surface="raised"
          padding="lg"
          className="border-dashed text-center"
        >
          <p className="text-body text-cream">No boards yet.</p>
          <p className="mt-1 text-body-sm text-cream-muted">
            Boards are cross-group forums. Create your first to give people a
            place to talk outside any one group.
          </p>
          <ButtonLink
            href="/admin/boards/new"
            variant="primary"
            className="mt-5"
          >
            Create a board
          </ButtonLink>
        </Card>
      ) : (
        <ul className="space-y-3">
          {boards.map((board) => (
            <li key={board.boardId}>
              {editingId === board.boardId ? (
                <Card surface="raised" padding="md" className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <Eyebrow>Editing</Eyebrow>
                    <span className="font-mono text-caption text-cream-muted">
                      {board.slug}
                    </span>
                  </div>
                  <BoardForm
                    mode="edit"
                    initial={{
                      name: board.name,
                      slug: board.slug,
                      description: board.description,
                      audience: board.audience,
                    }}
                    pending={saving}
                    error={editError}
                    onSubmit={(payload) =>
                      void handleSaveEdit(board.boardId, payload)
                    }
                    onCancel={cancelEdit}
                  />
                </Card>
              ) : (
                <Card surface="raised" padding="md" className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/boards/${board.boardId}`}
                        variant="default"
                        className="block truncate font-display text-display-sm text-cream no-underline hover:no-underline"
                      >
                        {board.name}
                      </Link>
                      <p className="truncate font-mono text-caption text-cream-muted">
                        /boards/{board.slug}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-sm bg-ink-overlay px-2 py-0.5 text-caption text-cream-muted">
                      {board.audience}
                    </span>
                  </div>

                  {board.description ? (
                    <p className="text-body-sm text-cream">
                      {board.description}
                    </p>
                  ) : (
                    <p className="text-body-sm italic text-cream-muted">
                      No description.
                    </p>
                  )}

                  <p className="text-caption text-cream-muted">
                    {board.postCount === 1
                      ? "1 post"
                      : `${board.postCount} posts`}
                  </p>

                  {archiveError[board.boardId] && (
                    <p
                      role="alert"
                      className="text-body-sm text-terracotta"
                    >
                      {archiveError[board.boardId]}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(board)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleArchive(board.boardId)}
                      loading={archiving[board.boardId]}
                    >
                      {archiving[board.boardId] ? "Archiving…" : "Archive"}
                    </Button>
                  </div>
                </Card>
              )}
            </li>
          ))}
        </ul>
      )}

      <FloatingActionBar label="New board" href="/admin/boards/new" />
    </main>
  );
}
