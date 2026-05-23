"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";

type MutedGroupEntry = { groupId: string; mutedAt: string };
type MutedGroupsResponse = { mutedGroups: MutedGroupEntry[] };

/**
 * Per-group push silencing — sister to `useMutes` (which mutes specific
 * users). Toggling here only suppresses the generic `group_message`
 * push notification for one group; @mentions and replies-to-your-own
 * messages still come through.
 *
 * Optimistic add/remove with rollback on failure (matches `useMutes`).
 */
export function useMutedGroups() {
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
      const res = await apiGet<MutedGroupsResponse>(
        "/api/users/me/muted-groups",
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setMutedSet(new Set(res.mutedGroups.map((g) => g.groupId)));
      setLoading(false);
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("muted_groups_load_failed", err.code, err.status);
      }
      setMutedSet(new Set());
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const muteGroup = useCallback(
    async (groupId: string) => {
      if (!user || !groupId) return;
      setMutedSet((prev) => new Set(prev).add(groupId));
      try {
        await apiPost(
          `/api/users/me/muted-groups/${encodeURIComponent(groupId)}`,
          {},
        );
      } catch (err) {
        setMutedSet((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        if (err instanceof ApiError) {
          console.warn("group_mute_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const unmuteGroup = useCallback(
    async (groupId: string) => {
      if (!user || !groupId) return;
      setMutedSet((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      try {
        await apiDelete(
          `/api/users/me/muted-groups/${encodeURIComponent(groupId)}`,
        );
      } catch (err) {
        setMutedSet((prev) => new Set(prev).add(groupId));
        if (err instanceof ApiError) {
          console.warn("group_unmute_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const isGroupMuted = useCallback(
    (groupId: string) => mutedSet.has(groupId),
    [mutedSet],
  );

  return { mutedSet, isGroupMuted, muteGroup, unmuteGroup, loading };
}
