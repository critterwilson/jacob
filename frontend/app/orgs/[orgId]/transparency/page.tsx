"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Report = {
  reportId: string;
  period: string;
  scope: string;
  payload: {
    reports?: { received?: number; byCategory?: Record<string, number> };
    moderationActions?: Record<string, number>;
    appeals?: Record<string, number>;
    ncmec?: Record<string, number>;
    accountActions?: Record<string, number>;
  };
  publishedAt: string | null;
};

export default function OrgTransparencyPage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    user
      .getIdToken()
      .then((token) =>
        fetch(`${API}/api/orgs/${orgId}/transparency/latest`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then(async (res) => {
        if (res.status === 403) throw new Error("Org-admin access required.");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [user, authLoading, orgId]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Org transparency report</h1>
        <p className="mt-1 text-sm text-gray-600">
          Aggregated counts for groups attached to this org.
        </p>
      </header>

      {(loading || authLoading) && (
        <p className="text-sm text-gray-500">Loading…</p>
      )}
      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {!loading && !error && !report && (
        <p className="text-sm text-gray-600">
          No published reports for this org yet.
        </p>
      )}
      {report && (
        <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs">
          {JSON.stringify(report.payload, null, 2)}
        </pre>
      )}
    </main>
  );
}
