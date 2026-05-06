"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Incident = {
  incidentId: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  title: string;
  body: string;
  createdBy: string | null;
  createdAt: string | null;
  displayUntil: string;
  acknowledged: boolean;
};

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function AdminIncidentsPage() {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [severity, setSeverity] = useState<"SEV1" | "SEV2" | "SEV3">("SEV2");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [displayMinutes, setDisplayMinutes] = useState(60);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ incidents: Incident[] }>("/api/admin/incidents");
      setIncidents(data.incidents);
    } catch (e) {
      setError(errorMessage(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const declare = async () => {
    if (!user || !title || !body) return;
    setPending(true);
    setError(null);
    try {
      await apiPost("/api/admin/incidents", {
        severity,
        title,
        body,
        displayMinutes,
      });
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(errorMessage(e, "Failed to declare"));
    } finally {
      setPending(false);
    }
  };

  const clearIncident = async (incidentId: string) => {
    if (!user) return;
    if (!confirm(`Clear incident ${incidentId}?`)) return;
    try {
      await apiPost(`/api/admin/incidents/${incidentId}/clear`, undefined);
      await load();
    } catch (e) {
      setError(errorMessage(e, "Failed to clear"));
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-cream-muted">
          Declare a SEV1/2 banner. The playbook lives at{" "}
          <code className="rounded bg-ink-overlay px-1 text-xs">
            docs/runbooks/incident.md
          </code>
          .
        </p>
      </header>

      <section className="space-y-3 rounded border border-line bg-ink-raised p-4">
        <h2 className="text-eyebrow uppercase tracking-wider text-cream-dim">
          Declare incident
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="text-xs text-cream-muted">Severity</span>
            <select
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as "SEV1" | "SEV2" | "SEV3")
              }
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
            >
              <option value="SEV1">SEV1 — outage</option>
              <option value="SEV2">SEV2 — degraded</option>
              <option value="SEV3">SEV3 — info</option>
            </select>
          </label>
          <label className="col-span-3 block text-sm">
            <span className="text-xs text-cream-muted">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Search returning empty results"
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
            />
          </label>
          <label className="col-span-4 block text-sm">
            <span className="text-xs text-cream-muted">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="One-line description users see, plus expected resolution window"
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-cream-muted">Display minutes</span>
            <input
              type="number"
              min={15}
              max={1440}
              value={displayMinutes}
              onChange={(e) => setDisplayMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
            />
          </label>
          <div className="col-span-3 flex items-end">
            <button
              type="button"
              onClick={declare}
              disabled={!title || !body || pending}
              className="rounded bg-gold px-3 py-1 text-sm text-ink hover:bg-gold-soft disabled:opacity-40"
            >
              {pending ? "Declaring…" : "Declare"}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-terracotta">{error}</p>}
      </section>

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : incidents.length === 0 ? (
        <p className="text-sm text-cream-muted">No incidents (active or recent).</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-eyebrow uppercase tracking-wider text-cream-dim">
              <th className="py-2">Severity</th>
              <th>Title</th>
              <th>Until</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {incidents.map((i) => {
              const expired = new Date(i.displayUntil) < new Date();
              return (
                <tr key={i.incidentId} className="border-b border-line">
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        i.severity === "SEV1"
                          ? "bg-terracotta text-cream"
                          : i.severity === "SEV2"
                            ? "bg-parchment-amber text-ink"
                            : "bg-gold text-ink"
                      }`}
                    >
                      {i.severity}
                    </span>
                  </td>
                  <td>
                    <p className="font-medium">{i.title}</p>
                    <p className="text-xs text-cream-muted">{i.body}</p>
                  </td>
                  <td className="text-xs">
                    {new Date(i.displayUntil).toLocaleString()}
                    {expired && (
                      <span className="ml-1 text-cream-dim">(expired)</span>
                    )}
                  </td>
                  <td className="text-xs text-cream-muted">
                    {i.createdAt
                      ? new Date(i.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    {!expired && (
                      <button
                        type="button"
                        onClick={() => clearIncident(i.incidentId)}
                        className="rounded border border-terracotta/40 px-2 py-0.5 text-xs text-terracotta hover:bg-ink-overlay"
                      >
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
