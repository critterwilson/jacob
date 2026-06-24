"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type WellbeingStatus = "open" | "in_progress" | "resolved";

type WellbeingItem = {
  itemId: string;
  reporterUid: string | null;
  subjectUid: string | null;
  resourceRef: string;
  note: string | null;
  status: string;
  createdAt: string | null;
  messageId: string | null;
  groupId: string | null;
};

type StatusHistoryEntry = {
  status: string;
  note: string;
  actorUid: string;
  createdAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-parchment-amber/20 text-parchment-amber",
  in_progress: "bg-sage/15 text-sage",
  resolved: "bg-ink-overlay text-cream-muted",
};

const NEXT_STATUS: Record<string, WellbeingStatus | null> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: null,
};

const RESOLUTION_PROMPT =
  "Resolved means no further moderator action is needed — not that the person's struggle is over. Document who you reached out to and what was decided.";

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

function ItemCard({
  item,
  onTransitioned,
}: {
  item: WellbeingItem;
  onTransitioned: (updated: WellbeingItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [transitionNote, setTransitionNote] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const nextStatus = NEXT_STATUS[item.status] ?? null;
  const isResolvingStep = nextStatus === "resolved";

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiGet<{ history: StatusHistoryEntry[] }>(
        `/api/admin/wellbeing/${item.itemId}/audit`,
      );
      setHistory(data.history);
    } catch {
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [item.itemId]);

  const handleTransition = async () => {
    if (!nextStatus || !transitionNote.trim()) return;
    setTransitioning(true);
    setTransitionError(null);
    try {
      const updated = await apiPost<WellbeingItem>(
        `/api/admin/wellbeing/${item.itemId}/status`,
        { status: nextStatus, note: transitionNote.trim() },
      );
      onTransitioned(updated);
      setTransitionNote("");
    } catch (e) {
      setTransitionError(errorMessage(e, "Failed to update status"));
    } finally {
      setTransitioning(false);
    }
  };

  const ts = item.createdAt ? new Date(item.createdAt).toLocaleString() : "—";

  return (
    <div
      className="rounded border border-line bg-ink-raised p-4 space-y-3"
      data-testid="wellbeing-item-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[item.status] ?? "bg-ink-overlay text-cream-muted"}`}
            >
              {STATUS_LABELS[item.status] ?? item.status}
            </span>
            <time className="text-xs text-cream-muted">{ts}</time>
          </div>

          <div className="text-sm text-cream">
            <span className="font-medium">Reporter:</span>{" "}
            <code className="text-xs text-cream-muted">{item.reporterUid ?? "—"}</code>
          </div>

          <div className="text-sm text-cream">
            <span className="font-medium">About:</span>{" "}
            <code className="text-xs text-cream-muted">{item.subjectUid ?? "—"}</code>
            {item.groupId && item.messageId && (
              <>
                {" · "}
                <a
                  href={`/groups/${item.groupId}/chat`}
                  className="text-gold-soft hover:text-gold text-xs"
                  target="_blank"
                  rel="noreferrer"
                >
                  View message context
                </a>
              </>
            )}
          </div>

          {item.note && (
            <p className="text-sm text-cream-muted whitespace-pre-wrap">{item.note}</p>
          )}
        </div>
      </div>

      {/* History toggle */}
      <button
        type="button"
        onClick={() => {
          setExpanded((x) => !x);
          if (!expanded && history === null) void loadHistory();
        }}
        className="text-xs text-gold-soft hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
      >
        {expanded ? "Hide history" : "Show history"}
      </button>

      {expanded && (
        <div className="border-t border-line pt-3 space-y-2">
          {historyLoading && (
            <p className="text-xs text-cream-muted">Loading…</p>
          )}
          {history?.map((entry, i) => (
            <div key={i} className="text-xs text-cream-muted space-y-0.5">
              <span className="font-medium text-cream">{STATUS_LABELS[entry.status] ?? entry.status}</span>
              {" · "}
              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
              {" · "}
              <code>{entry.actorUid}</code>
              {entry.note && entry.note !== "(flag filed)" && (
                <p className="pl-4 text-cream-muted">{entry.note}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Transition form */}
      {nextStatus && (
        <div className="border-t border-line pt-3 space-y-2">
          {isResolvingStep && (
            <p className="text-xs text-cream-muted italic">{RESOLUTION_PROMPT}</p>
          )}
          <label className="block text-xs font-medium text-cream">
            Note for &quot;{STATUS_LABELS[nextStatus]}&quot; transition
            <textarea
              rows={3}
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
              placeholder={
                isResolvingStep
                  ? "Who did you reach out to? What was decided?"
                  : "What are you doing to follow up?"
              }
              className="mt-1 w-full rounded border border-line bg-ink-overlay px-2 py-1 text-sm text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
            />
          </label>

          {transitionError && (
            <p className="text-xs text-terracotta">{transitionError}</p>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleTransition()}
            loading={transitioning}
            disabled={!transitionNote.trim()}
            data-testid={`transition-to-${nextStatus}`}
          >
            {transitioning ? "Saving…" : `Mark as ${STATUS_LABELS[nextStatus]}`}
          </Button>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

export default function WellbeingQueuePage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<WellbeingStatus>("open");
  const [items, setItems] = useState<WellbeingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadItems = useCallback(
    async (cursor?: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          status: statusFilter,
          limit: String(PAGE_SIZE),
        });
        if (cursor) params.set("cursor", cursor);
        const data = await apiGet<{ items: WellbeingItem[]; nextCursor?: string | null }>(
          `/api/admin/wellbeing?${params.toString()}`,
        );
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor ?? null);
      } catch (e) {
        setError(errorMessage(e, "Failed to load queue"));
      } finally {
        setLoading(false);
      }
    },
    [user, statusFilter],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void loadItems();
  }, [loadItems]);

  const handleTransitioned = (updated: WellbeingItem) => {
    setItems((prev) =>
      prev.map((item) => (item.itemId === updated.itemId ? updated : item)),
    );
  };

  const tabs: { value: WellbeingStatus; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "resolved", label: "Resolved" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Wellbeing Concerns</h1>

      <div className="mb-6 flex gap-2">
        {tabs.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            className={`rounded px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:shadow-glow-gold ${
              statusFilter === value
                ? "bg-gold text-ink"
                : "bg-ink-overlay text-cream hover:bg-ink-raised"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-cream-muted">Loading…</p>}
      {error && (
        <p className="rounded bg-terracotta/10 p-3 text-sm text-terracotta">{error}</p>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-cream-muted">No {statusFilter.replace("_", " ")} items.</p>
      )}

      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.itemId}>
            <ItemCard item={item} onTransitioned={handleTransitioned} />
          </li>
        ))}
      </ul>

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void loadItems(nextCursor)}
            loading={loading}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
