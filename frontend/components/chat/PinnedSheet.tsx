"use client";

import type { PinnedMessage } from "@/lib/hooks/usePinnedMessages";

type Props = {
  gid: string;
  pinned: PinnedMessage[];
  isLeader: boolean;
  onUnpin: (mid: string) => void;
  onClose: () => void;
};

export function PinnedSheet({ gid, pinned, isLeader, onUnpin, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pinned messages"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Pinned messages ({pinned.length})
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
            aria-label="Close pinned messages"
          >
            Close
          </button>
        </div>

        <ul className="space-y-3">
          {pinned.map((msg) => (
            <li
              key={msg.id}
              className="flex items-start justify-between gap-2 rounded border border-gray-100 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800">{msg.body}</p>
                <p className="mt-0.5 text-xs text-gray-400">by {msg.authorUid}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/groups/${gid}/chat#${msg.id}`}
                  className="text-xs text-blue-600 hover:underline"
                  onClick={onClose}
                >
                  Jump
                </a>
                {isLeader && (
                  <button
                    type="button"
                    onClick={() => onUnpin(msg.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                    aria-label={`Unpin message`}
                  >
                    Unpin
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
