"use client";

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
      <button
        type="button"
        onClick={onBulkApprove}
        disabled={disabled}
        className="rounded bg-sage px-3 py-1 text-xs font-medium text-ink hover:bg-sage/90 disabled:opacity-50"
      >
        Approve all
      </button>
      <button
        type="button"
        onClick={onBulkReject}
        disabled={disabled}
        className="rounded bg-ink-overlay px-3 py-1 text-xs font-medium text-terracotta hover:bg-ink-overlay/80 disabled:opacity-50"
      >
        Reject all
      </button>
      <button
        type="button"
        onClick={onBulkRejectAndBan}
        disabled={disabled}
        className="rounded border border-terracotta/60 bg-ink-raised px-3 py-1 text-xs font-medium text-terracotta hover:bg-ink-overlay disabled:opacity-50"
      >
        Reject + Ban reporter(s)
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-cream-muted hover:text-cream"
      >
        Clear
      </button>
    </div>
  );
}
