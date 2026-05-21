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
  apiPost: vi.fn(),
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
import { useReadingPlanToday } from "@/lib/hooks/useReadingPlans";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReadingPlanToday", () => {
  it("returns the composite payload on success", async () => {
    mockApiGet.mockResolvedValueOnce({
      plan: {
        slug: "psalms",
        title: "Psalms in 21 days",
        description: "",
        duration: 21,
        audience: "christian",
        publishedAt: null,
      },
      nextDay: {
        dayNumber: 3,
        scriptureRef: "Psalm 3",
        prompt: "Reflect.",
      },
      completedDays: [1, 2],
      streak: 2,
      lastCompletedAt: null,
      allDaysComplete: false,
    });

    const { result } = renderHook(() => useReadingPlanToday());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.plan?.slug).toBe("psalms");
    expect(result.current.data?.nextDay?.dayNumber).toBe(3);
    expect(mockApiGet).toHaveBeenCalledWith("/api/users/me/reading-plan-today", {
      signal: expect.any(AbortSignal),
    });
  });

  it("returns null data on transport failure (renders empty state)", async () => {
    mockApiGet.mockRejectedValueOnce(
      new ApiError(500, "internal", "boom"),
    );

    const { result } = renderHook(() => useReadingPlanToday());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("aborts the in-flight request on unmount", async () => {
    let abortSignal: AbortSignal | undefined;
    mockApiGet.mockImplementationOnce(
      (_path: string, opts: { signal: AbortSignal }) => {
        abortSignal = opts.signal;
        return new Promise(() => {
          /* never resolves */
        });
      },
    );

    const { unmount } = renderHook(() => useReadingPlanToday());
    expect(abortSignal?.aborted).toBe(false);
    unmount();
    expect(abortSignal?.aborted).toBe(true);
  });
});
