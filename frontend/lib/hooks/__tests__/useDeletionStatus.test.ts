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

  it("refetches when the tab regains focus (no interval polling)", async () => {
    mockApiGet.mockResolvedValue({ status: "none" });
    const { unmount } = renderHook(() => useDeletionStatus("alice"));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible" as DocumentVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));

    window.dispatchEvent(new Event("focus"));
    // Coalesced into the previous tick (default 250ms window) — should
    // not produce a second fetch this close.
    expect(mockApiGet).toHaveBeenCalledTimes(2);

    unmount();
    window.dispatchEvent(new Event("focus"));
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it("does not start a setInterval polling loop", () => {
    // Regression guard for the "no polling outside chat" rule. If a
    // future refactor reintroduces a setInterval, the spy below will
    // catch it.
    const spy = vi.spyOn(global, "setInterval");
    mockApiGet.mockResolvedValue({ status: "none" });
    renderHook(() => useDeletionStatus("alice"));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns empty status when uid is undefined", async () => {
    const { result } = renderHook(() => useDeletionStatus(undefined));
    expect(result.current.pending).toBe(false);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
