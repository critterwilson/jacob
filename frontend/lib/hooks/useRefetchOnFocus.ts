"use client";

import { useEffect, useRef } from "react";

/**
 * Refetch on tab focus / visibility-visible.
 *
 * The project-wide "no polling outside chat" rule (post-2026-05) means
 * non-chat surfaces drop their intervals and instead refetch when the
 * user switches back to the tab. This covers the realistic case —
 * someone alt-tabs to JACOB and sees current data.
 *
 * Listeners:
 *  - `document.visibilitychange` — fires when the tab becomes the
 *    active foreground tab (browser-level)
 *  - `window.focus` — fires when the OS focuses the window (covers
 *    OS-level alt-tab back to the browser)
 *
 * Both can fire close together; the dedupe in `_lastInvokedAt` keeps
 * the callback firing at most every `coalesceMs` milliseconds so a
 * single tab-switch doesn't cause two parallel fetches.
 *
 * Pass a stable `refetch` callback (memoize with `useCallback` upstream).
 * Identity changes are absorbed via a ref so the listeners stay bound.
 */
export function useRefetchOnFocus(
  refetch: () => void,
  options: { coalesceMs?: number; enabled?: boolean } = {},
): void {
  const { coalesceMs = 250, enabled = true } = options;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const lastInvokedAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const invoke = () => {
      const now = Date.now();
      if (now - lastInvokedAt.current < coalesceMs) return;
      lastInvokedAt.current = now;
      refetchRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") invoke();
    };
    const onFocus = () => invoke();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [coalesceMs, enabled]);
}
