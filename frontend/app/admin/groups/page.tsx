"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type AdminGroup = {
  gid: string;
  name: string;
  memberCount: number;
  createdAt: string | null;
};

export default function AdminGroupsPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const path = query
        ? `/api/admin/groups?q=${encodeURIComponent(query)}`
        : "/api/admin/groups";
      const data = await apiGet<{ groups: AdminGroup[] }>(path);
      setGroups(data.groups);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : e instanceof Error
            ? e.message
            : "Failed to load groups",
      );
    } finally {
      setLoading(false);
    }
  }, [user, query]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Groups</h1>
      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchGroups()}
          placeholder="Search by group name…"
          className="flex-1 rounded border border-line bg-ink-raised px-3 py-2 text-sm focus:outline-none focus-visible:shadow-glow-gold"
        />
        <button
          type="button"
          onClick={() => void searchGroups()}
          disabled={loading}
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-soft disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && (
        <p className="mb-4 rounded border border-terracotta/40 bg-ink-raised p-3 text-sm text-terracotta">{error}</p>
      )}
      {groups.length === 0 && !loading && (
        <p className="text-sm text-cream-muted">No groups found. Run a search to load groups.</p>
      )}
      <ul className="space-y-3">
        {groups.map((g) => (
          <li
            key={g.gid}
            className="flex items-center justify-between gap-4 rounded border border-line bg-ink-raised p-4 shadow-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-cream">{g.name}</p>
              <p className="text-xs text-cream-muted">
                {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                {g.createdAt && (
                  <> · Created {new Date(g.createdAt).toLocaleDateString()}</>
                )}
              </p>
              <p className="truncate text-xs text-cream-dim">{g.gid}</p>
            </div>
            <Link
              href={`/groups/${g.gid}`}
              className="shrink-0 rounded border border-line px-3 py-1.5 text-xs hover:bg-ink-overlay"
            >
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
