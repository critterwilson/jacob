"use client";

import { usePWAInstall } from "@/lib/hooks/usePWAInstall";

const IS_IOS =
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as Window & { MSStream?: unknown }).MSStream;

export function InstallPrompt() {
  const { canInstall, promptInstall, dismiss } = usePWAInstall();

  if (!canInstall && !IS_IOS) return null;

  return (
    <div
      role="banner"
      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-raised px-4 py-3 text-sm"
    >
      {IS_IOS ? (
        <span className="text-cream">
          Install JACOB: tap <strong>Share</strong> then{" "}
          <strong>Add to Home Screen</strong>.
        </span>
      ) : (
        <span className="text-cream">Install JACOB for a faster, offline-capable experience.</span>
      )}
      <div className="flex shrink-0 gap-2">
        {!IS_IOS && (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="rounded bg-gold px-3 py-1 text-xs font-medium text-ink hover:bg-gold-soft"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded px-2 py-1 text-xs text-cream-muted hover:bg-ink-overlay"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
