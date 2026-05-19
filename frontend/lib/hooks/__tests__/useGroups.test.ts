/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/api", () => ({
  apiGetConditional: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { ApiError, apiGetConditional } from "@/lib/api";
import { useGroups } from "@/lib/hooks/useGroups";

const mockApiGetConditional = apiGetConditional as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockApiGetConditional.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("useGroups", () => {
  it("returns the groups list from /api/users/me/groups", async () => {
    mockApiGetConditional.mockResolvedValueOnce({
      status: 200,
      data: {
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
      },
      etag: 'W/"abc"',
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
    expect(mockApiGetConditional).not.toHaveBeenCalled();
  });

  it("returns empty list when api returns ApiError", async () => {
    mockApiGetConditional.mockRejectedValueOnce(
      new ApiError(401, "unauthenticated", "no token"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useGroups("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("refresh() re-fetches", async () => {
    mockApiGetConditional.mockResolvedValue({ status: 200, data: { groups: [] }, etag: null });
    const { result } = renderHook(() => useGroups("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiGetConditional).toHaveBeenCalledTimes(1);
    await result.current.refresh();
    expect(mockApiGetConditional).toHaveBeenCalledTimes(2);
  });
});
