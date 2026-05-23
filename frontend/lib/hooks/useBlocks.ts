"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";

export type BlockedUserEntry = {
  uid: string;
  displayName: string;
  photoURL: string | null;
};

type BlocksResponse = { blockedUsers: BlockedUserEntry[] };

/**
 * Subscribe to the current user's block set.
 *
 * Block is stronger than mute: blocked-user messages are hidden
 * entirely (not collapsed), the blocker disappears from the blockee's
 * mention autocomplete (T27), and no notifications fire on either side.
 * Block is one-directional — symmetric blocking is a Phase 3 escalation
 * tool. Self-block is rejected by the backend (400).
 *
 * After M2 of the data-layer migration this is a one-shot fetch + manual
 * refetch on mutate. Same return shape as the prior hook.
 */
export function useBlocks() {
  const { user } = useAuth();
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setBlockedSet(new Set());
      setBlockedUsers([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await apiGet<BlocksResponse>("/api/users/me/blocks", {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setBlockedSet(new Set(res.blockedUsers.map((u) => u.uid)));
      setBlockedUsers(res.blockedUsers);
      setLoading(false);
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("blocks_load_failed", err.code, err.status);
      }
      setBlockedSet(new Set());
      setBlockedUsers([]);
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const block = useCallback(
    async (otherUid: string) => {
      if (!user || otherUid === user.uid) return;
      setBlockedSet((prev) => new Set(prev).add(otherUid));
      setBlockedUsers((prev) => [
        ...prev,
        { uid: otherUid, displayName: otherUid, photoURL: null },
      ]);
      try {
        await apiPost(`/api/users/me/blocks/${encodeURIComponent(otherUid)}`, {});
        // Refresh so we get the real displayName/photoURL from the server.
        await refresh();
      } catch (err) {
        setBlockedSet((prev) => {
          const next = new Set(prev);
          next.delete(otherUid);
          return next;
        });
        setBlockedUsers((prev) => prev.filter((u) => u.uid !== otherUid));
        if (err instanceof ApiError) {
          console.warn("block_failed", err.code, err.status);
        }
      }
    },
    [user, refresh],
  );

  const unblock = useCallback(
    async (otherUid: string) => {
      if (!user) return;
      setBlockedSet((prev) => {
        const next = new Set(prev);
        next.delete(otherUid);
        return next;
      });
      setBlockedUsers((prev) => prev.filter((u) => u.uid !== otherUid));
      try {
        await apiDelete(`/api/users/me/blocks/${encodeURIComponent(otherUid)}`);
      } catch (err) {
        setBlockedSet((prev) => new Set(prev).add(otherUid));
        await refresh();
        if (err instanceof ApiError) {
          console.warn("unblock_failed", err.code, err.status);
        }
      }
    },
    [user, refresh],
  );

  const isBlocked = useCallback(
    (uid: string) => blockedSet.has(uid),
    [blockedSet],
  );

  const blockedList = useMemo(() => blockedUsers, [blockedUsers]);

  return {
    blockedSet,
    isBlocked,
    block,
    unblock,
    loading,
    blockedList,
  };
}
