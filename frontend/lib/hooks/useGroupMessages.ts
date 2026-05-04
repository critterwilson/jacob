"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 10_000;

export type ModerationState = "scored" | "flagged" | "hidden" | "skipped" | "errored";

export type ModerationFields = {
  state: ModerationState | null;
  reasons: string[];
  scores: Record<string, number> | null;
  scoredAt: string | null;
  policy?: string | null;
};

/**
 * Wire-shape Message from the backend `/api/groups/{gid}/messages`
 * endpoint. ISO-8601 strings replace the prior Firestore Timestamp
 * objects; consumers should use `Date.parse(createdAt)` (or the
 * existing helpers in `lib/messageRef.ts`) when they need numeric
 * comparisons.
 */
export type Message = {
  id: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  parentMessageId: string | null;
  threadReplyCount: number;
  mediaRefs: string[];
  participants?: string[];
  repostOfThread?: string | null;
  moderation?: ModerationFields | null;
  announcedAt?: string | null;
  announcedBy?: string | null;
  reactionCounts?: Record<string, number>;
  mentions?: string[];
};

type MessagesListResponse = {
  messages: Message[];
  nextCursor: string | null;
};

const createdAtMs = (m: Message): number =>
  m.createdAt ? Date.parse(m.createdAt) || 0 : 0;

/**
 * Group chat messages.
 *
 * As of M3 this hook polls the backend instead of subscribing to a
 * Firestore listener. The realtime semantics will return in M5 (SSE).
 * Until then, messages from another user appear within the
 * `POLL_INTERVAL_MS` window — see migration plan §7.3 for the
 * acceptance criterion. The previous `offline` flag is retained as a
 * constant `false` so callers don't need to change.
 */
export function useGroupMessages(gid: string | undefined) {
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const olderCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  const fetchFirstPage = useCallback(
    async (signal: AbortSignal) => {
      if (!gid) return;
      const res = await apiGet<MessagesListResponse>(
        `/api/groups/${gid}/messages?limit=${PAGE_SIZE}`,
        { signal },
      );
      if (signal.aborted) return;
      // Server returns descending by createdAt; UI renders ascending.
      const oldestFirst = [...res.messages].reverse();
      setRecentMessages(oldestFirst);
      olderCursorRef.current = res.nextCursor;
      setHasMore(Boolean(res.nextCursor));
    },
    [gid],
  );

  useEffect(() => {
    if (!gid) {
      setRecentMessages([]);
      setOlderMessages([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    olderCursorRef.current = null;
    setRecentMessages([]);
    setOlderMessages([]);
    setLoading(true);
    setHasMore(false);

    const ctl = new AbortController();

    void (async () => {
      try {
        await fetchFirstPage(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("messages_read_failed", err.code, err.status);
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

    const interval = setInterval(() => {
      void (async () => {
        try {
          await fetchFirstPage(ctl.signal);
        } catch {
          /* swallow — next tick will retry */
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      ctl.abort();
      clearInterval(interval);
    };
  }, [gid, fetchFirstPage]);

  const loadOlder = useCallback(async () => {
    if (
      !gid ||
      !olderCursorRef.current ||
      loadingOlderRef.current
    )
      return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const cursor = encodeURIComponent(olderCursorRef.current);
      const res = await apiGet<MessagesListResponse>(
        `/api/groups/${gid}/messages?limit=${PAGE_SIZE}&cursor=${cursor}`,
      );
      const oldestFirst = [...res.messages].reverse();
      setOlderMessages((prev) => [...oldestFirst, ...prev]);
      olderCursorRef.current = res.nextCursor;
      setHasMore(Boolean(res.nextCursor));
    } catch (err) {
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("messages_load_older_failed", err.code, err.status);
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [gid]);

  const messages = useMemo(() => {
    // Merge older + recent, dedupe by id (older may overlap if pagination
    // raced a poll), and sort ascending by createdAt + id tie-breaker.
    const map = new Map<string, Message>();
    for (const m of olderMessages) map.set(m.id, m);
    for (const m of recentMessages) map.set(m.id, m);
    return Array.from(map.values()).sort((a, b) => {
      const diff = createdAtMs(a) - createdAtMs(b);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [olderMessages, recentMessages]);

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    loadOlder,
    /** Retained for hook-contract compatibility; SSE returns in M5. */
    offline: false as const,
  };
}
