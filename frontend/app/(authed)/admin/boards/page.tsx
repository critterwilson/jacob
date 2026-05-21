"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
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

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function errorMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function AdminBoardsPage() {
  const { user } = useAuth();

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"christian" | "general">("general");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-board action state
  const [archiving, setArchiving] = useState<Record<string, boolean>>({});
  const [archiveError, setArchiveError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<BoardListResponse>("/api/boards");
      setBoards(data.boards);
    } catch (e) {
      setError(errorMsg(e, "Failed to load boards"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep slug in sync with name unless the user has edited it manually.
  useEffect(() => {
    if (!slugTouched) setSlug(toSlug(name));
  }, [name, slugTouched]);

  const handleCreate = async () => {
    if (!user || !name.trim() || !slug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const board = await apiPost<Board>("/api/admin/boards", {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        audience,
      });
      setBoards((prev) => [...prev, board]);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDescription("");
      setAudience("general");
    } catch (e) {
      setCreateError(errorMsg(e, "Failed to create board"));
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (boardId: string) => {
    if (!confirm("Archive this board? Members will no longer be able to post.")) return;
    setArchiving((s) => ({ ...s, [boardId]: true }));
    setArchiveError((s) => ({ ...s, [boardId]: "" }));
    try {
      await apiDelete(`/api/admin/boards/${boardId}`);
      setBoards((prev) => prev.filter((b) => b.boardId !== boardId));
    } catch (e) {
      setArchiveError((s) => ({ ...s, [boardId]: errorMsg(e, "Failed to archive") }));
    } finally {
      setArchiving((s) => ({ ...s, [boardId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Boards</h1>
        <p className="mt-1 text-sm text-cream-muted">
          Manage cross-group boards. Create new boards or archive existing ones.
        </p>
      </header>

      {/* Backend-gap notice */}
      <div className="rounded border border-parchment-amber/40 bg-ink-raised px-4 py-2 text-sm text-parchment-amber">
        <strong>Backend gaps:</strong> No edit endpoint exists (
        <code className="font-mono text-xs">PATCH /api/admin/boards/:id</code> is not
        implemented). Board metadata (name, description, audience) cannot be changed after
        creation — archive and recreate. Archived boards are also not returned by{" "}
        <code className="font-mono text-xs">GET /api/boards</code>, so they disappear
        from this list immediately on archive.
      </div>

      {/* Create form */}
      <section className="rounded border border-line bg-ink-raised p-4 space-y-3">
        <h2 className="text-eyebrow uppercase tracking-wider text-cream-muted">
          Create board
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="board-name" className="block text-xs text-cream-muted mb-1">
              Name
            </label>
            <input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prayer & Praise"
              className="w-full rounded border border-line bg-ink px-2 py-1 text-sm focus:outline-none focus-visible:shadow-glow-gold"
            />
          </div>
          <div>
            <label htmlFor="board-slug" className="block text-xs text-cream-muted mb-1">
              Slug <span className="text-cream-muted/60">(lowercase kebab, permanent)</span>
            </label>
            <input
              id="board-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="prayer-praise"
              className="w-full rounded border border-line bg-ink px-2 py-1 font-mono text-sm focus:outline-none focus-visible:shadow-glow-gold"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="board-description" className="block text-xs text-cream-muted mb-1">
              Description
            </label>
            <input
              id="board-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cross-group prayer requests and praise reports"
              maxLength={500}
              className="w-full rounded border border-line bg-ink px-2 py-1 text-sm focus:outline-none focus-visible:shadow-glow-gold"
            />
          </div>
          <div>
            <label htmlFor="board-audience" className="block text-xs text-cream-muted mb-1">
              Audience
            </label>
            <select
              id="board-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as "christian" | "general")}
              className="rounded border border-line bg-ink px-2 py-1 text-sm focus:outline-none focus-visible:shadow-glow-gold"
            >
              <option value="general">General</option>
              <option value="christian">Christian</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim() || !slug.trim()}
            className="rounded bg-gold px-3 py-1.5 text-sm text-ink hover:bg-gold-soft disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create board"}
          </button>
          {createError && (
            <p className="text-xs text-terracotta">{createError}</p>
          )}
        </div>
      </section>

      {/* Board list */}
      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : boards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-ink-raised p-8 text-center text-sm text-cream-muted">
          No boards yet. Create one above.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-eyebrow uppercase tracking-wider text-cream-muted">
              <th className="py-2 pr-4">Name / Slug</th>
              <th className="pr-4">Audience</th>
              <th className="pr-4">Posts</th>
              <th className="pr-4">Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {boards.map((board) => (
              <tr key={board.boardId} className="border-b border-line">
                <td className="py-2 pr-4">
                  <a
                    href={`/boards/${board.boardId}`}
                    className="font-medium text-gold-soft hover:underline"
                  >
                    {board.name}
                  </a>
                  <p className="font-mono text-xs text-cream-muted">{board.slug}</p>
                </td>
                <td className="pr-4">
                  <span className="inline-flex rounded bg-ink-overlay px-2 py-0.5 text-xs text-cream-muted">
                    {board.audience}
                  </span>
                </td>
                <td className="pr-4 text-cream-muted">{board.postCount}</td>
                <td className="pr-4 text-xs text-cream-muted">
                  {board.description || <span className="italic">—</span>}
                </td>
                <td className="text-right">
                  {archiveError[board.boardId] && (
                    <span className="mr-2 text-xs text-terracotta">
                      {archiveError[board.boardId]}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleArchive(board.boardId)}
                    disabled={archiving[board.boardId]}
                    className="rounded border border-terracotta/40 px-2 py-0.5 text-xs text-terracotta hover:bg-terracotta/10 disabled:opacity-40"
                  >
                    {archiving[board.boardId] ? "Archiving…" : "Archive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
