/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { ApiError, apiGet } from "@/lib/api";
import { useGroups } from "@/lib/hooks/useGroups";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockApiGet.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("useGroups", () => {
  it("returns the groups list from /api/users/me/groups", async () => {
    mockApiGet.mockResolvedValueOnce({
      groups: [
        {
          gid: "g1",
          name: "Alpha",
          description: "",
          avatarUrl: null,
          isPrivate: false,
          archivedAt: null,
          role: "member",
          joinedAt: null,
          memberCount: 3,
          lastMessageAt: null,
        },
      ],
    });
    const { result } = renderHook(() => useGroups("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0]?.id).toBe("g1");
    expect(result.current.groups[0]?.name).toBe("Alpha");
  });

  it("returns empty list and stops loading when uid is undefined", async () => {
    const { result } = renderHook(() => useGroups(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toEqual([]);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("returns empty list when api returns ApiError", async () => {
    mockApiGet.mockRejectedValueOnce(new ApiError(401, "unauthenticated", "no token"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useGroups("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("refresh() re-fetches", async () => {
    mockApiGet.mockResolvedValue({ groups: [] });
    const { result } = renderHook(() => useGroups("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    await result.current.refresh();
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });
});
