"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type OrgGroupSummary = {
  gid: string;
  name: string;
  memberCount: number;
  archivedAt: string | null;
  createdAt: string | null;
};

type Response = { groups: OrgGroupSummary[] };

export function useOrgGroups(orgId: string | null | undefined): {
  groups: OrgGroupSummary[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const [groups, setGroups] = useState<OrgGroupSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<ApiError | null>(null);
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!orgId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<Response>(`/api/orgs/${encodeURIComponent(orgId)}/groups`, {
      signal: ctrl.signal,
    })
      .then((res) => {
        setGroups(res.groups);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setGroups([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId, token]);

  return { groups, loading, error, reload };
}
