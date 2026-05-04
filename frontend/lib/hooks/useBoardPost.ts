"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import type { BoardPost } from "./useBoardPosts";

const POLL_INTERVAL_MS = 30_000;

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
 * Single board post + its replies. Polls every 30s.
 */
export function useBoardPost(boardId: string, postId: string) {
  const [post, setPost] = useState<BoardPost | null>(null);
  const [replies, setReplies] = useState<BoardReply[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!boardId || !postId) return;
    setLoading(true);
    const ctl = new AbortController();
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
  }, [boardId, postId, fetchOnce]);

  return { post, replies, loading };
}
