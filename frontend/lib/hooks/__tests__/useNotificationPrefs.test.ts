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
  apiPut: vi.fn(),
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

import { ApiError, apiGet, apiPut } from "@/lib/api";
import { useNotificationPrefs } from "@/lib/hooks/useNotificationPrefs";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;
const mockApiPut = apiPut as unknown as ReturnType<typeof vi.fn>;

const STORED = {
  mentions: false,
  replies: true,
  announcements: true,
  digest: false,
  ministryFeed: false,
  groupMessages: true,
  schemaVersion: 1,
};

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPut.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNotificationPrefs", () => {
  it("returns stored prefs after the bootstrap GET resolves", async () => {
    mockApiGet.mockResolvedValueOnce(STORED);
    const { result } = renderHook(() => useNotificationPrefs("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prefs).toEqual(STORED);
  });

  it("setPref optimistically updates and PUTs the full doc", async () => {
    mockApiGet.mockResolvedValueOnce(STORED);
    mockApiPut.mockResolvedValueOnce({ ...STORED, mentions: true });
    const { result } = renderHook(() => useNotificationPrefs("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setPref("mentions", true);
    });
    expect(mockApiPut).toHaveBeenCalledWith(
      "/api/users/me/notification-prefs",
      expect.objectContaining({ mentions: true, replies: true }),
    );
    expect(result.current.prefs.mentions).toBe(true);
  });

  it("rolls back on error", async () => {
    mockApiGet.mockResolvedValueOnce(STORED);
    mockApiPut.mockRejectedValueOnce(new ApiError(500, "internal_error", "boom"));
    const { result } = renderHook(() => useNotificationPrefs("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const originalMentions = result.current.prefs.mentions;

    await act(async () => {
      await result.current.setPref("mentions", !originalMentions);
    });
    expect(result.current.prefs.mentions).toBe(originalMentions);
    expect(result.current.error).not.toBeNull();
  });
});
