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
      className="sticky top-0 z-10 mb-4 flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 shadow-sm"
    >
      <span className="text-sm font-medium text-gray-700">
        {selectedCount} selected
      </span>
      <button
        type="button"
        onClick={onBulkApprove}
        disabled={disabled}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        Approve all
      </button>
      <button
        type="button"
        onClick={onBulkReject}
        disabled={disabled}
        className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
      >
        Reject all
      </button>
      <button
        type="button"
        onClick={onBulkRejectAndBan}
        disabled={disabled}
        className="rounded border border-red-500 bg-red-50 px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
      >
        Reject + Ban reporter(s)
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-gray-500 hover:text-gray-700"
      >
        Clear
      </button>
    </div>
  );
}
