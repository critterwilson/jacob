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

// M5: SSE transport. Each test that needs to exercise stream behaviour
// supplies its own implementation via `mockOpenStream.mockImplementation`.
vi.mock("@/lib/sse", () => ({
  openStream: vi.fn(),
}));

import { apiGet, apiGetConditional } from "@/lib/api";
import { openStream } from "@/lib/sse";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";

const mockApiGet = apiGet as unknown as ReturnType<typeof vi.fn>;
const mockApiGetConditional = apiGetConditional as unknown as ReturnType<typeof vi.fn>;
const mockOpenStream = openStream as unknown as ReturnType<typeof vi.fn>;

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
  mockOpenStream.mockReset();
  // Default: stream never opens, never errors. Polling stays engaged.
  // Each test that wants stream behaviour overrides this.
  mockOpenStream.mockImplementation(async (_path: string) => {
    return { close: () => {} };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useGroupMessages (M3 polling baseline)", () => {
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
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalledTimes(1));
      expect(mockApiGetConditional.mock.calls[0]?.[1]).toBeNull();

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
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(40_000);
      expect(mockApiGetConditional).not.toHaveBeenCalled();

      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalled());
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      unmount();
    }
  });
});

describe("useGroupMessages (M5 SSE transport)", () => {
  it("opens an SSE connection to the stream endpoint on mount", async () => {
    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockOpenStream).toHaveBeenCalled());
      const url = mockOpenStream.mock.calls[0]?.[0] as string;
      expect(url).toBe("/api/groups/g1/messages/stream");
    } finally {
      unmount();
    }
  });

  it("merges a stream message event into recentMessages", async () => {
    let dispatch:
      | ((ev: { event: string; data: string }) => void)
      | undefined;
    let onOpen: (() => void) | undefined;
    mockOpenStream.mockImplementationOnce(async (_path, opts) => {
      dispatch = opts.onEvent;
      onOpen = opts.onOpen;
      return { close: () => {} };
    });

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

    const { result, unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(dispatch).toBeDefined());
      // The hook calls onOpen → polling pauses; then a message event
      // lands and we expect it to appear in state.
      onOpen?.();
      dispatch?.({
        event: "message",
        data: JSON.stringify({
          id: "m2",
          authorUid: "bob",
          body: "from stream",
          stickerIds: [],
          createdAt: "2026-05-01T00:00:02Z",
          editedAt: null,
          deletedAt: null,
          parentMessageId: null,
          threadReplyCount: 0,
          mediaRefs: [],
        }),
      });
      await waitFor(() =>
        expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]),
      );
    } finally {
      unmount();
    }
  });

  it("pauses polling once the stream is open, resumes on stream error", async () => {
    let onOpen: (() => void) | undefined;
    let onError: ((err: Error) => void) | undefined;
    mockOpenStream.mockImplementationOnce(async (_path, opts) => {
      onOpen = opts.onOpen;
      onError = opts.onError;
      return { close: () => {} };
    });
    // Seed an initial message so latestCreatedAtRef is set and the poll
    // path uses apiGetConditional (not the fall-back full apiGet).
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

    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(mockOpenStream).toHaveBeenCalled());
      // Open the stream → polling should stop.
      onOpen?.();
      mockApiGetConditional.mockClear();
      await vi.advanceTimersByTimeAsync(15_000);
      // No poll tick fired while stream is open.
      expect(mockApiGetConditional).not.toHaveBeenCalled();

      // Stream errors → polling resumes immediately.
      onError?.(new Error("stream_closed_by_server"));
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalled());
    } finally {
      unmount();
    }
  });

  it("gives up on the stream after repeated failures and stays on polling", async () => {
    // Seed an initial message so the polling fallback uses
    // apiGetConditional (the path with since=) and we can assert on it.
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
    // Every open immediately errors. After enough failures the hook
    // should stop calling openStream again.
    mockOpenStream.mockImplementation(async (_path, opts) => {
      // Fire the error on the next microtask so the caller's handle
      // is registered before the failure propagates.
      Promise.resolve().then(() => opts.onError?.(new Error("kaboom")));
      return { close: () => {} };
    });

    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() =>
        expect(mockOpenStream.mock.calls.length).toBeGreaterThanOrEqual(1),
      );
      // Schedule tops out at 30s. Two minutes covers every backoff
      // attempt plus padding.
      await vi.advanceTimersByTimeAsync(120_000);
      const callCount = mockOpenStream.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockOpenStream.mock.calls.length).toBe(callCount);
      // And polling is now the active transport.
      mockApiGetConditional.mockClear();
      await vi.advanceTimersByTimeAsync(10_001);
      await waitFor(() => expect(mockApiGetConditional).toHaveBeenCalled());
    } finally {
      unmount();
    }
  });

  it("closes the stream on unmount", async () => {
    const close = vi.fn();
    mockOpenStream.mockImplementationOnce(async () => ({ close }));
    const { unmount } = renderHook(() => useGroupMessages("g1"));
    await waitFor(() => expect(mockOpenStream).toHaveBeenCalled());
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it("closes the stream when document is hidden and reopens on visible", async () => {
    let openCount = 0;
    const close = vi.fn();
    mockOpenStream.mockImplementation(async () => {
      openCount += 1;
      return { close };
    });
    const { unmount } = renderHook(() => useGroupMessages("g1"));
    try {
      await waitFor(() => expect(openCount).toBe(1));
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(close).toHaveBeenCalled();

      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(openCount).toBeGreaterThanOrEqual(2));
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      unmount();
    }
  });
});
