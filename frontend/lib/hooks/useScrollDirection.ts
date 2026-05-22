"use client";

import { useEffect, useState } from "react";

export type ScrollDirection = "up" | "down";

export type ScrollState = {
  /** Last committed scroll direction. Starts "up" so dependent UI is at rest. */
  direction: ScrollDirection;
  /** True while within `topThreshold` px of the top of the scroll range. */
  atTop: boolean;
};

type Options = {
  /**
   * Minimum px the user must travel in one direction before `direction`
   * flips. Sub-threshold moves accumulate rather than reset, so trackpad
   * jitter and rubber-band overscroll never cause a flicker. Default 10.
   */
  threshold?: number;
  /**
   * Distance from the top (px) within which `atTop` stays true regardless
   * of direction — dependent UI stays visible near the top. Default 24.
   */
  topThreshold?: number;
};

function readScrollTop(target: HTMLElement | Window): number {
  return target instanceof HTMLElement ? target.scrollTop : target.scrollY;
}

/**
 * Tracks the scroll direction of a scroll container (an element, or the
 * window). Reads are coalesced to one per animation frame so a busy
 * scroll never thrashes React. Pass `null` while the target is still
 * being resolved — the hook simply reports the at-rest state until then.
 */
export function useScrollDirection(
  target: HTMLElement | Window | null,
  { threshold = 10, topThreshold = 24 }: Options = {},
): ScrollState {
  const [state, setState] = useState<ScrollState>({
    direction: "up",
    atTop: true,
  });

  useEffect(() => {
    if (!target) return;

    let lastY = readScrollTop(target);
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const y = readScrollTop(target);

      if (y <= topThreshold) {
        lastY = y;
        setState((prev) =>
          prev.atTop && prev.direction === "up"
            ? prev
            : { direction: "up", atTop: true },
        );
        return;
      }

      const delta = y - lastY;
      if (Math.abs(delta) < threshold) {
        // Sub-threshold jitter: leave `lastY` anchored so small moves
        // accumulate toward a real change instead of resetting.
        setState((prev) => (prev.atTop ? { ...prev, atTop: false } : prev));
        return;
      }

      const direction: ScrollDirection = delta > 0 ? "down" : "up";
      lastY = y;
      setState((prev) =>
        prev.direction === direction && !prev.atTop
          ? prev
          : { direction, atTop: false },
      );
    };

    const onScroll = () => {
      if (frame) return;
      frame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(evaluate)
          : (setTimeout(evaluate, 16) as unknown as number);
    };

    // Sync to the current position in case the container is already
    // scrolled (back-navigation, restored scroll, etc.).
    evaluate();

    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (frame) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame);
        } else {
          clearTimeout(frame);
        }
      }
    };
  }, [target, threshold, topThreshold]);

  return state;
}
