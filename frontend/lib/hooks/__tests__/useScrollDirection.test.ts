/**
 * @vitest-environment jsdom
 */
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollDirection } from "@/lib/hooks/useScrollDirection";

// Run the rAF coalescing synchronously so each scroll event is evaluated
// inside fireEvent's act() wrapper — deterministic, no act warnings.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scrollTo(el: HTMLElement, y: number) {
  el.scrollTop = y;
  fireEvent.scroll(el);
}

describe("useScrollDirection", () => {
  it("starts at rest — direction up, atTop true", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useScrollDirection(el));
    expect(result.current).toEqual({ direction: "up", atTop: true });
  });

  it("reports 'down' once the user scrolls past the threshold", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useScrollDirection(el));
    scrollTo(el, 200);
    expect(result.current.direction).toBe("down");
    expect(result.current.atTop).toBe(false);
  });

  it("reports 'up' again when the user scrolls back up", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useScrollDirection(el));
    scrollTo(el, 400);
    expect(result.current.direction).toBe("down");
    scrollTo(el, 250);
    expect(result.current.direction).toBe("up");
  });

  it("stays atTop near the top regardless of direction", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useScrollDirection(el));
    scrollTo(el, 300);
    expect(result.current.atTop).toBe(false);
    // Back within the 24px top band — atTop wins even though we just
    // travelled upward.
    scrollTo(el, 8);
    expect(result.current).toEqual({ direction: "up", atTop: true });
  });

  it("ignores sub-threshold jitter but accumulates toward a real flip", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useScrollDirection(el));
    scrollTo(el, 100);
    expect(result.current.direction).toBe("down");
    // A 6px wobble upward — below the 10px threshold, must not flip.
    scrollTo(el, 94);
    expect(result.current.direction).toBe("down");
    // Cumulative 15px upward from the anchored lastY — now it flips.
    scrollTo(el, 85);
    expect(result.current.direction).toBe("up");
  });

  it("honours a custom threshold", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() =>
      useScrollDirection(el, { threshold: 80 }),
    );
    scrollTo(el, 50);
    // 50px of travel is below the 80px threshold — no flip.
    expect(result.current.direction).toBe("up");
    scrollTo(el, 120);
    expect(result.current.direction).toBe("down");
  });

  it("stays at rest when the target is null", () => {
    const { result } = renderHook(() => useScrollDirection(null));
    expect(result.current).toEqual({ direction: "up", atTop: true });
  });

  it("detaches its listener on unmount", () => {
    const el = document.createElement("div");
    const remove = vi.spyOn(el, "removeEventListener");
    const { unmount } = renderHook(() => useScrollDirection(el));
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
