"use client";

import { useCallback, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type AdminUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  createdAt: string | null;
  isBanned: boolean;
};

type BanDuration = "24h" | "7d" | "permanent";

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const searchUsers = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const path = query
        ? `/api/admin/users?q=${encodeURIComponent(query)}`
        : "/api/admin/users";
      const data = await apiGet<{ users: AdminUser[] }>(path);
      setUsers(data.users);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : e instanceof Error
            ? e.message
            : "Failed to load users",
      );
    } finally {
      setLoading(false);
    }
  }, [user, query]);

  const banUser = async (uid: string, duration: BanDuration) => {
    if (!user) return;
    setActionState((s) => ({ ...s, [uid]: "loading" }));
    try {
      await apiPost(`/api/admin/users/${uid}/ban`, {
        reason: "Admin ban",
        duration,
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isBanned: true } : u)),
      );
      setActionState((s) => ({ ...s, [uid]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [uid]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : e instanceof Error
              ? e.message
              : "error",
      }));
    }
  };

  const unbanUser = async (uid: string) => {
    if (!user) return;
    setActionState((s) => ({ ...s, [uid]: "loading" }));
    try {
      await apiPost(`/api/admin/users/${uid}/unban`, undefined);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isBanned: false } : u)),
      );
      setActionState((s) => ({ ...s, [uid]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [uid]:
          e instanceof ApiError
            ? e.message || `HTTP ${e.status}`
            : e instanceof Error
              ? e.message
              : "error",
      }));
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Users</h1>
      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchUsers()}
          placeholder="Search by display name…"
          className="flex-1 rounded border border-line bg-ink-raised px-3 py-2 text-sm focus:outline-none focus-visible:shadow-glow-gold"
        />
        <button
          type="button"
          onClick={() => void searchUsers()}
          disabled={loading}
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-soft disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && (
        <p className="mb-4 rounded border border-terracotta/40 bg-ink-raised p-3 text-sm text-terracotta">{error}</p>
      )}
      {users.length === 0 && !loading && (
        <p className="text-sm text-cream-muted">No users found. Run a search to load users.</p>
      )}
      <ul className="space-y-3">
        {users.map((u) => (
          <li
            key={u.uid}
            className="flex items-center justify-between gap-4 rounded border border-line bg-ink-raised p-4 shadow-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-cream">
                {u.displayName ?? "(no name)"}
              </p>
              <p className="truncate text-xs text-cream-muted">{u.email ?? u.uid}</p>
              {u.isBanned && (
                <span className="mt-1 inline-block rounded bg-ink-overlay px-2 py-0.5 text-xs font-medium text-terracotta">
                  Banned
                </span>
              )}
            </div>
            <div className="shrink-0">
              {actionState[u.uid] === "loading" ? (
                <span className="text-xs text-cream-muted">Processing…</span>
              ) : actionState[u.uid] && actionState[u.uid] !== "done" ? (
                <span className="text-xs text-terracotta">{actionState[u.uid]}</span>
              ) : u.isBanned ? (
                <button
                  type="button"
                  onClick={() => void unbanUser(u.uid)}
                  className="rounded bg-ink-overlay px-3 py-1.5 text-xs font-medium text-cream hover:bg-ink-overlay/80"
                >
                  Unban
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void banUser(u.uid, "24h")}
                    className="rounded border border-terracotta/40 px-2 py-1.5 text-xs font-medium text-terracotta hover:bg-ink-overlay"
                  >
                    Ban 24h
                  </button>
                  <button
                    type="button"
                    onClick={() => void banUser(u.uid, "7d")}
                    className="rounded border border-terracotta/40 px-2 py-1.5 text-xs font-medium text-terracotta hover:bg-ink-overlay"
                  >
                    Ban 7d
                  </button>
                  <button
                    type="button"
                    onClick={() => void banUser(u.uid, "permanent")}
                    className="rounded border border-terracotta/60 bg-ink-raised px-2 py-1.5 text-xs font-medium text-terracotta hover:bg-ink-overlay"
                  >
                    Ban ∞
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
