"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

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

function isCandidateForCleanup(flag: FeatureFlag): boolean {
  if (flag.rolloutPercentage < 100) return false;
  if (!flag.fullRolloutAt) return false;
  const at = Date.parse(flag.fullRolloutAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at >= CLEANUP_THRESHOLD_MS;
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
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
      const data = await apiGet<{ flags: FeatureFlag[] }>("/api/admin/flags");
      setFlags(data.flags);
    } catch (e) {
      setError(errorMessage(e, "Failed to load flags"));
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
      const updated = await apiPost<FeatureFlag>(
        `/api/admin/flags/${flagKey}/percentage`,
        { rolloutPercentage: pct },
      );
      setFlags((prev) =>
        prev.map((f) => (f.flagKey === flagKey ? updated : f)),
      );
      setActionState((s) => ({ ...s, [flagKey]: "done" }));
    } catch (e) {
      setActionState((s) => ({ ...s, [flagKey]: errorMessage(e, "error") }));
    }
  };

  const createFlag = async () => {
    if (!user || !newKey) return;
    setCreatePending(true);
    setCreateError(null);
    try {
      await apiPost("/api/admin/flags", {
        flagKey: newKey,
        enabled: true,
        rolloutPercentage: 0,
        cohorts: { orgIds: [], roles: [], uids: [] },
        description: newDescription,
      });
      setNewKey("");
      setNewDescription("");
      await loadFlags();
    } catch (e) {
      setCreateError(errorMessage(e, "Failed to create flag"));
    } finally {
      setCreatePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feature flags</h1>
          <p className="mt-1 text-sm text-cream-muted">
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
                ? "border-gold-soft/60 bg-ink-raised text-gold-soft"
                : "border-line text-cream"
            }`}
          >
            All ({flags.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("candidate-cleanup")}
            className={`rounded border px-3 py-1 ${
              filter === "candidate-cleanup"
                ? "border-parchment-amber/60 bg-ink-raised text-parchment-amber"
                : "border-line text-cream"
            }`}
          >
            Candidate for cleanup ({cleanupCount})
          </button>
        </div>
      </header>

      {cleanupCount > 0 && filter === "all" && (
        <div className="rounded border border-parchment-amber/40 bg-ink-raised px-4 py-2 text-sm text-parchment-amber">
          {cleanupCount} flag{cleanupCount === 1 ? " is" : "s are"} at 100% for
          30+ days. Remove the call sites and delete the flag.
        </div>
      )}

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="mb-2 text-eyebrow uppercase tracking-wider text-cream-muted">
          Create flag
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-cream-muted">flagKey</label>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="my_feature_enabled"
              className="w-full rounded border border-line bg-ink-raised px-2 py-1 text-sm focus:outline-none focus-visible:shadow-glow-gold"
            />
          </div>
          <div className="flex-[2]">
            <label className="block text-xs text-cream-muted">description</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this flag gates"
              className="w-full rounded border border-line bg-ink-raised px-2 py-1 text-sm focus:outline-none focus-visible:shadow-glow-gold"
            />
          </div>
          <Button
            variant="primary"
            onClick={createFlag}
            loading={createPending}
            disabled={!newKey}
          >
            {createPending ? "Creating…" : "Create at 0%"}
          </Button>
        </div>
        {createError && (
          <p className="mt-2 text-xs text-terracotta">{createError}</p>
        )}
      </section>

      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-cream-muted">No flags.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-eyebrow uppercase tracking-wider text-cream-muted">
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
                  className="border-b border-line"
                  data-cleanup-candidate={isCandidateForCleanup(flag)}
                >
                  <td className="py-2 font-mono text-xs">
                    <Link
                      href={`/admin/flags/${flag.flagKey}`}
                      className="text-gold-soft hover:text-gold hover:underline"
                    >
                      {flag.flagKey}
                    </Link>
                    {isCandidateForCleanup(flag) && (
                      <span className="ml-2 rounded bg-ink-overlay px-1 py-0.5 text-[10px] uppercase text-parchment-amber">
                        cleanup
                      </span>
                    )}
                    {flag.description && (
                      <p className="text-xs text-cream-muted">{flag.description}</p>
                    )}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs ${
                        flag.enabled
                          ? "bg-ink-overlay text-sage"
                          : "bg-ink-overlay text-cream-muted"
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
                      className="rounded border border-line bg-ink-raised px-1 py-0.5 text-xs focus:outline-none focus-visible:shadow-glow-gold"
                    >
                      {[0, 5, 10, 25, 50, 75, 90, 100].map((pct) => (
                        <option key={pct} value={pct}>
                          {pct}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs text-cream-muted">
                    {cohortBadge > 0 ? `${cohortBadge} entries` : "—"}
                  </td>
                  <td className="text-xs text-cream-muted">
                    {flag.updatedAt
                      ? new Date(flag.updatedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-right">
                    {flagState && flagState !== "done" && (
                      <span className="text-xs text-cream-muted">{flagState}</span>
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
