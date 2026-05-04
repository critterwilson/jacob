"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiGet, apiGetConditional } from "@/lib/api";
import type { Message } from "@/lib/hooks/useGroupMessages";

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 10_000;

type MessagesListResponse = {
  messages: Message[];
  nextCursor: string | null;
};

const createdAtMs = (m: Message): number =>
  m.createdAt ? Date.parse(m.createdAt) || 0 : 0;

/**
 * Thread replies under a parent message. Mirrors `useGroupMessages`:
 * initial full fetch, then `since=`-incremental polls with
 * `If-None-Match`, paused while the tab is hidden. Backend returns
 * ascending by createdAt for thread reads (M3).
 */
export function useThreadMessages(
  gid: string | undefined,
  parentMessageId: string | undefined,
) {
  const [recent, setRecent] = useState<Message[]>([]);
  const [older, setOlder] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const olderCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const latestCreatedAtRef = useRef<string | null>(null);
  const pollEtagRef = useRef<string | null>(null);

  const fetchFirstPage = useCallback(
    async (signal: AbortSignal) => {
      if (!gid || !parentMessageId) return;
      const url = `/api/groups/${gid}/messages?parentMessageId=${encodeURIComponent(
        parentMessageId,
      )}&limit=${PAGE_SIZE}`;
      const res = await apiGet<MessagesListResponse>(url, { signal });
      if (signal.aborted) return;
      // Server returns ascending for threads — preserve order.
      setRecent(res.messages);
      olderCursorRef.current = res.nextCursor;
      setHasMore(Boolean(res.nextCursor));
      // Latest reply is at the end (ascending order).
      const last = res.messages[res.messages.length - 1];
      latestCreatedAtRef.current = last?.createdAt ?? null;
      pollEtagRef.current = null;
    },
    [gid, parentMessageId],
  );

  const pollIncremental = useCallback(
    async (signal: AbortSignal) => {
      if (!gid || !parentMessageId) return;
      const since = latestCreatedAtRef.current;
      if (!since) {
        await fetchFirstPage(signal);
        return;
      }
      const url =
        `/api/groups/${gid}/messages?parentMessageId=${encodeURIComponent(parentMessageId)}` +
        `&limit=${PAGE_SIZE}&since=${encodeURIComponent(since)}`;
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
      // Ascending order — last is freshest.
      const newLatest = newer[newer.length - 1]?.createdAt;
      if (newLatest) latestCreatedAtRef.current = newLatest;
      setRecent((prev) => {
        const map = new Map<string, Message>();
        for (const m of prev) map.set(m.id, m);
        for (const m of newer) map.set(m.id, m);
        return Array.from(map.values()).sort((a, b) => {
          const diff = createdAtMs(a) - createdAtMs(b);
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        });
      });
    },
    [gid, parentMessageId, fetchFirstPage],
  );

  useEffect(() => {
    if (!gid || !parentMessageId) {
      setRecent([]);
      setOlder([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    olderCursorRef.current = null;
    latestCreatedAtRef.current = null;
    pollEtagRef.current = null;
    setRecent([]);
    setOlder([]);
    setLoading(true);
    setHasMore(false);

    const ctl = new AbortController();
    void (async () => {
      try {
        await fetchFirstPage(ctl.signal);
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("thread_read_failed", err.code, err.status);
        }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();

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
  }, [gid, parentMessageId, fetchFirstPage, pollIncremental]);

  const loadOlder = useCallback(async () => {
    if (
      !gid ||
      !parentMessageId ||
      !olderCursorRef.current ||
      loadingOlderRef.current
    )
      return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const cursor = encodeURIComponent(olderCursorRef.current);
      const url = `/api/groups/${gid}/messages?parentMessageId=${encodeURIComponent(
        parentMessageId,
      )}&limit=${PAGE_SIZE}&cursor=${cursor}`;
      const res = await apiGet<MessagesListResponse>(url);
      // Older page is appended *before* recent for thread (still ascending overall).
      setOlder((prev) => [...res.messages, ...prev]);
      olderCursorRef.current = res.nextCursor;
      setHasMore(Boolean(res.nextCursor));
    } catch (err) {
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("thread_load_older_failed", err.code, err.status);
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [gid, parentMessageId]);

  const messages = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of older) map.set(m.id, m);
    for (const m of recent) map.set(m.id, m);
    return Array.from(map.values()).sort((a, b) => {
      const diff = createdAtMs(a) - createdAtMs(b);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [older, recent]);

  return { messages, loading, loadingOlder, hasMore, loadOlder };
}
