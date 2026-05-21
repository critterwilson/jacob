"use client";

import { usePWAInstall } from "@/lib/hooks/usePWAInstall";

const IS_IOS =
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as Window & { MSStream?: unknown }).MSStream;

export function InstallPrompt() {
  const { canInstall, promptInstall, dismiss, permanentDismiss, dismissed, isStandalone } =
    usePWAInstall();

  // Never show when already running as an installed PWA.
  if (isStandalone) return null;

  // Hidden until snooze expires or permanently dismissed.
  if (dismissed) return null;

  // Non-iOS only shows when the browser has surfaced a native install prompt.
  if (!IS_IOS && !canInstall) return null;

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
        {IS_IOS ? (
          <button
            type="button"
            onClick={permanentDismiss}
            className="inline-flex h-9 items-center rounded bg-gold px-3 text-xs font-medium text-ink transition-colors duration-fast hover:bg-gold-soft focus:outline-none focus-visible:shadow-glow-gold"
          >
            Already installed
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="inline-flex h-9 items-center rounded bg-gold px-3 text-xs font-medium text-ink transition-colors duration-fast hover:bg-gold-soft focus:outline-none focus-visible:shadow-glow-gold"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="inline-flex h-9 items-center rounded px-3 text-xs text-cream-muted transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:shadow-glow-gold"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
