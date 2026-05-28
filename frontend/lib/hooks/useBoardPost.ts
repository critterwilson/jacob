"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";
import type { BoardPost } from "./useBoardPosts";

export type BoardReply = {
  replyId: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  mediaRefs: string[];
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  mentions?: string[];
  moderation?: { state?: string | null; reasons?: string[] };
};

type BoardRepliesResponse = {
  replies: BoardReply[];
  nextCursor: string | null;
};

/**
 * A single board post + its replies. Fetches on mount and on tab
 * focus/visibility-visible.
 *
 * Interval polling was removed (2026-05) per the project-wide "no
 * polling outside chat" rule. `refresh()` is exported so callers can
 * explicit-refetch after a reply post / reaction toggle / edit.
 */
export function useBoardPost(boardId: string, postId: string) {
  const [post, setPost] = useState<BoardPost | null>(null);
  const [replies, setReplies] = useState<BoardReply[]>([]);
  const [loading, setLoading] = useState(true);
  const ctlRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(
    async (signal: AbortSignal) => {
      if (!boardId || !postId) return;
      const [postRes, repliesRes] = await Promise.all([
        apiGet<BoardPost>(`/api/boards/${boardId}/posts/${postId}`, { signal }),
        apiGet<BoardRepliesResponse>(
          `/api/boards/${boardId}/posts/${postId}/replies?limit=100`,
          { signal },
        ),
      ]);
      if (signal.aborted) return;
      setPost(postRes);
      setReplies(repliesRes.replies);
    },
    [boardId, postId],
  );

  const refresh = useCallback(() => {
    if (!boardId || !postId) return;
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted" && err.status !== 404) {
          console.warn("board_post_refresh_failed", err.code, err.status);
        }
      }
    })();
  }, [boardId, postId, fetchOnce]);

  useEffect(() => {
    if (!boardId || !postId) return;
    setLoading(true);
    const ctl = new AbortController();
    ctlRef.current = ctl;
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setPost(null);
          } else if (err.code !== "aborted") {
            console.warn("board_post_read_failed", err.code, err.status);
          }
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ctl.abort();
    };
  }, [boardId, postId, fetchOnce]);

  useRefetchOnFocus(refresh, { enabled: !!boardId && !!postId });

  return { post, replies, loading, refresh };
}
