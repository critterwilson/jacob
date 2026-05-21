"use client";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
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
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: true,
    onEscape: onClose,
  });
  useBodyScrollLock(true);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Dismiss pinned messages"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/60 focus:outline-none focus-visible:shadow-glow-gold"
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pinned messages"
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto scroll-momentum rounded-t-2xl border border-line bg-ink-overlay p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-pop sm:max-h-[80vh] sm:rounded-2xl sm:pb-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-body font-semibold text-cream">
            Pinned messages ({pinned.length})
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex h-11 items-center rounded-sm px-3 text-body-sm text-cream-muted transition-colors duration-fast hover:text-cream focus:outline-none focus-visible:shadow-glow-gold"
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
                <p className="mt-0.5 text-caption text-cream-muted">
                  by {msg.authorUid}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/groups/${gid}/chat#${msg.id}`}
                  className="inline-flex h-11 items-center rounded-sm px-3 text-body-sm text-gold-soft transition-colors duration-fast hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
                  onClick={onClose}
                >
                  Jump
                </a>
                {isLeader && (
                  <button
                    type="button"
                    onClick={() => onUnpin(msg.id)}
                    className="inline-flex h-11 items-center rounded-sm px-3 text-body-sm text-terracotta transition-colors duration-fast hover:opacity-80 focus:outline-none focus-visible:shadow-glow-gold"
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
