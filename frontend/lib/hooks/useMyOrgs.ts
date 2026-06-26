"use client";

import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type OrgSummary = {
  orgId: string;
  name: string;
  slug: string;
  audience: "christian" | "general";
  logoUrl: string | null;
  role: "admin" | "member";
};

type MyOrgsResponse = { orgs: OrgSummary[] };

export function useMyOrgs(): {
  orgs: OrgSummary[];
  loading: boolean;
  error: ApiError | null;
} {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const promise = apiGet<MyOrgsResponse>("/api/users/me/orgs", {
      signal: ctrl.signal,
    });
    // Guard: apiGet is mocked as a plain vi.fn() in some AppShell tests,
    // in which case it returns undefined rather than a Promise. Mirrors
    // the same defensive pattern used in useRoleClaims.
    if (!promise || typeof promise.then !== "function") {
      setLoading(false);
      return () => ctrl.abort();
    }
    promise
      .then((res) => {
        setOrgs(res.orgs);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  return { orgs, loading, error };
}
