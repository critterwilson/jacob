"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type Member = {
  uid: string;
  role: "member" | "leader";
  joinedAt: string | null;
  displayName: string;
  photoURL: string | null;
};

type MembersListResponse = {
  members: Member[];
  nextCursor: string | null;
};

/**
 * Members of a group.
 *
 * As of M3 this calls `GET /api/groups/{gid}/members`. The backend
 * joins each membership against `users/{uid}` server-side so the
 * client gets `displayName` + `photoURL` in one round-trip. Mention
 * pickers and the members page consume this hook.
 */
export function useMembers(gid: string) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!gid) {
      setMembers([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiGet<MembersListResponse>(`/api/groups/${gid}/members`, {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setMembers(res.members);
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("members_read_failed", err.code, err.status);
      }
      setMembers([]);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { members, loading, refresh: load };
}
