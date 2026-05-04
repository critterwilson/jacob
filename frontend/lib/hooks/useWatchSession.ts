"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";

export type WatchSession = {
  sessionId: string;
  videoId: string;
  sourceUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  leaderUid: string;
  createdBy: string;
  createdAt: string | null;
  endedAt: string | null;
  attendees: string[];
  durationSec: number | null;
};

export function useActiveWatchSessions(gid: string | null | undefined): {
  sessions: WatchSession[];
  loading: boolean;
  reload: () => void;
} {
  const [sessions, setSessions] = useState<WatchSession[]>([]);
  const [loading, setLoading] = useState(Boolean(gid));
  const [token, setToken] = useState(0);
  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!gid) {
      setSessions([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<{ sessions: WatchSession[] }>(
      `/api/groups/${encodeURIComponent(gid)}/watch`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setSessions(res.sessions);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setSessions([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [gid, token]);

  return { sessions, loading, reload };
}

export function useWatchSession(
  gid: string | null | undefined,
  sessionId: string | null | undefined,
): {
  session: WatchSession | null;
  loading: boolean;
  reload: () => void;
  join: () => Promise<boolean>;
  end: () => Promise<boolean>;
  transfer: (newLeaderUid: string) => Promise<boolean>;
} {
  const [session, setSession] = useState<WatchSession | null>(null);
  const [loading, setLoading] = useState(Boolean(gid && sessionId));
  const [token, setToken] = useState(0);
  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!gid || !sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<WatchSession>(
      `/api/groups/${encodeURIComponent(gid)}/watch/${encodeURIComponent(sessionId)}`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setSession(res);
        setLoading(false);
      })
      .catch(() => {
        setSession(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [gid, sessionId, token]);

  const join = useCallback(async (): Promise<boolean> => {
    if (!gid || !sessionId) return false;
    try {
      await apiPost(
        `/api/groups/${encodeURIComponent(gid)}/watch/${encodeURIComponent(sessionId)}/join`,
        {},
      );
      reload();
      return true;
    } catch {
      return false;
    }
  }, [gid, sessionId, reload]);

  const end = useCallback(async (): Promise<boolean> => {
    if (!gid || !sessionId) return false;
    try {
      await apiPost(
        `/api/groups/${encodeURIComponent(gid)}/watch/${encodeURIComponent(sessionId)}/end`,
        {},
      );
      reload();
      return true;
    } catch {
      return false;
    }
  }, [gid, sessionId, reload]);

  const transfer = useCallback(
    async (newLeaderUid: string): Promise<boolean> => {
      if (!gid || !sessionId) return false;
      try {
        await apiPost(
          `/api/groups/${encodeURIComponent(gid)}/watch/${encodeURIComponent(sessionId)}/transfer`,
          { newLeaderUid },
        );
        reload();
        return true;
      } catch {
        return false;
      }
    },
    [gid, sessionId, reload],
  );

  return { session, loading, reload, join, end, transfer };
}

export async function startWatchSession(
  gid: string,
  videoUrl: string,
): Promise<{
  sessionId: string;
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
} | null> {
  try {
    return await apiPost(
      `/api/groups/${encodeURIComponent(gid)}/watch/start`,
      { videoUrl },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn("watch_start_failed", err.code, err.status);
    }
    return null;
  }
}
