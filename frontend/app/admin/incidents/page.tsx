"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

async function authFetch(token: string, path: string, init?: RequestInit) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
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
      const token = await user.getIdToken();
      const res = await authFetch(token, "/api/admin/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
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
      const token = await user.getIdToken();
      const res = await authFetch(token, "/api/admin/incidents", {
        method: "POST",
        body: JSON.stringify({
          severity,
          title,
          body,
          displayMinutes,
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          if (err?.error?.message) msg = err.error.message;
        } catch {
          // fall through
        }
        throw new Error(msg);
      }
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to declare");
    } finally {
      setPending(false);
    }
  };

  const clearIncident = async (incidentId: string) => {
    if (!user) return;
    if (!confirm(`Clear incident ${incidentId}?`)) return;
    try {
      const token = await user.getIdToken();
      const res = await authFetch(
        token,
        `/api/admin/incidents/${incidentId}/clear`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-gray-500">
          Declare a SEV1/2 banner. The playbook lives at{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">
            docs/runbooks/incident.md
          </code>
          .
        </p>
      </header>

      <section className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Declare incident
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="text-xs text-gray-500">Severity</span>
            <select
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as "SEV1" | "SEV2" | "SEV3")
              }
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            >
              <option value="SEV1">SEV1 — outage</option>
              <option value="SEV2">SEV2 — degraded</option>
              <option value="SEV3">SEV3 — info</option>
            </select>
          </label>
          <label className="col-span-3 block text-sm">
            <span className="text-xs text-gray-500">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Search returning empty results"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="col-span-4 block text-sm">
            <span className="text-xs text-gray-500">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="One-line description users see, plus expected resolution window"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">Display minutes</span>
            <input
              type="number"
              min={15}
              max={1440}
              value={displayMinutes}
              onChange={(e) => setDisplayMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <div className="col-span-3 flex items-end">
            <button
              type="button"
              onClick={declare}
              disabled={!title || !body || pending}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              {pending ? "Declaring…" : "Declare"}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : incidents.length === 0 ? (
        <p className="text-sm text-gray-500">No incidents (active or recent).</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
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
                <tr key={i.incidentId} className="border-b border-gray-100">
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs text-white ${
                        i.severity === "SEV1"
                          ? "bg-red-600"
                          : i.severity === "SEV2"
                            ? "bg-amber-500"
                            : "bg-blue-600"
                      }`}
                    >
                      {i.severity}
                    </span>
                  </td>
                  <td>
                    <p className="font-medium">{i.title}</p>
                    <p className="text-xs text-gray-500">{i.body}</p>
                  </td>
                  <td className="text-xs">
                    {new Date(i.displayUntil).toLocaleString()}
                    {expired && (
                      <span className="ml-1 text-gray-400">(expired)</span>
                    )}
                  </td>
                  <td className="text-xs text-gray-500">
                    {i.createdAt
                      ? new Date(i.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    {!expired && (
                      <button
                        type="button"
                        onClick={() => clearIncident(i.incidentId)}
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
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
