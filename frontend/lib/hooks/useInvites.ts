"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type Invite = {
  inviteId: string;
  code: string;
  url: string;
  createdAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type InviteListResponse = {
  invites: Array<Omit<Invite, "createdAt"> & { createdAt?: string | null }>;
};

/**
 * Leader's invite list for a group.
 *
 * As of M3 this calls `GET /api/groups/{gid}/invites` once + exposes
 * `refresh()` for callers to invoke after creating or revoking an
 * invite. The previous `onSnapshot` is gone.
 */
export function useInvites(gid: string) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!gid) {
      setInvites([]);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiGet<InviteListResponse>(
        `/api/groups/${gid}/invites`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setInvites(
        res.invites.map((i) => ({
          inviteId: i.inviteId,
          code: i.code,
          url: i.url,
          createdAt: i.createdAt ?? null,
          expiresAt: i.expiresAt ?? null,
          maxUses: i.maxUses,
          useCount: i.useCount,
          lastUsedAt: i.lastUsedAt,
          revokedAt: i.revokedAt,
        })),
      );
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("invites_read_failed", err.code, err.status);
      }
      setInvites([]);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { invites, loading, refresh: load };
}
