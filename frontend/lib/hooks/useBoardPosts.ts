"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

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
 * Posts on a board. Fetches on mount and on tab focus/visibility-visible.
 *
 * Interval polling was removed (2026-05) per the project-wide "no
 * polling outside chat" rule. Boards aren't hot — focus refetch
 * covers the realistic UX (alt-tab back, see current posts).
 *
 * `refresh()` is exported so callers can opt into an explicit refetch
 * after a post / reply / reaction mutation.
 */
export function useBoardPosts(boardId: string) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(
    async (signal: AbortSignal) => {
      if (!boardId) return;
      const result = await apiGetConditional<BoardPostsResponse>(
        `/api/boards/${boardId}/posts?limit=50`,
        etagRef.current,
        { signal },
      );
      if (signal.aborted) return;
      if (result.etag) etagRef.current = result.etag;
      if (result.status === 304 || result.data === null) return;
      setPosts(result.data.posts);
    },
    [boardId],
  );

  const refresh = useCallback(() => {
    if (!boardId) return;
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("board_posts_failed", err.code, err.status);
        }
      }
    })();
  }, [boardId, fetchOnce]);

  useEffect(() => {
    if (!boardId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    ctlRef.current = ctl;
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

    return () => {
      ctl.abort();
    };
  }, [boardId, fetchOnce]);

  useRefetchOnFocus(refresh, { enabled: !!boardId });

  return { posts, loading, refresh };
}
