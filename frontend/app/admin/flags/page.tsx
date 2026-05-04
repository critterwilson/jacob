"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

type FilterMode = "all" | "candidate-cleanup";

const CLEANUP_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

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

function isCandidateForCleanup(flag: FeatureFlag): boolean {
  if (flag.rolloutPercentage < 100) return false;
  if (!flag.fullRolloutAt) return false;
  const at = Date.parse(flag.fullRolloutAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at >= CLEANUP_THRESHOLD_MS;
}

export default function AdminFlagsPage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, "/api/admin/flags");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlags(data.flags as FeatureFlag[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const visible = useMemo(() => {
    if (filter === "candidate-cleanup") {
      return flags.filter(isCandidateForCleanup);
    }
    return flags;
  }, [flags, filter]);

  const cleanupCount = useMemo(
    () => flags.filter(isCandidateForCleanup).length,
    [flags],
  );

  const setPercentage = async (flagKey: string, pct: number) => {
    if (!user) return;
    setActionState((s) => ({ ...s, [flagKey]: "loading" }));
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/flags/${flagKey}/percentage`, {
        method: "POST",
        body: JSON.stringify({ rolloutPercentage: pct }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: FeatureFlag = await res.json();
      setFlags((prev) =>
        prev.map((f) => (f.flagKey === flagKey ? updated : f)),
      );
      setActionState((s) => ({ ...s, [flagKey]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [flagKey]: e instanceof Error ? e.message : "error",
      }));
    }
  };

  const createFlag = async () => {
    if (!user || !newKey) return;
    setCreatePending(true);
    setCreateError(null);
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, "/api/admin/flags", {
        method: "POST",
        body: JSON.stringify({
          flagKey: newKey,
          enabled: true,
          rolloutPercentage: 0,
          cohorts: { orgIds: [], roles: [], uids: [] },
          description: newDescription,
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch {
          // fall through with HTTP-status fallback
        }
        throw new Error(msg);
      }
      setNewKey("");
      setNewDescription("");
      await loadFlags();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create flag");
    } finally {
      setCreatePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feature flags</h1>
          <p className="mt-1 text-sm text-gray-500">
            Read{" "}
            <Link
              href="/admin/flags-runbook"
              className="underline"
              prefetch={false}
            >
              the runbook
            </Link>{" "}
            before flipping production rollouts.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded border px-3 py-1 ${
              filter === "all"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-300 text-gray-700"
            }`}
          >
            All ({flags.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("candidate-cleanup")}
            className={`rounded border px-3 py-1 ${
              filter === "candidate-cleanup"
                ? "border-amber-500 bg-amber-50 text-amber-700"
                : "border-gray-300 text-gray-700"
            }`}
          >
            Candidate for cleanup ({cleanupCount})
          </button>
        </div>
      </header>

      {cleanupCount > 0 && filter === "all" && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {cleanupCount} flag{cleanupCount === 1 ? " is" : "s are"} at 100% for
          30+ days. Remove the call sites and delete the flag.
        </div>
      )}

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Create flag
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-500">flagKey</label>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="my_feature_enabled"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-[2]">
            <label className="block text-xs text-gray-500">description</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this flag gates"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={createFlag}
            disabled={!newKey || createPending}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {createPending ? "Creating…" : "Create at 0%"}
          </button>
        </div>
        {createError && (
          <p className="mt-2 text-xs text-red-600">{createError}</p>
        )}
      </section>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500">No flags.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2">Key</th>
              <th>Enabled</th>
              <th>%</th>
              <th>Cohorts</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((flag) => {
              const cohortBadge =
                flag.cohorts.uids.length +
                flag.cohorts.orgIds.length +
                flag.cohorts.roles.length;
              const flagState = actionState[flag.flagKey];
              return (
                <tr
                  key={flag.flagKey}
                  className="border-b border-gray-100"
                  data-cleanup-candidate={isCandidateForCleanup(flag)}
                >
                  <td className="py-2 font-mono text-xs">
                    <Link
                      href={`/admin/flags/${flag.flagKey}`}
                      className="text-blue-700 hover:underline"
                    >
                      {flag.flagKey}
                    </Link>
                    {isCandidateForCleanup(flag) && (
                      <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase text-amber-700">
                        cleanup
                      </span>
                    )}
                    {flag.description && (
                      <p className="text-xs text-gray-500">{flag.description}</p>
                    )}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs ${
                        flag.enabled
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {flag.enabled ? "on" : "off"}
                    </span>
                  </td>
                  <td className="py-2">
                    <select
                      value={flag.rolloutPercentage}
                      onChange={(e) =>
                        setPercentage(flag.flagKey, Number(e.target.value))
                      }
                      className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                    >
                      {[0, 5, 10, 25, 50, 75, 90, 100].map((pct) => (
                        <option key={pct} value={pct}>
                          {pct}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs text-gray-500">
                    {cohortBadge > 0 ? `${cohortBadge} entries` : "—"}
                  </td>
                  <td className="text-xs text-gray-500">
                    {flag.updatedAt
                      ? new Date(flag.updatedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    {flagState && flagState !== "done" && (
                      <span className="text-xs text-gray-500">{flagState}</span>
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
