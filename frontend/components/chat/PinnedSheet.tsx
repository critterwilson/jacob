"use client";

import type { PinnedMessage } from "@/lib/hooks/usePinnedMessages";

type Props = {
  pinned: PinnedMessage[];
  isLeader: boolean;
  onUnpin: (mid: string) => void;
  onJump?: (mid: string) => void;
  onClose: () => void;
};

export function PinnedSheet({ pinned, isLeader, onUnpin, onJump, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-label="Pinned messages"
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Pinned messages ({pinned.length})
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pinned messages"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      {pinned.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">
          No pinned messages yet.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
          {pinned.map(({ message }) => (
            <li key={message.id} className="flex items-start gap-3 px-4 py-3">
              <p className="flex-1 truncate text-sm text-gray-800">
                {message.deletedAt ? (
                  <span className="italic text-gray-400">[removed]</span>
                ) : (
                  message.body
                )}
              </p>
              <div className="flex shrink-0 gap-2">
                {onJump && (
                  <button
                    type="button"
                    onClick={() => onJump(message.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Jump
                  </button>
                )}
                {isLeader && (
                  <button
                    type="button"
                    onClick={() => onUnpin(message.id)}
                    aria-label={`Unpin message`}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Unpin
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
