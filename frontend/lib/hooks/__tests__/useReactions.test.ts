/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { uid: "alice" } }),
}));

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiPost, apiDelete } from "@/lib/api";
import type { Message } from "@/lib/hooks/useGroupMessages";
import { useReactions } from "@/lib/hooks/useReactions";

const mockApiPost = apiPost as unknown as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue({});
  mockApiDelete.mockReset();
  mockApiDelete.mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  authorUid: "bob",
  body: "hi",
  stickerIds: [],
  createdAt: "2026-05-01T00:00:01Z",
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  threadReplyCount: 0,
  mediaRefs: [],
  ...overrides,
});

describe("useReactions hydration", () => {
  it("seeds isMyReaction from message.myReactions on mount", async () => {
    const messages: Message[] = [baseMessage({ id: "m1", myReactions: ["pray"] })];
    const { result } = renderHook(() => useReactions("g1", messages));
    await waitFor(() => expect(result.current.isMyReaction("m1", "pray")).toBe(true));
    expect(result.current.isMyReaction("m1", "amen")).toBe(false);
  });

  it("isMyReaction stays true after a remount that simulates a page refresh", async () => {
    // First render: pretend the user reacted in this session.
    const initialMsgs: Message[] = [baseMessage({ id: "m1", myReactions: ["pray"] })];
    const { result, unmount } = renderHook(() => useReactions("g1", initialMsgs));
    await waitFor(() => expect(result.current.isMyReaction("m1", "pray")).toBe(true));

    // Simulate a refresh — fully unmount, then mount fresh with a fresh
    // server response that still includes the user's reaction.
    unmount();
    const refreshedMsgs: Message[] = [baseMessage({ id: "m1", myReactions: ["pray"] })];
    const { result: result2 } = renderHook(() => useReactions("g1", refreshedMsgs));
    await waitFor(() => expect(result2.current.isMyReaction("m1", "pray")).toBe(true));
  });

  it("toggle un-reacts when isMyReaction is true after refresh", async () => {
    const messages: Message[] = [baseMessage({ id: "m1", myReactions: ["pray"] })];
    const { result } = renderHook(() => useReactions("g1", messages));
    await waitFor(() => expect(result.current.isMyReaction("m1", "pray")).toBe(true));
    await act(async () => {
      await result.current.toggle("m1", "pray");
    });
    // toggle on existing reaction should DELETE, not POST another reaction.
    expect(mockApiDelete).toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("optimistic add survives a hydrate from a stale message stream", async () => {
    const initialMsgs: Message[] = [baseMessage({ id: "m1", myReactions: [] })];
    const { result, rerender } = renderHook(
      ({ messages }: { messages: Message[] }) => useReactions("g1", messages),
      { initialProps: { messages: initialMsgs } },
    );
    await act(async () => {
      await result.current.toggle("m1", "amen");
    });
    expect(result.current.isMyReaction("m1", "amen")).toBe(true);
    // Stale message stream comes back without amen — optimistic should hold.
    rerender({ messages: [baseMessage({ id: "m1", myReactions: [] })] });
    expect(result.current.isMyReaction("m1", "amen")).toBe(true);
    // Fresh stream confirms amen → optimistic clears.
    rerender({ messages: [baseMessage({ id: "m1", myReactions: ["amen"] })] });
    expect(result.current.isMyReaction("m1", "amen")).toBe(true);
  });
});

describe("useReactions count merging (M-FRONT-4)", () => {
  it("bumps base count by +1 while a react is in flight", async () => {
    const messages: Message[] = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: { amen: 3 } }),
    ];
    const { result } = renderHook(() => useReactions("g1", messages));
    expect(result.current.mergeReactionCounts("m1", { amen: 3 })).toEqual({ amen: 3 });
    await act(async () => {
      await result.current.toggle("m1", "amen");
    });
    expect(result.current.mergeReactionCounts("m1", { amen: 3 })).toEqual({ amen: 4 });
  });

  it("bumps base count by -1 while an unreact is in flight", async () => {
    const messages: Message[] = [
      baseMessage({ id: "m1", myReactions: ["amen"], reactionCounts: { amen: 3 } }),
    ];
    const { result } = renderHook(() => useReactions("g1", messages));
    await waitFor(() => expect(result.current.isMyReaction("m1", "amen")).toBe(true));
    await act(async () => {
      await result.current.toggle("m1", "amen");
    });
    expect(result.current.mergeReactionCounts("m1", { amen: 3 })).toEqual({ amen: 2 });
  });

  it("rolls back the +1 on API error", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("net"));
    const messages: Message[] = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: { amen: 3 } }),
    ];
    const { result } = renderHook(() => useReactions("g1", messages));
    await act(async () => {
      await result.current.toggle("m1", "amen");
    });
    expect(result.current.mergeReactionCounts("m1", { amen: 3 })).toEqual({ amen: 3 });
    expect(result.current.isMyReaction("m1", "amen")).toBe(false);
  });

  it("surfaces a brand-new slug not in baseCounts", async () => {
    const messages: Message[] = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: {} }),
    ];
    const { result } = renderHook(() => useReactions("g1", messages));
    await act(async () => {
      await result.current.toggle("m1", "fire");
    });
    expect(result.current.mergeReactionCounts("m1", {})).toEqual({ fire: 1 });
  });
});
