/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrefersReducedMotion } from "@/lib/a11y";

type MqlListener = (e: MediaQueryListEvent) => void;
let _matches = false;
const _listeners: MqlListener[] = [];

function setMatches(value: boolean) {
  _matches = value;
  for (const listener of _listeners) {
    listener({ matches: value } as MediaQueryListEvent);
  }
}

beforeEach(() => {
  _matches = false;
  _listeners.length = 0;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: _matches,
      media: query,
      addEventListener: (_: string, cb: MqlListener) => {
        _listeners.push(cb);
      },
      removeEventListener: (_: string, cb: MqlListener) => {
        const i = _listeners.indexOf(cb);
        if (i >= 0) _listeners.splice(i, 1);
      },
    })),
  );
  // Stamp the stub onto window since the hook reads `window.matchMedia`.
  Object.defineProperty(window, "matchMedia", {
    value: globalThis.matchMedia,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion (T62)", () => {
  it("returns false by default", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when the media query already matches on mount", async () => {
    _matches = true;
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("flips when the media query changes", async () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));
    setMatches(true);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
