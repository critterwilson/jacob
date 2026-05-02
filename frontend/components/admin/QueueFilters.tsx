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
      <span className="text-xs font-medium text-gray-600">Status:</span>
      <div className="flex gap-1" role="group" aria-label="Status filter">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => onStatusChange(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <span className="ml-2 text-xs font-medium text-gray-600">Reason:</span>
      <select
        aria-label="Reason filter"
        value={reason}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          onReasonChange(e.target.value as QueueReason)
        }
        className="rounded border border-gray-300 px-2 py-1 text-xs"
      >
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <span className="ml-2 text-xs font-medium text-gray-600">Sort:</span>
      <select
        aria-label="Sort by"
        value={sortBy}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          onSortChange(e.target.value as QueueSort)
        }
        className="rounded border border-gray-300 px-2 py-1 text-xs"
      >
        <option value="createdAt">Oldest first</option>
        <option value="severity">Severity</option>
      </select>
    </div>
  );
}
