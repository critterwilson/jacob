"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type AdminGroup = {
  gid: string;
  name: string;
  memberCount: number;
  createdAt: string | null;
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
      const token = await user.getIdToken();
      const url = query
        ? `/api/admin/groups?q=${encodeURIComponent(query)}`
        : "/api/admin/groups";
      const res = await authFetch(token, url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGroups(data.groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
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
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => void searchGroups()}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {groups.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No groups found. Run a search to load groups.</p>
      )}
      <ul className="space-y-3">
        {groups.map((g) => (
          <li
            key={g.gid}
            className="flex items-center justify-between gap-4 rounded border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-800">{g.name}</p>
              <p className="text-xs text-gray-500">
                {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                {g.createdAt && (
                  <> · Created {new Date(g.createdAt).toLocaleDateString()}</>
                )}
              </p>
              <p className="truncate text-xs text-gray-400">{g.gid}</p>
            </div>
            <Link
              href={`/groups/${g.gid}`}
              className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
