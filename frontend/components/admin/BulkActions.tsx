"use client";

import { Button } from "@/components/ui";

type Props = {
  selectedCount: number;
  onBulkApprove: () => void;
  onBulkReject: () => void;
  onBulkRejectAndBan: () => void;
  onClear: () => void;
  disabled?: boolean;
};

export function BulkActions({
  selectedCount,
  onBulkApprove,
  onBulkReject,
  onBulkRejectAndBan,
  onClear,
  disabled,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-0 z-10 mb-4 flex items-center gap-2 rounded border border-line bg-ink-raised px-3 py-2 shadow-sm"
    >
      <span className="text-sm font-medium text-cream">
        {selectedCount} selected
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={onBulkApprove}
        disabled={disabled}
      >
        Approve all
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onBulkReject}
        disabled={disabled}
      >
        Reject all
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={onBulkRejectAndBan}
        disabled={disabled}
      >
        Reject + Ban reporter(s)
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        className="ml-auto"
      >
        Clear
      </Button>
    </div>
  );
}
