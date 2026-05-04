/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
}));

// Stabilise the auth-context return value across renders. If we returned
// a fresh `{ user: {...} }` literal each call, useMutes' `useCallback`
// dependency would change every render and the hook would loop.
const STABLE_AUTH = { user: { uid: "alice" }, loading: false };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => STABLE_AUTH,
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
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

import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useMutes } from "@/lib/hooks/useMutes";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as unknown as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPost.mockReset();
  mockApiDelete.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMutes", () => {
  it("returns the muted set from the GET response", async () => {
    mockApiGet.mockResolvedValueOnce({ mutedUids: ["bob", "carol"] });
    const { result } = renderHook(() => useMutes());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMuted("bob")).toBe(true);
    expect(result.current.isMuted("dave")).toBe(false);
  });

  it("mute() optimistically adds and POSTs", async () => {
    mockApiGet.mockResolvedValueOnce({ mutedUids: [] });
    mockApiPost.mockResolvedValueOnce({ uid: "bob", mutedAt: "2026-05-01T00:00:00Z" });
    const { result } = renderHook(() => useMutes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.mute("bob");
    });
    expect(mockApiPost).toHaveBeenCalledWith("/api/users/me/mutes/bob", {});
    expect(result.current.isMuted("bob")).toBe(true);
  });

  it("unmute() optimistically removes and DELETEs", async () => {
    mockApiGet.mockResolvedValueOnce({ mutedUids: ["bob"] });
    mockApiDelete.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useMutes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.unmute("bob");
    });
    expect(mockApiDelete).toHaveBeenCalledWith("/api/users/me/mutes/bob");
    expect(result.current.isMuted("bob")).toBe(false);
  });

  it("does not mute self", async () => {
    mockApiGet.mockResolvedValueOnce({ mutedUids: [] });
    const { result } = renderHook(() => useMutes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.mute("alice");
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
