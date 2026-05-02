"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import {
  type QueueReason,
  type QueueSort,
  type QueueStatus,
  QueueFilters,
} from "@/components/admin/QueueFilters";
import { type QueueItem, QueueRow } from "@/components/admin/QueueRow";
import { BulkActions } from "@/components/admin/BulkActions";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PAGE_SIZE = 25;
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

function isQueueStatus(v: string | null): v is QueueStatus {
  return v === "pending" || v === "approved" || v === "rejected";
}
function isQueueReason(v: string | null): v is QueueReason {
  return (
    v === "any" ||
    v === "harassment" ||
    v === "sexual" ||
    v === "violence" ||
    v === "self-harm" ||
    v === "spam" ||
    v === "other"
  );
}
function isQueueSort(v: string | null): v is QueueSort {
  return v === "createdAt" || v === "severity";
}

export default function ModerationQueuePage() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const status: QueueStatus = isQueueStatus(searchParams.get("status"))
    ? (searchParams.get("status") as QueueStatus)
    : "pending";
  const reason: QueueReason = isQueueReason(searchParams.get("reason"))
    ? (searchParams.get("reason") as QueueReason)
    : "any";
  const sortBy: QueueSort = isQueueSort(searchParams.get("sortBy"))
    ? (searchParams.get("sortBy") as QueueSort)
    : "createdAt";

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", status);
    if (reason !== "any") params.set("reason", reason);
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    params.set("limit", String(PAGE_SIZE));
    return params.toString();
  }, [status, reason, sortBy]);

  const updateUrl = useCallback(
    (next: { status?: QueueStatus; reason?: QueueReason; sortBy?: QueueSort }) => {
      const params = new URLSearchParams(searchParams.toString());
      const merged = {
        status: next.status ?? status,
        reason: next.reason ?? reason,
        sortBy: next.sortBy ?? sortBy,
      };
      params.set("status", merged.status);
      if (merged.reason === "any") params.delete("reason");
      else params.set("reason", merged.reason);
      if (merged.sortBy === "createdAt") params.delete("sortBy");
      else params.set("sortBy", merged.sortBy);
      router.replace(`/admin/queue?${params.toString()}`);
    },
    [router, searchParams, status, reason, sortBy],
  );

  const loadItems = useCallback(
    async (cursor?: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const url = cursor
          ? `/api/admin/moderation?${queryString}&cursor=${encodeURIComponent(cursor)}`
          : `/api/admin/moderation?${queryString}`;
        const res = await authFetch(token, url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor ?? null);
        if (!cursor) setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load queue");
      } finally {
        setLoading(false);
      }
    },
    [user, queryString],
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
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
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

  const toggleSelect = (id: string, next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  };

  const bulkResolve = async (resolution: "approve" | "reject") => {
    if (!user) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkPending(true);
    try {
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/moderation/bulk-resolve`, {
        method: "POST",
        body: JSON.stringify({ itemIds: ids, resolution }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { resolved: string[]; skipped: string[] };
      const resolvedSet = new Set(data.resolved);
      setItems((prev) => prev.filter((i) => !resolvedSet.has(i.itemId)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkPending(false);
    }
  };

  const bulkRejectAndBan = async () => {
    if (!user) return;
    const ids = Array.from(selected);
    const targets = items.filter((i) => ids.includes(i.itemId) && i.reportedBy);
    if (targets.length === 0) {
      setError("No selected items have a reporter to ban");
      return;
    }
    setBulkPending(true);
    try {
      const token = await user.getIdToken();
      // Reject all selected; ban only the reporters (T19 spec: reject + ban reporters of false-report clusters).
      const rejectRes = await authFetch(token, `/api/admin/moderation/bulk-resolve`, {
        method: "POST",
        body: JSON.stringify({ itemIds: ids, resolution: "reject" }),
      });
      const banPromises = Array.from(new Set(targets.map((t) => t.reportedBy!))).map(
        (uid) =>
          authFetch(token, `/api/admin/users/${uid}/ban`, {
            method: "POST",
            body: JSON.stringify({
              reason: "False report cluster",
              duration: "24h",
            }),
          }),
      );
      const banResults = await Promise.all(banPromises);
      if (!rejectRes.ok || banResults.some((r) => !r.ok)) {
        throw new Error("One or more actions failed");
      }
      const data = (await rejectRes.json()) as { resolved: string[] };
      const resolvedSet = new Set(data.resolved);
      setItems((prev) => prev.filter((i) => !resolvedSet.has(i.itemId)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkPending(false);
    }
  };

  if (loading && items.length === 0) {
    return <p className="text-sm text-gray-500">Loading moderation queue…</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Moderation Queue</h1>

      <QueueFilters
        status={status}
        reason={reason}
        sortBy={sortBy}
        onStatusChange={(s) => updateUrl({ status: s })}
        onReasonChange={(r) => updateUrl({ reason: r })}
        onSortChange={(s) => updateUrl({ sortBy: s })}
      />

      <BulkActions
        selectedCount={selected.size}
        onBulkApprove={() => void bulkResolve("approve")}
        onBulkReject={() => void bulkResolve("reject")}
        onBulkRejectAndBan={() => void bulkRejectAndBan()}
        onClear={() => setSelected(new Set())}
        disabled={bulkPending}
      />

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No items match the current filters.</p>
      )}

      <ul className="space-y-4">
        {items.map((item) => (
          <QueueRow
            key={item.itemId}
            item={item}
            selected={selected.has(item.itemId)}
            onSelect={toggleSelect}
            onApprove={(id) => void resolveItem(id, "approve")}
            onReject={(id) => void resolveItem(id, "reject")}
            onRejectAndBan={(id, uid, dur) => void rejectAndBan(id, uid, dur)}
            pending={actionState[item.itemId] === "loading"}
          />
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
