"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Cohorts = {
  orgIds: string[];
  roles: string[];
  uids: string[];
};

type FeatureFlag = {
  flagKey: string;
  enabled: boolean;
  rolloutPercentage: number;
  cohorts: Cohorts;
  description: string;
  updatedBy: string | null;
  updatedAt: string | null;
  fullRolloutAt: string | null;
};

type AuditEntry = {
  eventId: string;
  actorUid: string;
  action: string;
  createdAt: string | null;
  payload: Record<string, unknown>;
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

function csv(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AdminFlagDetailPage() {
  const params = useParams();
  const flagKey = String(
    Array.isArray(params?.flagKey) ? params.flagKey[0] : (params?.flagKey ?? ""),
  );
  const { user } = useAuth();
  const [flag, setFlag] = useState<FeatureFlag | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [pct, setPct] = useState(0);
  const [description, setDescription] = useState("");
  const [uids, setUids] = useState("");
  const [orgIds, setOrgIds] = useState("");
  const [roles, setRoles] = useState("");

  const load = useCallback(async () => {
    if (!user || !flagKey) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const [flagRes, auditRes] = await Promise.all([
        authFetch(token, `/api/admin/flags/${flagKey}`),
        authFetch(token, `/api/admin/flags/${flagKey}/audit`),
      ]);
      if (!flagRes.ok) throw new Error(`HTTP ${flagRes.status}`);
      const data: FeatureFlag = await flagRes.json();
      setFlag(data);
      setEnabled(data.enabled);
      setPct(data.rolloutPercentage);
      setDescription(data.description);
      setUids(data.cohorts.uids.join(", "));
      setOrgIds(data.cohorts.orgIds.join(", "));
      setRoles(data.cohorts.roles.join(", "));
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        setAudit(auditData.entries as AuditEntry[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flag");
    } finally {
      setLoading(false);
    }
  }, [user, flagKey]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!user || !flagKey) return;
    setSaving(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/flags`, {
        method: "POST",
        body: JSON.stringify({
          flagKey,
          enabled,
          rolloutPercentage: pct,
          description,
          cohorts: {
            uids: csv(uids),
            orgIds: csv(orgIds),
            roles: csv(roles),
          },
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch {
          // fall through
        }
        throw new Error(msg);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save flag");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!user || !flagKey) return;
    if (!confirm(`Delete flag ${flagKey}? Make sure call sites are gone.`))
      return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/flags/${flagKey}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.assign("/admin/flags");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete flag");
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  if (error && !flag) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/admin/flags" className="text-sm text-blue-700 underline">
          ← Back to flags
        </Link>
      </div>
    );
  }

  if (!flag) return null;

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/flags"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← All flags
        </Link>
        <h1 className="mt-2 font-mono text-2xl">{flag.flagKey}</h1>
        <p className="text-sm text-gray-500">
          last updated{" "}
          {flag.updatedAt
            ? new Date(flag.updatedAt).toLocaleString()
            : "never"}{" "}
          by {flag.updatedBy ?? "—"}
        </p>
      </header>

      <section className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Configuration
        </h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          enabled (master switch — cohorts still win when off only via
          deletion)
        </label>

        <label className="block text-sm">
          <span className="text-xs text-gray-500">rolloutPercentage</span>
          <input
            type="number"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="ml-2 w-20 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="block text-sm">
          <span className="text-xs text-gray-500">description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-gray-500">
            Cohort overrides (comma- or whitespace-separated)
          </legend>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">uids</span>
            <textarea
              value={uids}
              onChange={(e) => setUids(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">orgIds</span>
            <textarea
              value={orgIds}
              onChange={(e) => setOrgIds(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-gray-500">
              roles (admin / leader / member)
            </span>
            <input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </fieldset>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="rounded border border-red-300 bg-white px-3 py-1 text-sm text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </section>

      <section className="space-y-2 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Audit history
        </h2>
        {audit.length === 0 ? (
          <p className="text-xs text-gray-500">No audit rows.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1">When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.eventId} className="border-b border-gray-100">
                  <td className="py-1">
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="font-mono">{entry.actorUid}</td>
                  <td>{entry.action}</td>
                  <td>
                    <pre className="whitespace-pre-wrap text-[10px] text-gray-700">
                      {JSON.stringify(entry.payload, null, 0)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
