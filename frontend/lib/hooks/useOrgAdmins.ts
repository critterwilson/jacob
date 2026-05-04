"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type OrgAdminEntry = {
  uid: string;
  addedBy: string | null;
  addedAt: string | null;
};

type Response = { admins: OrgAdminEntry[] };

export function useOrgAdmins(orgId: string | null | undefined): {
  admins: OrgAdminEntry[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
} {
  const [admins, setAdmins] = useState<OrgAdminEntry[]>([]);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<ApiError | null>(null);
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!orgId) {
      setAdmins([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<Response>(`/api/orgs/${encodeURIComponent(orgId)}/admins`, {
      signal: ctrl.signal,
    })
      .then((res) => {
        setAdmins(res.admins);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setAdmins([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId, token]);

  return { admins, loading, error, reload };
}
