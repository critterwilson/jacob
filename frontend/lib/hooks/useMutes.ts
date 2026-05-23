"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";

type MutedUserEntry = { uid: string; displayName: string; photoURL: string | null };
type MutesResponse = { mutedUsers: MutedUserEntry[] };

/**
 * Subscribe to the current user's mute set.
 *
 * Mute is one-directional: A muting B hides B's messages from A's view,
 * but B is unaffected. Self-mute is rejected by the backend (returns 400).
 *
 * After M2 of the data-layer migration this is a one-shot fetch + manual
 * refetch on mutate, instead of an `onSnapshot` listener. The shape
 * matches the prior hook so callers don't change.
 */
export function useMutes() {
  const { user } = useAuth();
  const [mutedSet, setMutedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setMutedSet(new Set());
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await apiGet<MutesResponse>("/api/users/me/mutes", {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setMutedSet(new Set(res.mutedUsers.map((u) => u.uid)));
      setLoading(false);
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("mutes_load_failed", err.code, err.status);
      }
      setMutedSet(new Set());
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const mute = useCallback(
    async (otherUid: string) => {
      if (!user || otherUid === user.uid) return;
      // Optimistic add — the rule of thumb is "the UI should reflect the
      // user's intent immediately; the backend can correct it if needed."
      setMutedSet((prev) => new Set(prev).add(otherUid));
      try {
        await apiPost(`/api/users/me/mutes/${encodeURIComponent(otherUid)}`, {});
      } catch (err) {
        // Roll back on failure.
        setMutedSet((prev) => {
          const next = new Set(prev);
          next.delete(otherUid);
          return next;
        });
        if (err instanceof ApiError) {
          console.warn("mute_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const unmute = useCallback(
    async (otherUid: string) => {
      if (!user) return;
      setMutedSet((prev) => {
        const next = new Set(prev);
        next.delete(otherUid);
        return next;
      });
      try {
        await apiDelete(`/api/users/me/mutes/${encodeURIComponent(otherUid)}`);
      } catch (err) {
        // Restore the optimistically-removed uid.
        setMutedSet((prev) => new Set(prev).add(otherUid));
        if (err instanceof ApiError) {
          console.warn("unmute_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const isMuted = useCallback((uid: string) => mutedSet.has(uid), [mutedSet]);

  return { mutedSet, isMuted, mute, unmute, loading };
}
