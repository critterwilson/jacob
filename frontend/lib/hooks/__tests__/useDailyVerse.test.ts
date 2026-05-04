/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
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
import { useDailyVerse } from "@/lib/hooks/useDailyVerse";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDailyVerse", () => {
  it("fetches today's verse and exposes content fields", async () => {
    mockApiGet.mockResolvedValueOnce({
      day: "2026-05-03",
      reference: "John 3:16",
      translation: "WEB",
      text: "For God so loved the world.",
      source: "bible-api.com",
    });

    const { result } = renderHook(() => useDailyVerse());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.verse).toEqual({
      reference: "John 3:16",
      translation: "WEB",
      text: "For God so loved the world.",
      source: "bible-api.com",
    });
    expect(mockApiGet).toHaveBeenCalledWith("/api/daily-verse", {
      signal: expect.any(AbortSignal),
    });
  });

  it("renders null verse on 404 (no doc published yet)", async () => {
    mockApiGet.mockRejectedValueOnce(
      new ApiError(404, "verse_not_found", "missing"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useDailyVerse());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.verse).toBeNull();
    expect(warn).not.toHaveBeenCalled(); // 404 is silent
  });

  it("renders null verse on transport / 5xx errors and logs", async () => {
    mockApiGet.mockRejectedValueOnce(
      new ApiError(503, "verse_unavailable", "down"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useDailyVerse());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.verse).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("aborts the in-flight request on unmount", async () => {
    let abortSignal: AbortSignal | undefined;
    mockApiGet.mockImplementationOnce((_path: string, opts: { signal: AbortSignal }) => {
      abortSignal = opts.signal;
      return new Promise(() => {
        /* never resolves */
      });
    });

    const { unmount } = renderHook(() => useDailyVerse());
    expect(abortSignal?.aborted).toBe(false);
    unmount();
    expect(abortSignal?.aborted).toBe(true);
  });
});
