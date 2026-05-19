"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiGet, apiGetConditional } from "@/lib/api";
import { openStream, type StreamHandle } from "@/lib/sse";

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 10_000;
// M5: backoff schedule for stream reconnects (ms). Hand-tuned; first
// few attempts are quick so a transient blip recovers without the user
// noticing, then we back off so a persistently-broken stream doesn't
// hammer Cloud Run.
const STREAM_BACKOFF_MS = [500, 1500, 5000, 15000, 30000] as const;
// After this many consecutive open/error failures inside a session, we
// stop trying SSE and stay on polling. The user gets the existing 10s
// behaviour rather than a continually-flapping connection.
const STREAM_GIVE_UP_AFTER = STREAM_BACKOFF_MS.length;

export type ModerationState = "scored" | "flagged" | "hidden" | "skipped" | "errored";

export type ModerationFields = {
  state: ModerationState | null;
  reasons: string[];
  scores: Record<string, number> | null;
  scoredAt: string | null;
  policy?: string | null;
};

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
 * Two transports, decided at runtime:
 *
 *  - **SSE (preferred).** Opens `/api/groups/{gid}/messages/stream`,
 *    receives `event: message` frames carrying full Message JSON,
 *    merges by id into the same recentMessages state used by polling.
 *  - **Polling (fallback).** The pre-M5 path: `since=` poll every 10s
 *    with `If-None-Match` short-circuits to 304. Engaged when the SSE
 *    open fails, when an opened stream errors, and (after the backoff
 *    schedule is exhausted) for the rest of the session.
 *
 * Polling is paused while the stream is healthy; visibility-change
 * closes the stream and pauses polling while `document.hidden` is true.
 * Both transports tear down on unmount.
 *
 * The hook contract is unchanged: callers still read `messages`,
 * `loading`, `hasMore`, `loadOlder`. See ADR 0013.
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
      const oldestFirst = [...res.messages].reverse();
      setRecentMessages(oldestFirst);
      olderCursorRef.current = res.nextCursor;
      setHasMore(Boolean(res.nextCursor));
      const freshest = res.messages[0]?.createdAt ?? null;
      latestCreatedAtRef.current = freshest;
      pollEtagRef.current = null;
    },
    [gid],
  );

  const pollIncremental = useCallback(
    async (signal: AbortSignal) => {
      if (!gid) return;
      const since = latestCreatedAtRef.current;
      if (!since) {
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
      const newLatest = newer[0]?.createdAt;
      if (newLatest) latestCreatedAtRef.current = newLatest;
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

  /** Merge a single message (from SSE) into recentMessages by id. */
  const mergeStreamMessage = useCallback((msg: Message) => {
    if (msg.createdAt) {
      const prev = latestCreatedAtRef.current;
      // Track the freshest createdAt so the polling fallback (if it
      // ever takes over) resumes from the right point.
      if (!prev || Date.parse(msg.createdAt) > Date.parse(prev)) {
        latestCreatedAtRef.current = msg.createdAt;
      }
    }
    setRecentMessages((prev) => {
      const map = new Map<string, Message>();
      for (const m of prev) map.set(m.id, m);
      map.set(msg.id, msg);
      return Array.from(map.values()).sort((a, b) => {
        const diff = createdAtMs(a) - createdAtMs(b);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    });
  }, []);

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

    // ── transport state (closed over by the effect body) ────────────────
    let streamHandle: StreamHandle | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;
    let givenUpOnStream = false;
    // Prevents two transports from running at once (stream connect race
    // against a polling restart on visibilitychange).
    let mode: "idle" | "stream" | "polling" = "idle";

    const startPolling = () => {
      if (mode === "polling") return;
      mode = "polling";
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
      pollInterval = setInterval(onTick, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const closeStream = () => {
      if (streamHandle !== null) {
        const h = streamHandle;
        streamHandle = null;
        h.close();
      }
    };

    const scheduleReconnect = () => {
      if (givenUpOnStream || ctl.signal.aborted) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const delay =
        STREAM_BACKOFF_MS[Math.min(failureCount, STREAM_BACKOFF_MS.length - 1)];
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void openStreamConnection();
      }, delay);
    };

    const openStreamConnection = async () => {
      if (ctl.signal.aborted || givenUpOnStream) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (streamHandle !== null) return; // already open
      mode = "stream";
      try {
        const handle = await openStream(`/api/groups/${gid}/messages/stream`, {
          onOpen: () => {
            failureCount = 0;
            stopPolling();
          },
          onEvent: (ev) => {
            if (ev.event !== "message") return;
            try {
              const msg = JSON.parse(ev.data) as Message;
              if (!msg || typeof msg.id !== "string") return;
              mergeStreamMessage(msg);
            } catch {
              console.warn("stream_message_parse_failed");
            }
          },
          onError: (err) => {
            if (ctl.signal.aborted) return;
            // The current handle is now defunct; clear it so the next
            // open attempt doesn't see a stale reference.
            streamHandle = null;
            failureCount += 1;
            if (failureCount >= STREAM_GIVE_UP_AFTER) {
              givenUpOnStream = true;
              console.warn(
                "stream_giving_up",
                gid,
                err.message,
                "falling back to polling for the rest of this session",
              );
              startPolling();
              return;
            }
            // Polling covers the gap while we wait for the backoff.
            startPolling();
            scheduleReconnect();
          },
        });
        if (ctl.signal.aborted) {
          handle.close();
          return;
        }
        streamHandle = handle;
      } catch (err) {
        if (ctl.signal.aborted) return;
        failureCount += 1;
        if (failureCount >= STREAM_GIVE_UP_AFTER) {
          givenUpOnStream = true;
          console.warn("stream_open_failed_giving_up", gid, err);
          startPolling();
          return;
        }
        startPolling();
        scheduleReconnect();
      }
    };

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
      if (ctl.signal.aborted) return;
      // After the first page lands, kick off the stream. Polling stays
      // armed until the stream's `onOpen` fires.
      startPolling();
      void openStreamConnection();
    })();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        // Tab backgrounded: close stream + pause polling. Mirrors the
        // pre-M5 behaviour. The instant the tab comes back, we'll
        // catch up via a polling tick before reopening the stream.
        closeStream();
        stopPolling();
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        mode = "idle";
        return;
      }
      // Tab foregrounded: poll once immediately so the UI catches up.
      void (async () => {
        try {
          await pollIncremental(ctl.signal);
        } catch {
          /* ignore */
        }
      })();
      if (!givenUpOnStream) {
        void openStreamConnection();
      } else {
        startPolling();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      ctl.abort();
      closeStream();
      stopPolling();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [gid, fetchFirstPage, pollIncremental, mergeStreamMessage]);

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
    /**
     * Retained for hook-contract compatibility with pre-M5 callers.
     * The hook no longer surfaces an offline state; the SSE / polling
     * switch is internal.
     */
    offline: false as const,
  };
}
