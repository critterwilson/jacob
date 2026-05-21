"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

export type MinistryPost = {
  postId: string;
  title: string;
  body: string;
  sermonUrl: string | null;
  coverImageRef: string | null;
  authorUid: string;
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  reactionCounts: Record<string, number>;
};

type MinistryPostsResponse = {
  posts: MinistryPost[];
  nextCursor: string | null;
};

/**
 * Polls `/api/ministry-feed/posts` every 30s while the tab is visible.
 * Mirrors the boards-posts pattern — single-page (first 20 posts) for v1;
 * pagination can be added by exposing a `loadOlder()` cursor follower.
 */
export function useMinistryFeed() {
  const [posts, setPosts] = useState<MinistryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const etagRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async (signal: AbortSignal) => {
    const mySeq = ++seqRef.current;
    const result = await apiGetConditional<MinistryPostsResponse>(
      "/api/ministry-feed/posts?limit=20",
      etagRef.current,
      { signal },
    );
    if (signal.aborted || mySeq !== seqRef.current) return;
    if (result.etag) etagRef.current = result.etag;
    if (result.status === 304 || result.data === null) return;
    setPosts(result.data.posts);
    setError(null);
  }, []);

  useEffect(() => {
    setLoading(true);
    const ctl = new AbortController();
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          setError("Couldn't load the organization feed.");
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void (async () => {
        try {
          await fetchOnce(ctl.signal);
        } catch {
          /* swallow — next tick retries */
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      ctl.abort();
      clearInterval(interval);
    };
  }, [fetchOnce]);

  return { posts, loading, error };
}
