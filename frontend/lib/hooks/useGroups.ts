"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";

/**
 * Group summary as returned by `GET /api/users/me/groups`.
 *
 * After M3 of the data-layer migration the frontend no longer issues a
 * collection-group query — the backend joins each membership against
 * its parent group server-side and returns this slimmer projection.
 * Callers that previously read e.g. `inviteCode` off the full Firestore
 * doc must instead call `useGroup(gid)` (per-group endpoint) which
 * returns the full GroupDetail (and redacts `inviteCode` for public
 * non-members).
 */
export type Group = {
  id: string;
  gid: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  isPrivate: boolean;
  archivedAt: string | null;
  role: "member" | "leader";
  joinedAt: string | null;
  memberCount: number;
  lastMessageAt: string | null;
};

type MyGroupsResponse = {
  groups: Array<Omit<Group, "id">>;
};

/**
 * Returns every group the user belongs to.
 *
 * As of M3 this calls `GET /api/users/me/groups`; the previous
 * collection-group `onSnapshot` is gone. The cookie-bootstrap flow in
 * `useUser` already establishes session at session start, so the hook
 * does a one-shot fetch and exposes `refresh()` for callers to invoke
 * after a write (group create, group leave, etc.).
 */
export function useGroups(uid: string | undefined) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const etagRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setGroups([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const result = await apiGetConditional<MyGroupsResponse>(
        "/api/users/me/groups",
        etagRef.current,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (result.etag) etagRef.current = result.etag;
      if (result.status === 304 || result.data === null) return;
      setGroups(result.data.groups.map((g) => ({ ...g, id: g.gid })));
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("my_groups_failed", err.code, err.status);
      }
      setGroups([]);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { groups, loading, refresh: load };
}
