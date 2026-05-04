/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiGet } from "@/lib/api";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;

// Fake timers keep the polling setInterval dormant — the tests only
// care about the mount-time fetch and the gid-change refetch.
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  mockApiGet.mockReset();
  mockApiGet.mockResolvedValue({ messages: [], nextCursor: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useGroupMessages (M3 polling)", () => {
  it("calls apiGet for the group on mount", async () => {
    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      const url = mockApiGet.mock.calls[0]?.[0] as string;
      expect(url).toMatch(/\/api\/groups\/g1\/messages/);
    } finally {
      unmount();
    }
  });

  it("returns empty messages and not-loading when gid is undefined", () => {
    const { result, unmount } = renderHook(() => useGroupMessages(undefined));
    try {
      expect(result.current.loading).toBe(false);
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.hasMore).toBe(false);
      expect(mockApiGet).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("starts in loading state", () => {
    const { result, unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      expect(result.current.loading).toBe(true);
    } finally {
      unmount();
    }
  });

  it("re-fetches when gid changes", async () => {
    const { rerender, unmount } = renderHook(
      ({ gid }: { gid: string }) => useGroupMessages(gid),
      { initialProps: { gid: "g1" } },
    );
    try {
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      mockApiGet.mockClear();
      rerender({ gid: "g2" });
      await waitFor(() => {
        const url = mockApiGet.mock.calls[0]?.[0] as string;
        expect(url).toMatch(/\/api\/groups\/g2\/messages/);
      });
    } finally {
      unmount();
    }
  });

  it("sets messages from the first-page fetch (oldest-first ordering)", async () => {
    mockApiGet.mockResolvedValueOnce({
      // Server returns desc; hook flips to asc for rendering.
      messages: [
        {
          id: "m2",
          authorUid: "bob",
          body: "second",
          stickerIds: [],
          createdAt: "2026-05-01T00:00:02Z",
          editedAt: null,
          deletedAt: null,
          parentMessageId: null,
          threadReplyCount: 0,
          mediaRefs: [],
        },
        {
          id: "m1",
          authorUid: "bob",
          body: "first",
          stickerIds: [],
          createdAt: "2026-05-01T00:00:01Z",
          editedAt: null,
          deletedAt: null,
          parentMessageId: null,
          threadReplyCount: 0,
          mediaRefs: [],
        },
      ],
      nextCursor: null,
    });
    const { result, unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    } finally {
      unmount();
    }
  });
});
