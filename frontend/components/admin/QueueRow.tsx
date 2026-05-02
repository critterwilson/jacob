"use client";

export type QueueItem = {
  itemId: string;
  resourceRef: string;
  reason: string | null;
  severity: number | null;
  status: string;
  uploaderUid: string | null;
  reportedBy: string | null;
  resourceType: string | null;
  groupId: string | null;
  context: string | null;
  auto: boolean;
  createdAt: string | null;
  extra: Record<string, unknown>;
};

type Props = {
  item: QueueItem;
  selected: boolean;
  onSelect: (id: string, next: boolean) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRejectAndBan?: (id: string, uploaderUid: string, duration: "24h" | "7d" | "permanent") => void;
  pending?: boolean;
};

const SEVERITY_LABELS: Record<number, { label: string; classes: string }> = {
  3: { label: "High", classes: "bg-red-100 text-red-800" },
  2: { label: "Medium", classes: "bg-amber-100 text-amber-800" },
  1: { label: "Low", classes: "bg-gray-100 text-gray-700" },
};

function formatAge(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function QueueRow({
  item,
  selected,
  onSelect,
  onApprove,
  onReject,
  onRejectAndBan,
  pending = false,
}: Props) {
  const severity = item.severity ?? null;
  const sevMeta = severity != null ? SEVERITY_LABELS[severity] : null;

  return (
    <li className="rounded border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Select ${item.itemId}`}
          checked={selected}
          onChange={(e) => onSelect(item.itemId, e.target.checked)}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-gray-800">
              {item.resourceRef}
            </p>
            {sevMeta && (
              <span
                aria-label={`Severity: ${sevMeta.label}`}
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${sevMeta.classes}`}
              >
                {sevMeta.label}
              </span>
            )}
            {item.auto && (
              <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                auto
              </span>
            )}
          </div>
          {item.reason && (
            <p className="mt-1 text-xs text-gray-500">Reason: {item.reason}</p>
          )}
          {item.context && (
            <p className="mt-1 text-xs italic text-gray-500">
              &quot;{item.context}&quot;
            </p>
          )}
          {item.reportedBy && (
            <p className="text-xs text-gray-500">
              Reporter: <code>{item.reportedBy}</code>
            </p>
          )}
          {item.uploaderUid && (
            <p className="text-xs text-gray-500">
              Uploader: <code>{item.uploaderUid}</code>
            </p>
          )}
          {item.createdAt && (
            <p className="text-xs text-gray-400">{formatAge(item.createdAt)}</p>
          )}
        </div>
        <span className="shrink-0 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
          {item.status}
        </span>
      </div>

      {pending ? (
        <p className="text-xs text-gray-500">Processing…</p>
      ) : (
        item.status === "pending" && (
          <div className="flex flex-wrap gap-2 pl-7">
            <button
              type="button"
              onClick={() => onApprove(item.itemId)}
              className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(item.itemId)}
              className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
            >
              Reject
            </button>
            {item.uploaderUid && onRejectAndBan && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onRejectAndBan(item.itemId, item.uploaderUid!, "24h")
                  }
                  className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Reject + Ban 24h
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onRejectAndBan(item.itemId, item.uploaderUid!, "7d")
                  }
                  className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Reject + Ban 7d
                </button>
              </>
            )}
          </div>
        )
      )}
    </li>
  );
}
