/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
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

import { ApiError, apiGet } from "@/lib/api";
import { useStickers } from "@/lib/hooks/useStickers";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

const SAMPLE = {
  stickers: [
    {
      slug: "check-in",
      name: "Check-In",
      audience: "christian",
      order: 1,
      color: "#2563EB",
    },
    {
      slug: "prayer-request",
      name: "Prayer Request",
      audience: "christian",
      order: 2,
      color: "#7C3AED",
    },
  ],
  etag: 'W/"abc123"',
};

beforeEach(async () => {
  // Reset the module-level cache between tests so each one starts fresh.
  vi.resetModules();
  mockApiGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStickers", () => {
  it("returns loading=true then resolves with stickers", async () => {
    const { useStickers: freshHook } = await import(
      "@/lib/hooks/useStickers"
    );
    mockApiGet.mockResolvedValueOnce(SAMPLE);

    const { result } = renderHook(() => freshHook());
    expect(result.current.loading).toBe(true);
    expect(result.current.stickers).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stickers).toHaveLength(2);
    expect(result.current.stickers[0]).toMatchObject({
      id: "check-in",
      slug: "check-in",
      name: "Check-In",
      color: "#2563EB",
    });
    expect(mockApiGet).toHaveBeenCalledWith("/api/stickers");
  });

  it("memoises the response across hook instances", async () => {
    const { useStickers: freshHook } = await import(
      "@/lib/hooks/useStickers"
    );
    mockApiGet.mockResolvedValueOnce(SAMPLE);

    const first = renderHook(() => freshHook());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => freshHook());
    // Cache is warm — second mount should not re-fetch and should not flash
    // an empty loading state.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.stickers).toHaveLength(2);
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });

  it("renders an empty list and stops loading on ApiError", async () => {
    const { useStickers: freshHook } = await import(
      "@/lib/hooks/useStickers"
    );
    mockApiGet.mockRejectedValueOnce(
      new ApiError(503, "stickers_unavailable", "down"),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => freshHook());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stickers).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
