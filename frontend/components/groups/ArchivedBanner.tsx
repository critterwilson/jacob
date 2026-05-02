"use client";

type Props = {
  isLeader?: boolean;
  onUnarchive?: () => void;
};

export function ArchivedBanner({ isLeader, onUnarchive }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
    >
      <span>This group is archived. New messages are disabled.</span>
      {isLeader && onUnarchive && (
        <button
          type="button"
          onClick={onUnarchive}
          className="ml-4 shrink-0 rounded border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100"
        >
          Unarchive
        </button>
      )}
    </div>
  );
}
