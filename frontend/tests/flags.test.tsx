/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { apiGet as apiGetExport } from "@/lib/api";
import {
  __resetFlagCacheForTests,
  evaluateFlag,
  useFlag,
  useFlags,
} from "@/lib/flags";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;

describe("flags client", () => {
  beforeEach(() => {
    __resetFlagCacheForTests();
    apiGet.mockReset();
  });

  afterEach(() => {
    __resetFlagCacheForTests();
  });

  it("evaluateFlag treats missing keys as false", () => {
    expect(evaluateFlag(null, "x")).toBe(false);
    expect(evaluateFlag({}, "x")).toBe(false);
    expect(evaluateFlag({ x: false }, "x")).toBe(false);
    expect(evaluateFlag({ x: true }, "x")).toBe(true);
  });

  it("useFlag returns false until the fetch resolves, then true on hit", async () => {
    apiGet.mockResolvedValue({
      flags: { my_feature: true, other: false },
    });
    const { result } = renderHook(() => useFlag("my_feature"));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("useFlag returns false for keys not in the response", async () => {
    apiGet.mockResolvedValue({ flags: { other: true } });
    const { result } = renderHook(() => useFlag("missing"));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("multiple useFlag callers share a single in-flight fetch", async () => {
    apiGet.mockResolvedValue({ flags: { a: true, b: true } });
    const a = renderHook(() => useFlag("a"));
    const b = renderHook(() => useFlag("b"));
    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("useFlags surfaces the full evaluated map", async () => {
    apiGet.mockResolvedValue({ flags: { x: true, y: false } });
    const { result } = renderHook(() => useFlags());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.flags).toEqual({ x: true, y: false });
  });

  it("falls back to the empty map on transport failure (does not throw)", async () => {
    apiGet.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useFlag("anything"));
    // Wait for the rejection to settle
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });
});
