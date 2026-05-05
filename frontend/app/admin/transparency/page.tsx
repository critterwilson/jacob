"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Payload = Record<string, unknown>;

type Report = {
  reportId: string;
  period: string;
  scope: string;
  payload: Payload;
  generatedAt: string | null;
  publishedAt: string | null;
};

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
      const token = await user.getIdToken();
      const res = await fetch(`${API}/api/admin/transparency/drafts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReports(data.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
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
      const token = await user.getIdToken();
      const qs = period ? `?period=${encodeURIComponent(period)}` : "";
      const res = await fetch(
        `${API}/api/admin/transparency/generate${qs}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch {
          /* fall through */
        }
        throw new Error(msg);
      }
      await load();
      setActionState((s) => ({ ...s, generate: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        generate: e instanceof Error ? e.message : "error",
      }));
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
      const token = await user.getIdToken();
      const res = await fetch(
        `${API}/api/admin/transparency/${reportId}/publish`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [reportId]: e instanceof Error ? e.message : "error",
      }));
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
        <button
          type="button"
          onClick={generate}
          className="rounded bg-gold px-3 py-1.5 text-sm text-ink hover:bg-gold-soft"
        >
          Generate draft
        </button>
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
                  <button
                    type="button"
                    onClick={() => publish(r.reportId)}
                    className="rounded bg-sage px-3 py-1 text-sm text-ink hover:bg-sage/90"
                  >
                    Publish
                  </button>
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
