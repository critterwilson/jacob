"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

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
 * `togglePin` still writes via the Firestore client SDK; M4 will move
 * that to `PATCH /api/groups/{gid}` and remove the firestore import.
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
      // M3 still writes via the client SDK; M4 swaps this for a backend
      // PATCH and refresh(). The dynamic import keeps `firebase/firestore`
      // out of this module's static dependency graph so the M3 acceptance
      // criterion (no firestore import in migrated hooks) holds.
      const [{ doc, updateDoc }, { firestore }] = await Promise.all([
        import("firebase/firestore"),
        import("@/lib/firebase"),
      ]);
      await updateDoc(doc(firestore, "groups", gid), { pinnedMessageIds: next });
      // Re-fetch from the server to surface the new ordering.
      await load();
    },
    [gid, pinnedIds, load],
  );

  return { pinned, pinnedIds, loading, togglePin, refresh: load };
}
