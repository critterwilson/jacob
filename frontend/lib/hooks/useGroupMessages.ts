"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiGet, apiGetConditional } from "@/lib/api";

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
  /**
   * Slugs the *current user* has reacted with on this message. Populated
   * by the backend per request so `useReactions.isMyReaction` keeps
   * working after a refresh (see PR4 / C4).
   */
  myReactions?: string[];
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
 * Polls the backend in two phases: an initial full first-page fetch and
 * then `since=<latestCreatedAt>` deltas, with `If-None-Match` short-
 * circuiting unchanged responses to 304. When `document.hidden` is true
 * the poll tick is skipped and resumed on `visibilitychange` — open
 * background tabs no longer burn quota.
 *
 * Math: at 1k active users with naive every-tick first-page polls each
 * tick was ~50 doc reads per user. With `since=` returning ~0 docs in
 * steady state and 304 short-circuits on top, the read budget for the
 * chat path drops by an order of magnitude (see review item C3 / M4).
 *
 * The `offline` flag is retained as a constant `false` so callers don't
 * need to change — SSE returns in M5.
 */
export function useGroupMessages(gid: string | undefined) {
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const olderCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  // Latest createdAt seen across all loaded pages — used as `since=` on poll.
  const latestCreatedAtRef = useRef<string | null>(null);
  // ETag of the most recent successful poll/fetch — sent back as If-None-Match.
  const pollEtagRef = useRef<string | null>(null);

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
      // Track the newest createdAt for incremental polls. Server returns
      // descending, so messages[0] is freshest.
      const freshest = res.messages[0]?.createdAt ?? null;
      latestCreatedAtRef.current = freshest;
      pollEtagRef.current = null; // first page bypasses 304 — content is fresh
    },
    [gid],
  );

  /** Incremental poll: GET with `since` + `If-None-Match`. Merges by id. */
  const pollIncremental = useCallback(
    async (signal: AbortSignal) => {
      if (!gid) return;
      const since = latestCreatedAtRef.current;
      if (!since) {
        // No anchor yet — fall back to full first-page fetch.
        await fetchFirstPage(signal);
        return;
      }
      const url = `/api/groups/${gid}/messages?limit=${PAGE_SIZE}&since=${encodeURIComponent(
        since,
      )}`;
      const result = await apiGetConditional<MessagesListResponse>(
        url,
        pollEtagRef.current,
        { signal },
      );
      if (signal.aborted) return;
      pollEtagRef.current = result.etag;
      if (result.status === 304 || result.data === null) return;
      const newer = result.data.messages;
      if (newer.length === 0) return;
      // Server returned descending; messages[0] is the freshest.
      const newLatest = newer[0]?.createdAt;
      if (newLatest) latestCreatedAtRef.current = newLatest;
      // Merge into recentMessages: dedupe by id, then sort ascending.
      setRecentMessages((prev) => {
        const map = new Map<string, Message>();
        for (const m of prev) map.set(m.id, m);
        for (const m of newer) map.set(m.id, m);
        return Array.from(map.values()).sort((a, b) => {
          const diff = createdAtMs(a) - createdAtMs(b);
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        });
      });
    },
    [gid, fetchFirstPage],
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
    latestCreatedAtRef.current = null;
    pollEtagRef.current = null;
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

    // visibilitychange-aware poller: skip ticks while the tab is hidden.
    let interval: ReturnType<typeof setInterval> | null = null;
    const onTick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void (async () => {
        try {
          await pollIncremental(ctl.signal);
        } catch {
          /* swallow — next tick retries */
        }
      })();
    };
    interval = setInterval(onTick, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (typeof document === "undefined" || document.hidden) return;
      // Resumed from background: poll once immediately so the UI catches up.
      onTick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      ctl.abort();
      if (interval !== null) clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [gid, fetchFirstPage, pollIncremental]);

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
