"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
      const token = await user.getIdToken();
      const qs = filter === "all" ? "" : `?decision=${filter}`;
      const res = await fetch(`${API}/api/admin/appeals${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAppeals(data.appeals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
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
        <p className="mt-1 text-sm text-gray-600">
          Decisions must come from a different admin than the original actor — if
          you took the original action, escalate to another admin per{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">
            docs/community-guidelines.md
          </code>
          .
        </p>
      </header>

      <div className="flex gap-2 text-sm">
        {(["pending", "upheld", "reversed", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1 ${
              filter === f
                ? "bg-blue-100 font-medium text-blue-700"
                : "border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : appeals.length === 0 ? (
        <p className="text-sm text-gray-500">No appeals.</p>
      ) : (
        <ul className="space-y-2">
          {appeals.map((a) => (
            <li
              key={a.appealId}
              className="rounded border border-gray-200 bg-white p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/admin/appeals/${a.appealId}`}
                    className="font-mono text-xs text-blue-600 hover:underline"
                  >
                    {a.appealId}
                  </Link>
                  <p className="mt-1">
                    <strong>{a.subject.type}</strong> →{" "}
                    <code className="rounded bg-gray-100 px-1 text-xs">
                      {a.subject.ref}
                    </code>
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
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
                        ? "bg-amber-100 text-amber-800"
                        : a.decision === "reversed"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {a.decision}
                  </span>
                  {a.overdue && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
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
