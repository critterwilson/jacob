"use client";

import type { PinnedMessage } from "@/lib/hooks/usePinnedMessages";

type Props = {
  gid: string;
  pinned: PinnedMessage[];
  isLeader: boolean;
  onUnpin: (mid: string) => void;
  onClose: () => void;
};

export function PinnedSheet({
  gid,
  pinned,
  isLeader,
  onUnpin,
  onClose,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pinned messages"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl border border-line bg-ink-overlay p-5 shadow-pop sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-body font-semibold text-cream">
            Pinned messages ({pinned.length})
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm text-caption text-cream-muted transition-colors duration-fast hover:text-cream focus:outline-none focus-visible:shadow-glow-gold"
            aria-label="Close pinned messages"
          >
            Close
          </button>
        </div>

        <ul className="space-y-3">
          {pinned.map((msg) => (
            <li
              key={msg.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-line bg-ink-raised px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm text-cream">{msg.body}</p>
                <p className="mt-0.5 text-caption text-cream-dim">
                  by {msg.authorUid}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <a
                  href={`/groups/${gid}/chat#${msg.id}`}
                  className="rounded-sm text-caption text-gold-soft transition-colors duration-fast hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
                  onClick={onClose}
                >
                  Jump
                </a>
                {isLeader && (
                  <button
                    type="button"
                    onClick={() => onUnpin(msg.id)}
                    className="rounded-sm text-caption text-terracotta transition-colors duration-fast hover:opacity-80 focus:outline-none focus-visible:shadow-glow-gold"
                    aria-label="Unpin message"
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
