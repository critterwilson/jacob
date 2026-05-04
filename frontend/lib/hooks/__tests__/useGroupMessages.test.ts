/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiGetConditional: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiGet, apiGetConditional } from "@/lib/api";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;
const mockApiGetConditional = apiGetConditional as unknown as ReturnType<typeof vi.fn>;

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
  mockApiGetConditional.mockReset();
  mockApiGetConditional.mockResolvedValue({
    status: 200,
    data: { messages: [], nextCursor: null },
    etag: null,
  });
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

  it("polls with since= and merges new messages by id", async () => {
    mockApiGet.mockResolvedValueOnce({
      messages: [
        {
          id: "m1",
          authorUid: "alice",
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
    mockApiGetConditional.mockResolvedValueOnce({
      status: 200,
      data: {
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
        ],
        nextCursor: null,
      },
      etag: 'W/"poll1"',
    });

    const { result, unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.messages.map((m) => m.id)).toEqual(["m1"]);

      // Advance past the 10s poll interval — incremental tick fires.
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalled());

      const pollUrl = mockApiGetConditional.mock.calls[0]?.[0] as string;
      expect(pollUrl).toMatch(/since=/);
      expect(pollUrl).toContain(encodeURIComponent("2026-05-01T00:00:01Z"));

      await waitFor(() =>
        expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]),
      );
    } finally {
      unmount();
    }
  });

  it("sends If-None-Match on subsequent polls", async () => {
    mockApiGet.mockResolvedValueOnce({
      messages: [
        {
          id: "m1",
          authorUid: "alice",
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
    mockApiGetConditional
      .mockResolvedValueOnce({
        status: 200,
        data: { messages: [], nextCursor: null },
        etag: 'W/"poll-etag-1"',
      })
      .mockResolvedValueOnce({
        status: 304,
        data: null,
        etag: 'W/"poll-etag-1"',
      });

    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      // First poll tick.
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalledTimes(1));
      // First poll: no etag yet (null was passed).
      expect(mockApiGetConditional.mock.calls[0]?.[1]).toBeNull();

      // Second poll tick: etag from prior poll is now passed back.
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalledTimes(2));
      expect(mockApiGetConditional.mock.calls[1]?.[1]).toBe('W/"poll-etag-1"');
    } finally {
      unmount();
    }
  });

  it("skips polling while document is hidden", async () => {
    mockApiGet.mockResolvedValueOnce({
      messages: [
        {
          id: "m1",
          authorUid: "alice",
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
    // Simulate hidden tab.
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      // Advance past several poll intervals — apiGetConditional should never fire.
      await vi.advanceTimersByTimeAsync(40_000);
      expect(mockApiGetConditional).not.toHaveBeenCalled();

      // Now make tab visible. Dispatching visibilitychange should trigger an
      // immediate poll.
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalled());
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      unmount();
    }
  });
});
