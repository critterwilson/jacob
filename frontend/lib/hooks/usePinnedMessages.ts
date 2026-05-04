"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet, apiPatch } from "@/lib/api";

export type PinnedMessage = {
  id: string;
  body: string;
  authorUid: string;
  announcedAt: string | null;
};

type PinnedMessagesResponse = {
  messages: Array<{
    id: string;
    body: string;
    authorUid: string;
    announcedAt: string | null;
  }>;
};

/**
 * Pinned messages for a group.
 *
 * As of M3 this calls `GET /api/groups/{gid}/pinned-messages` which
 * resolves the group's `pinnedMessageIds` to full Message docs in one
 * round-trip. The previous pattern was `onSnapshot(group)` + per-id
 * `getDoc(message)`.
 *
 * `togglePin` writes via `PATCH /api/groups/{gid}` (M4) — passing the
 * full new `pinnedMessageIds` array; the backend validates each id
 * exists in the group's messages.
 */
export function usePinnedMessages(gid: string) {
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!gid) {
      setPinned([]);
      setPinnedIds([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await apiGet<PinnedMessagesResponse>(
        `/api/groups/${gid}/pinned-messages`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setPinned(res.messages.map((m) => ({
        id: m.id,
        body: m.body,
        authorUid: m.authorUid,
        announcedAt: m.announcedAt,
      })));
      setPinnedIds(res.messages.map((m) => m.id));
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("pinned_messages_failed", err.code, err.status);
      }
      setPinned([]);
      setPinnedIds([]);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const togglePin = useCallback(
    async (mid: string) => {
      const next = pinnedIds.includes(mid)
        ? pinnedIds.filter((id) => id !== mid)
        : [mid, ...pinnedIds].slice(0, 5);
      try {
        await apiPatch(`/api/groups/${gid}`, { pinnedMessageIds: next });
        await load();
      } catch (err) {
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("toggle_pin_failed", err.code, err.status);
        }
      }
    },
    [gid, pinnedIds, load],
  );

  return { pinned, pinnedIds, loading, togglePin, refresh: load };
}
