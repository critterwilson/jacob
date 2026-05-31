"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

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
 * `/api/ministry-feed/posts` — fetch on mount + refetch on tab focus.
 *
 * Interval polling was removed (2026-05) per the "no polling outside
 * chat" rule. Single-page (first 20 posts); a future `loadOlder()`
 * cursor follower can be added when needed.
 */
export function useMinistryFeed() {
  const [posts, setPosts] = useState<MinistryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const etagRef = useRef<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

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

  const refresh = useCallback(() => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          // Silent on focus refetch — keep the existing list visible.
          console.warn("ministry_feed_refresh_failed", err.code, err.status);
        }
      }
    })();
  }, [fetchOnce]);

  useEffect(() => {
    setLoading(true);
    const ctl = new AbortController();
    ctlRef.current = ctl;
    void (async () => {
      try {
        await fetchOnce(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          setError("Couldn't load the ministry feed.");
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ctl.abort();
    };
  }, [fetchOnce]);

  useRefetchOnFocus(refresh);

  return { posts, loading, error, refresh };
}
