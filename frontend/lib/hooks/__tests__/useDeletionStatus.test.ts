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

import { apiGet } from "@/lib/api";
import { useDeletionStatus } from "@/lib/hooks/useDeletionStatus";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeletionStatus", () => {
  it("returns pending=true with finalizeAt for an active deletion", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "pending",
      deletionRequestedAt: "2026-04-25T00:00:00Z",
      finalizeAt: "2026-05-09T00:00:00Z",
      keepBody: false,
    });
    const { result } = renderHook(() => useDeletionStatus("alice"));
    await waitFor(() => expect(result.current.pending).toBe(true));
    expect(result.current.finalizeAt?.toISOString()).toBe("2026-05-09T00:00:00.000Z");
    expect(result.current.keepBody).toBe(false);
  });

  it("returns pending=false when status is none", async () => {
    mockApiGet.mockResolvedValueOnce({ status: "none" });
    const { result } = renderHook(() => useDeletionStatus("alice"));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(result.current.pending).toBe(false);
  });

  it("polls on an interval and clears it on unmount", async () => {
    vi.useFakeTimers();
    try {
      mockApiGet.mockResolvedValue({ status: "none" });
      const { unmount } = renderHook(() => useDeletionStatus("alice"));
      // Initial mount fires one fetch synchronously.
      await vi.waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockApiGet).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockApiGet).toHaveBeenCalledTimes(3);

      unmount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockApiGet).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns empty status when uid is undefined", async () => {
    const { result } = renderHook(() => useDeletionStatus(undefined));
    expect(result.current.pending).toBe(false);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
