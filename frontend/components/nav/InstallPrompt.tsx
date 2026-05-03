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
      className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm"
    >
      {IS_IOS ? (
        <span className="text-blue-800">
          Install JACOB: tap <strong>Share</strong> then{" "}
          <strong>Add to Home Screen</strong>.
        </span>
      ) : (
        <span className="text-blue-800">Install JACOB for a faster, offline-capable experience.</span>
      )}
      <div className="flex shrink-0 gap-2">
        {!IS_IOS && (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
