// T62 — accessibility helpers.

"use client";

import { useEffect, useState } from "react";

/**
 * `prefers-reduced-motion` media-query subscriber. Components hide
 * non-essential animations (typing-indicator pulse, reaction
 * micro-anims) when this returns true. SSR-safe: returns `false`
 * before hydration.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    if ("addEventListener" in mql) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    // Older Safari fallback (the type guard above keeps TS happy).
    const legacyMql = mql as unknown as {
      addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacyMql.addListener(handler);
    return () => legacyMql.removeListener(handler);
  }, []);
  return reduced;
}

/**
 * Trap focus inside a container for the duration of a modal / picker.
 * Returns a `ref` to attach to the container; on mount the helper
 * stores the previously-focused element and restores it on unmount.
 *
 * Usage:
 *   const trapRef = useFocusTrap();
 *   return <div ref={trapRef} role="dialog" aria-modal="true">...</div>
 */
export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T> {
  const ref = { current: null } as React.RefObject<T>;

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length > 0) focusables[0].focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handler);
    return () => {
      container.removeEventListener("keydown", handler);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
