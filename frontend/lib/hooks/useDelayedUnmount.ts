"use client";

import { useEffect, useState } from "react";

/**
 * Keep an element mounted for an extra `durationMs` after it logically
 * closes so CSS transitions can run before unmount.
 *
 * - `render` is true whenever the element should be in the DOM
 *   (mount immediately when opening; stay mounted for `durationMs`
 *   after closing).
 * - `state` flips to `"open"` on the first paint after mount and back
 *   to `"closed"` immediately when the open prop turns false, giving
 *   CSS a `data-state` toggle to transition against.
 *
 * Typical usage:
 *
 *   const { render, state } = useDelayedUnmount(isOpen, 180);
 *   if (!render) return null;
 *   return <div data-state={state} className="transition-opacity ...">…</div>;
 */
export function useDelayedUnmount(open: boolean, durationMs = 180) {
  const [render, setRender] = useState(open);
  const [state, setState] = useState<"open" | "closed">(open ? "open" : "closed");

  useEffect(() => {
    if (open) {
      setRender(true);
      // Wait one frame so the initial paint applies the "closed" style,
      // then flip to "open" so the transition fires. Without the rAF
      // we'd paint the open state directly with no transition.
      const raf = requestAnimationFrame(() => setState("open"));
      return () => cancelAnimationFrame(raf);
    }
    setState("closed");
    const timer = setTimeout(() => setRender(false), durationMs);
    return () => clearTimeout(timer);
  }, [open, durationMs]);

  return { render, state };
}
