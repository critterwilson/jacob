"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Payload = {
  reports?: { received?: number; byCategory?: Record<string, number> };
  moderationActions?: Record<string, number>;
  appeals?: Record<string, number>;
  ncmec?: Record<string, number>;
  accountActions?: Record<string, number>;
};

type Report = {
  reportId: string;
  period: string;
  scope: string;
  payload: Payload;
  generatedAt: string | null;
  publishedAt: string | null;
};

function CountTable({ title, data }: { title: string; data?: Record<string, number> }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return null;
  return (
    <section className="rounded border border-line bg-ink-raised p-4">
      <h2 className="mb-2 text-sm font-semibold text-cream">{title}</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1">
            <dt className="text-cream">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function TransparencyPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/transparency/latest`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Transparency report</h1>
        <p className="mt-2 text-sm text-cream-muted">
          Aggregated counts of moderation actions, reports received, appeals,
          and NCMEC submissions. No identifying details. Published quarterly.
        </p>
      </header>

      {loading && <p className="text-sm text-cream-muted">Loading…</p>}
      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}
      {!loading && !error && !report && (
        <p className="text-sm text-cream-muted">
          No reports have been published yet. Check back after the next
          quarter ends.
        </p>
      )}

      {report && (
        <div className="space-y-4">
          <div className="rounded bg-ink-raised px-4 py-3 text-sm text-cream">
            <p>
              <strong>Period:</strong> {report.period}
            </p>
            {report.publishedAt && (
              <p>
                <strong>Published:</strong>{" "}
                {new Date(report.publishedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <CountTable
            title="Reports received"
            data={{
              total: report.payload.reports?.received ?? 0,
              ...(report.payload.reports?.byCategory ?? {}),
            }}
          />
          <CountTable
            title="Moderation actions"
            data={report.payload.moderationActions}
          />
          <CountTable title="Appeals" data={report.payload.appeals} />
          <CountTable
            title="NCMEC submissions"
            data={report.payload.ncmec}
          />
          <CountTable
            title="Account actions"
            data={report.payload.accountActions}
          />
        </div>
      )}
    </main>
  );
}
