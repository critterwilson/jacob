"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type Payload = Record<string, unknown>;

type Report = {
  reportId: string;
  period: string;
  scope: string;
  payload: Payload;
  generatedAt: string | null;
  publishedAt: string | null;
};

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function AdminTransparencyPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ reports: Report[] }>(
        "/api/admin/transparency/drafts",
      );
      setReports(data.reports);
    } catch (e) {
      setError(errorMessage(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (!user) return;
    const period =
      window.prompt("Period to generate (YYYY-Qn). Leave blank for previous quarter.") ?? "";
    setActionState((s) => ({ ...s, generate: "loading" }));
    try {
      const path = period
        ? `/api/admin/transparency/generate?period=${encodeURIComponent(period)}`
        : "/api/admin/transparency/generate";
      await apiPost(path, undefined);
      await load();
      setActionState((s) => ({ ...s, generate: "done" }));
    } catch (e) {
      setActionState((s) => ({ ...s, generate: errorMessage(e, "error") }));
    }
  };

  const publish = async (reportId: string) => {
    if (!user) return;
    const ok = window.confirm(
      `Publish report ${reportId}? Make sure you've reviewed the payload per docs/runbooks/transparency-report.md.`,
    );
    if (!ok) return;
    setActionState((s) => ({ ...s, [reportId]: "loading" }));
    try {
      await apiPost(`/api/admin/transparency/${reportId}/publish`, undefined);
      await load();
    } catch (e) {
      setActionState((s) => ({ ...s, [reportId]: errorMessage(e, "error") }));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Transparency reports</h1>
          <p className="mt-1 text-sm text-cream-muted">
            Review the bucketed counts before publishing. See{" "}
            <code className="rounded bg-ink-overlay px-1 text-xs">
              docs/runbooks/transparency-report.md
            </code>
            .
          </p>
        </div>
        <Button variant="primary" onClick={generate}>
          Generate draft
        </Button>
      </header>

      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-cream-muted">No reports yet.</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.reportId}
              className="rounded border border-line bg-ink-raised p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p>
                    <strong>{r.period}</strong> · scope {r.scope}
                  </p>
                  <p className="mt-1 text-xs text-cream-muted">
                    Generated{" "}
                    {r.generatedAt
                      ? new Date(r.generatedAt).toLocaleString()
                      : "—"}
                    {r.publishedAt &&
                      ` · published ${new Date(r.publishedAt).toLocaleString()}`}
                  </p>
                </div>
                {!r.publishedAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => publish(r.reportId)}
                  >
                    Publish
                  </Button>
                )}
                {actionState[r.reportId] && (
                  <span className="self-center text-xs text-cream-muted">
                    {actionState[r.reportId]}
                  </span>
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gold-soft hover:text-gold hover:underline">
                  View payload
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-ink p-2 text-xs">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
