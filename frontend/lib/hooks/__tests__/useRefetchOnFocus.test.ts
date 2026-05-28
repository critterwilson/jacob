/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

function fireVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useRefetchOnFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible" as DocumentVisibilityState,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls refetch when visibilitychange fires with visible", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch));
    expect(refetch).not.toHaveBeenCalled();
    fireVisibility("hidden");
    expect(refetch).not.toHaveBeenCalled();
    fireVisibility("visible");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch when window.focus fires", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch));
    window.dispatchEvent(new Event("focus"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces a visibility+focus burst into a single refetch", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch));
    fireVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fires again after the coalesce window elapses", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch, { coalesceMs: 100 }));
    fireVisibility("visible");
    expect(refetch).toHaveBeenCalledTimes(1);

    // Advance past the coalesce window.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireVisibility("visible");
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("uses the latest refetch identity (closure-over-stale guard)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ fn }) => useRefetchOnFocus(fn),
      { initialProps: { fn: first } },
    );
    rerender({ fn: second });

    window.dispatchEvent(new Event("focus"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes listeners on unmount", () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() => useRefetchOnFocus(refetch));
    unmount();
    window.dispatchEvent(new Event("focus"));
    fireVisibility("visible");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does nothing when enabled=false", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch, { enabled: false }));
    window.dispatchEvent(new Event("focus"));
    fireVisibility("visible");
    expect(refetch).not.toHaveBeenCalled();
  });
});
