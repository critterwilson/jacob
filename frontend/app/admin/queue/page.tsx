"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type QueueItem = {
  itemId: string;
  resourceRef: string;
  reason: string | null;
  status: string;
  uploaderUid: string | null;
  createdAt: string | null;
  extra: Record<string, unknown>;
};

type BanDuration = "24h" | "7d" | "permanent";

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

export default function ModerationQueuePage() {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const loadItems = useCallback(
    async (cursor?: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const url = cursor
          ? `/api/admin/moderation?cursor=${encodeURIComponent(cursor)}`
          : "/api/admin/moderation";
        const res = await authFetch(token, url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load queue");
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const resolveItem = async (itemId: string, resolution: "approve" | "reject") => {
    if (!user) return;
    setActionState((s) => ({ ...s, [itemId]: "loading" }));
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/moderation/${itemId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((i) => i.itemId !== itemId));
      setActionState((s) => ({ ...s, [itemId]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [itemId]: e instanceof Error ? e.message : "error",
      }));
    }
  };

  const rejectAndBan = async (
    itemId: string,
    uploaderUid: string,
    duration: BanDuration,
  ) => {
    if (!user) return;
    setActionState((s) => ({ ...s, [itemId]: "loading" }));
    try {
      const token = await user.getIdToken();
      const [resolveRes, banRes] = await Promise.all([
        authFetch(token, `/api/admin/moderation/${itemId}/resolve`, {
          method: "POST",
          body: JSON.stringify({ resolution: "reject" }),
        }),
        authFetch(token, `/api/admin/users/${uploaderUid}/ban`, {
          method: "POST",
          body: JSON.stringify({ reason: "Content policy violation", duration }),
        }),
      ]);
      if (!resolveRes.ok || !banRes.ok) throw new Error("One or more actions failed");
      setItems((prev) => prev.filter((i) => i.itemId !== itemId));
      setActionState((s) => ({ ...s, [itemId]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [itemId]: e instanceof Error ? e.message : "error",
      }));
    }
  };

  if (loading && items.length === 0) {
    return <p className="text-sm text-gray-500">Loading moderation queue…</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Moderation Queue</h1>
      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {items.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No pending items.</p>
      )}
      <ul className="space-y-4">
        {items.map((item) => (
          <li
            key={item.itemId}
            className="rounded border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-2 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-800">
                  {item.resourceRef}
                </p>
                {item.reason && (
                  <p className="text-xs text-gray-500">Reason: {item.reason}</p>
                )}
                {item.uploaderUid && (
                  <p className="text-xs text-gray-500">
                    Uploader: <code>{item.uploaderUid}</code>
                  </p>
                )}
                {item.createdAt && (
                  <p className="text-xs text-gray-400">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                {item.status}
              </span>
            </div>

            {actionState[item.itemId] === "loading" ? (
              <p className="text-xs text-gray-500">Processing…</p>
            ) : actionState[item.itemId] && actionState[item.itemId] !== "done" ? (
              <p className="text-xs text-red-600">{actionState[item.itemId]}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void resolveItem(item.itemId, "approve")}
                  className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void resolveItem(item.itemId, "reject")}
                  className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                >
                  Reject
                </button>
                {item.uploaderUid && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void rejectAndBan(item.itemId, item.uploaderUid!, "24h")
                      }
                      className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Reject + Ban 24h
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void rejectAndBan(item.itemId, item.uploaderUid!, "7d")
                      }
                      className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Reject + Ban 7d
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void rejectAndBan(item.itemId, item.uploaderUid!, "permanent")
                      }
                      className="rounded border border-red-500 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                    >
                      Reject + Ban Permanent
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button
          type="button"
          onClick={() => void loadItems(nextCursor)}
          disabled={loading}
          className="mt-6 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
