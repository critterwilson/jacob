"use client";

import { useEffect } from "react";

// Module-level counter so concurrent locks compose. The last one to
// release restores the original style.
let lockCount = 0;
let originalOverflow: string | null = null;

/**
 * Lock `body { overflow: hidden }` while `active` is true.
 *
 * Reference-counted so multiple overlapping locks (e.g. a dialog
 * opened on top of the mobile drawer) compose correctly — only the
 * last release restores the original overflow value.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow ?? "";
        originalOverflow = null;
      }
    };
  }, [active]);
}
