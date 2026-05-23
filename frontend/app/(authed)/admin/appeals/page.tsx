"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Appeal = {
  appealId: string;
  subject: { type: "message" | "ban" | "group_archive"; ref: string };
  appellantUid: string;
  originalActorUid: string | null;
  submittedAt: string | null;
  decision: "pending" | "upheld" | "reversed";
  decidedBy: string | null;
  decidedAt: string | null;
  overdue: boolean;
};

type Filter = "pending" | "upheld" | "reversed" | "all";

export default function AdminAppealsPage() {
  const { user } = useAuth();
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const path =
        filter === "all"
          ? "/api/admin/appeals"
          : `/api/admin/appeals?decision=${filter}`;
      const data = await apiGet<{ appeals: Appeal[] }>(path);
      setAppeals(data.appeals);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : e instanceof Error
            ? e.message
            : "Failed to load",
      );
    } finally {
      setLoading(false);
    }
  }, [user, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Appeals queue</h1>
        <p className="mt-1 text-sm text-cream-muted">
          Decisions must come from a different admin than the original actor — if
          you took the original action, escalate to another admin per{" "}
          <code className="rounded bg-ink-overlay px-1 text-xs">
            docs/community-guidelines.md
          </code>
          .
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            { value: "pending", label: "Pending" },
            { value: "upheld", label: "Upheld (original stands)" },
            { value: "reversed", label: "Reversed (action undone)" },
            { value: "all", label: "All" },
          ] as { value: Filter; label: string }[]
        ).map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded px-3 py-1 ${
              filter === value
                ? "bg-ink-overlay font-medium text-gold-soft"
                : "border border-line hover:bg-ink-overlay"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : appeals.length === 0 ? (
        <p className="text-sm text-cream-muted">No appeals.</p>
      ) : (
        <ul className="space-y-2">
          {appeals.map((a) => (
            <li
              key={a.appealId}
              className="rounded border border-line bg-ink-raised p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/admin/appeals/${a.appealId}`}
                    className="font-mono text-xs text-gold-soft hover:text-gold hover:underline"
                  >
                    {a.appealId}
                  </Link>
                  <p className="mt-1">
                    <strong>{a.subject.type}</strong> →{" "}
                    <code className="rounded bg-ink-overlay px-1 text-xs">
                      {a.subject.ref}
                    </code>
                  </p>
                  <p className="mt-1 text-xs text-cream-muted">
                    By <span className="font-mono">{a.appellantUid}</span> ·
                    submitted{" "}
                    {a.submittedAt
                      ? new Date(a.submittedAt).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      a.decision === "pending"
                        ? "bg-ink-overlay text-parchment-amber"
                        : a.decision === "reversed"
                          ? "bg-ink-overlay text-sage"
                          : "bg-ink-overlay text-cream"
                    }`}
                  >
                    {a.decision}
                  </span>
                  {a.overdue && (
                    <span className="rounded bg-ink-overlay px-2 py-0.5 text-xs text-terracotta">
                      overdue
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
