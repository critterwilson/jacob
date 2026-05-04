"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type MyMembership = {
  gid: string;
  uid: string;
  role: "member" | "leader";
  joinedAt: string | null;
};

/**
 * Read the caller's own membership row for a group via
 * `GET /api/groups/{gid}/me`.
 *
 * Replaces the per-page `onSnapshot(groups/{gid}/members/{uid})` reads
 * that the chat / settings / analytics / settings/invites pages used
 * to do inline. `loading` returns true on first mount; once the
 * request resolves, `membership` is the row (or `null` if the caller
 * is not a member, surfaced as a 403 from the backend).
 */
export function useGroupMembership(uid: string | undefined, gid: string | undefined) {
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(uid && gid));
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!uid || !gid) {
      setMembership(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiGet<MyMembership>(`/api/groups/${gid}/me`, {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setMembership(res);
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError) {
        // 403 = not a member; treat as null.
        if (err.code !== "aborted" && err.status !== 403) {
          console.warn("group_membership_read_failed", err.code, err.status);
        }
      }
      setMembership(null);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [uid, gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return {
    membership,
    role: membership?.role ?? null,
    isLeader: membership?.role === "leader",
    loading,
    refresh: load,
  };
}
