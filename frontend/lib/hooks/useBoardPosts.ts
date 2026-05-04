"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

export type BoardPost = {
  postId: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  mediaRefs: string[];
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  mentions?: string[];
  reactionCounts?: Record<string, number>;
  replyCount: number;
  moderation?: { state?: string | null; reasons?: string[] };
};

type BoardPostsResponse = {
  posts: BoardPost[];
  nextCursor: string | null;
};

/**
 * Posts on a board. Polls every 30s — boards are far less hot than
 * chat, so SSE is unjustified (per migration plan §6.2).
 *
 * Note: this hook fetches only the first page (`useBoardPosts` was
 * also single-page pre-M3). Future paged scrollback can be added by
 * exposing `loadOlder`.
 */
export function useBoardPosts(boardId: string) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(
    async (signal: AbortSignal) => {
      if (!boardId) return;
      const res = await apiGet<BoardPostsResponse>(
        `/api/boards/${boardId}/posts?limit=50`,
        { signal },
      );
      if (signal.aborted) return;
      setPosts(res.posts);
    },
    [boardId],
  );

  useEffect(() => {
    if (!boardId) return;
    setLoading(true);
    const ctl = new AbortController();
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("board_posts_failed", err.code, err.status);
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

    const interval = setInterval(() => {
      void (async () => {
        try {
          await fetchOnce(ctl.signal);
        } catch {
          /* swallow */
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      ctl.abort();
      clearInterval(interval);
    };
  }, [boardId, fetchOnce]);

  return { posts, loading };
}
