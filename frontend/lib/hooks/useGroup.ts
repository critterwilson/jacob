"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

/**
 * Per-group detail returned by `GET /api/groups/{gid}`. Mirrors the
 * fields the chat / settings pages used to read off the Firestore doc
 * directly. `inviteCode` is null for public-group non-members; members
 * see the full code.
 */
export type GroupDetail = {
  gid: string;
  name: string;
  description: string;
  isPrivate: boolean;
  joinMode: string | null;
  audience: string | null;
  stickerSet: string;
  avatarUrl: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  pinnedMessageIds: string[];
  memberCount: number;
  leaderCount: number;
  founderUid: string | null;
  createdBy: string | null;
  createdAt: string | null;
  inviteCode: string | null;
  moderationPolicy: string | null;
};

/**
 * Backwards-compatible shape: callers pre-M3 used `group.id` and a few
 * legacy fields. Surface `id` as an alias for `gid` so the chat /
 * settings / analytics pages keep working.
 */
export type Group = GroupDetail & { id: string };

/**
 * Read a group's metadata.
 *
 * As of M3 this calls `GET /api/groups/{gid}` once + exposes
 * `refresh()`. The previous `onSnapshot` is gone; M5 will reintroduce
 * realtime via SSE if needed. For now, callers that mutate the group
 * (rename, archive) call `refresh()` after the write completes.
 */
export function useGroup(gid: string | undefined) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!gid) {
      setGroup(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const detail = await apiGet<GroupDetail>(`/api/groups/${gid}`, {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setGroup({ ...detail, id: detail.gid });
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("group_read_failed", err.code, err.status);
      }
      setGroup(null);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { group, loading, refresh: load };
}
