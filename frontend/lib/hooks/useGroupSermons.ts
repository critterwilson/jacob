"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export type Sermon = {
  sermonId: string;
  title: string;
  preacher: string | null;
  scripture: string | null;
  sermonDate: string | null;
  sourceUrl: string;
  sourceType: "youtube" | "podcast" | "other";
  thumbnail: string | null;
  addedBy: string;
  addedAt: string | null;
  deletedAt: string | null;
};

type ListResponse = {
  sermons: Sermon[];
  preachers: string[];
};

export function useGroupSermons(gid: string | null | undefined): {
  sermons: Sermon[];
  preachers: string[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  addSermon: (input: {
    sourceUrl: string;
    title?: string;
    preacher?: string;
    scripture?: string;
    sermonDate?: string;
  }) => Promise<Sermon | null>;
  deleteSermon: (sermonId: string) => Promise<boolean>;
  patchSermon: (sermonId: string, patch: Partial<Sermon>) => Promise<Sermon | null>;
} {
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [preachers, setPreachers] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(gid));
  const [error, setError] = useState<ApiError | null>(null);
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!gid) {
      setSermons([]);
      setPreachers([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<ListResponse>(`/api/groups/${encodeURIComponent(gid)}/sermons`, {
      signal: ctrl.signal,
    })
      .then((res) => {
        setSermons(res.sermons);
        setPreachers(res.preachers);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setSermons([]);
        setPreachers([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [gid, token]);

  const addSermon = useCallback(
    async (input: {
      sourceUrl: string;
      title?: string;
      preacher?: string;
      scripture?: string;
      sermonDate?: string;
    }): Promise<Sermon | null> => {
      if (!gid) return null;
      try {
        const res = await apiPost<Sermon>(
          `/api/groups/${encodeURIComponent(gid)}/sermons`,
          input,
        );
        reload();
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("sermon_add_failed", err.code, err.status);
        }
        return null;
      }
    },
    [gid, reload],
  );

  const deleteSermon = useCallback(
    async (sermonId: string): Promise<boolean> => {
      if (!gid) return false;
      try {
        await apiDelete(
          `/api/groups/${encodeURIComponent(gid)}/sermons/${encodeURIComponent(sermonId)}`,
        );
        reload();
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("sermon_delete_failed", err.code, err.status);
        }
        return false;
      }
    },
    [gid, reload],
  );

  const patchSermon = useCallback(
    async (sermonId: string, patch: Partial<Sermon>): Promise<Sermon | null> => {
      if (!gid) return null;
      try {
        const res = await apiPatch<Sermon>(
          `/api/groups/${encodeURIComponent(gid)}/sermons/${encodeURIComponent(sermonId)}`,
          patch,
        );
        reload();
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("sermon_patch_failed", err.code, err.status);
        }
        return null;
      }
    },
    [gid, reload],
  );

  return {
    sermons,
    preachers,
    loading,
    error,
    reload,
    addSermon,
    deleteSermon,
    patchSermon,
  };
}
