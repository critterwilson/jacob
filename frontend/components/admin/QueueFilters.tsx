"use client";

import type { ChangeEvent } from "react";

export type QueueStatus = "pending" | "approved" | "rejected";
export type QueueReason =
  | "any"
  | "harassment"
  | "sexual"
  | "violence"
  | "self-harm"
  | "spam"
  | "other";
export type QueueSort = "createdAt" | "severity";

type Props = {
  status: QueueStatus;
  reason: QueueReason;
  sortBy: QueueSort;
  onStatusChange: (s: QueueStatus) => void;
  onReasonChange: (r: QueueReason) => void;
  onSortChange: (s: QueueSort) => void;
};

const REASONS: QueueReason[] = [
  "any",
  "harassment",
  "sexual",
  "violence",
  "self-harm",
  "spam",
  "other",
];
const STATUSES: QueueStatus[] = ["pending", "approved", "rejected"];

export function QueueFilters({
  status,
  reason,
  sortBy,
  onStatusChange,
  onReasonChange,
  onSortChange,
}: Props) {
  return (
    <div
      role="region"
      aria-label="Moderation queue filters"
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-medium text-cream-muted">Status:</span>
      <div className="flex gap-1" role="group" aria-label="Status filter">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => onStatusChange(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === s
                ? "bg-gold text-ink hover:bg-gold-soft"
                : "bg-ink-overlay text-cream hover:bg-ink-overlay/80"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <span className="ml-2 text-xs font-medium text-cream-muted">Reason:</span>
      <select
        aria-label="Reason filter"
        value={reason}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          onReasonChange(e.target.value as QueueReason)
        }
        className="rounded border border-line bg-ink-raised px-2 py-1 text-xs focus:outline-none focus-visible:shadow-glow-gold"
      >
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <span className="ml-2 text-xs font-medium text-cream-muted">Sort:</span>
      <select
        aria-label="Sort by"
        value={sortBy}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          onSortChange(e.target.value as QueueSort)
        }
        className="rounded border border-line bg-ink-raised px-2 py-1 text-xs focus:outline-none focus-visible:shadow-glow-gold"
      >
        <option value="createdAt">Oldest first</option>
        <option value="severity">Severity</option>
      </select>
    </div>
  );
}
