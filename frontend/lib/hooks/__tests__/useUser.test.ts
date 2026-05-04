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
import { useUser } from "@/lib/hooks/useUser";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUser", () => {
  it("returns the bootstrap profile", async () => {
    mockApiGet.mockResolvedValueOnce({
      hasProfile: true,
      profile: {
        uid: "alice",
        displayName: "Alice",
        email: "alice@example.com",
        photoURL: null,
        role: "member",
        schemaVersion: 1,
        isMinor: false,
        createdAt: null,
      },
      claims: { admin: false },
      deletionRequestedAt: null,
    });
    const { result } = renderHook(() => useUser("alice"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.uid).toBe("alice");
  });

  it("returns null profile when hasProfile is false", async () => {
    mockApiGet.mockResolvedValueOnce({
      hasProfile: false,
      profile: null,
      claims: { admin: false },
      deletionRequestedAt: null,
    });
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
  });

  it("treats ApiError as no-profile", async () => {
    mockApiGet.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "no token"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("refresh() re-fetches the bootstrap endpoint", async () => {
    mockApiGet.mockResolvedValue({
      hasProfile: false,
      profile: null,
      claims: { admin: false },
      deletionRequestedAt: null,
    });
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    await result.current.refresh();
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it("does not call apiGet when uid is undefined", async () => {
    const { result } = renderHook(() => useUser(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
