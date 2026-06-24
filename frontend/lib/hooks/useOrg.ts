"use client";

import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type Org = {
  orgId: string;
  name: string;
  slug: string;
  description: string;
  audience: "christian" | "general";
  logoUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
  customSubdomain: string | null;
  createdAt: string | null;
  schemaVersion: number;
  llmModerationPolicy: "off" | "advisory" | "aggressive";
  threadSummaryEnabled: boolean;
  semanticSearchEnabled: boolean;
  prayerClusteringEnabled: boolean;
  transparencyReportEnabled: boolean;
};

export type OrgDashboard = {
  orgId: string;
  name: string;
  audience: "christian" | "general";
  groupCount: number;
  memberCount: number;
  archivedGroupCount: number;
  pendingModerationCount: number;
};

export function useOrg(orgId: string | null | undefined): {
  org: Org | null;
  loading: boolean;
  error: ApiError | null;
} {
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!orgId) {
      setOrg(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<Org>(`/api/orgs/${encodeURIComponent(orgId)}`, { signal: ctrl.signal })
      .then((res) => {
        setOrg(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setOrg(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId]);

  return { org, loading, error };
}

export function useOrgDashboard(orgId: string | null | undefined): {
  dashboard: OrgDashboard | null;
  loading: boolean;
  error: ApiError | null;
} {
  const [dashboard, setDashboard] = useState<OrgDashboard | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!orgId) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<OrgDashboard>(`/api/orgs/${encodeURIComponent(orgId)}/dashboard`, {
      signal: ctrl.signal,
    })
      .then((res) => {
        setDashboard(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setDashboard(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId]);

  return { dashboard, loading, error };
}
