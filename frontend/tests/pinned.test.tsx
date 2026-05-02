/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Stub Firebase singletons
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

// Single consolidated Firestore mock — all tests in this file use these defaults.
// Per-test overrides use mockImplementationOnce before calling the hook/render.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: vi.fn((...args: unknown[]) => ({ path: (args as string[]).join("/") })),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockResolvedValue({
      exists: () => true,
      id: "m1",
      data: () => ({
        body: "Hello from pinned",
        authorUid: "alice",
        stickerIds: [],
        createdAt: null,
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    }),
    onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
      cb({
        exists: () => true,
        data: () => ({ pinnedMessageIds: ["m1", "m2"] }),
      });
      return vi.fn();
    }),
  };
});

// Stub auth
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: vi.fn().mockResolvedValue("tok"),
    },
    loading: false,
  }),
}));

// Stub mutes/blocks/stickers used in MessageList/MessageItem
vi.mock("@/lib/hooks/useMutes", () => ({ useMutes: () => ({ isMuted: () => false }) }));
vi.mock("@/lib/hooks/useBlocks", () => ({ useBlocks: () => ({ isBlocked: () => false }) }));
vi.mock("@/lib/hooks/useStickers", () => ({ useStickers: () => ({ stickers: [] }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

// ── usePinnedMessages ─────────────────────────────────────────────────────────

import { usePinnedMessages } from "@/lib/hooks/usePinnedMessages";
import { renderHook, act } from "@testing-library/react";
import { updateDoc, onSnapshot } from "firebase/firestore";

describe("usePinnedMessages", () => {
  it("reads pinnedIds from group doc snapshot", () => {
    (onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_ref: unknown, cb: (snap: unknown) => void) => {
        cb({ exists: () => true, data: () => ({ pinnedMessageIds: ["m1", "m2"] }) });
        return vi.fn();
      },
    );
    const { result } = renderHook(() => usePinnedMessages("g1"));
    expect(result.current.pinnedIds).toEqual(["m1", "m2"]);
  });

  it("togglePin removes an existing pin", async () => {
    (onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_ref: unknown, cb: (snap: unknown) => void) => {
        cb({ exists: () => true, data: () => ({ pinnedMessageIds: ["m1", "m2"] }) });
        return vi.fn();
      },
    );
    const { result } = renderHook(() => usePinnedMessages("g1"));
    await act(async () => {
      await result.current.togglePin("m1");
    });
    const [, payload] = (updateDoc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((payload as { pinnedMessageIds: string[] }).pinnedMessageIds).not.toContain("m1");
  });

  it("togglePin caps at 5 when adding a new pin", async () => {
    (onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_ref: unknown, cb: (snap: unknown) => void) => {
        cb({
          exists: () => true,
          data: () => ({ pinnedMessageIds: ["p1", "p2", "p3", "p4", "p5"] }),
        });
        return vi.fn();
      },
    );
    const { result } = renderHook(() => usePinnedMessages("g1"));
    await act(async () => {
      await result.current.togglePin("new");
    });
    const [, payload] = (updateDoc as ReturnType<typeof vi.fn>).mock.calls[0];
    const ids = (payload as { pinnedMessageIds: string[] }).pinnedMessageIds;
    expect(ids.length).toBe(5);
    expect(ids[0]).toBe("new");
  });
});

// ── PinnedBar ─────────────────────────────────────────────────────────────────

import { PinnedBar } from "@/components/chat/PinnedBar";

describe("PinnedBar", () => {
  it("renders the pinned message preview when there is at least one pin", async () => {
    (onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_ref: unknown, cb: (snap: unknown) => void) => {
        cb({ exists: () => true, data: () => ({ pinnedMessageIds: ["m1"] }) });
        return vi.fn();
      },
    );
    render(<PinnedBar gid="g1" isLeader={false} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toBeInTheDocument(),
    );
  });

  it("renders nothing when there are no pins", () => {
    (onSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_ref: unknown, cb: (snap: unknown) => void) => {
        cb({ exists: () => true, data: () => ({ pinnedMessageIds: [] }) });
        return vi.fn();
      },
    );
    const { container } = render(<PinnedBar gid="g1" isLeader={false} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── PinnedSheet ───────────────────────────────────────────────────────────────

import { PinnedSheet } from "@/components/chat/PinnedSheet";
import type { PinnedMessage } from "@/lib/hooks/usePinnedMessages";
import type { Message } from "@/lib/hooks/useGroupMessages";

const fakePinned: PinnedMessage[] = [
  {
    message: {
      id: "m1",
      authorUid: "alice",
      body: "First pinned message",
      stickerIds: [],
      createdAt: null,
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      threadReplyCount: 0,
      mediaRefs: [],
    } satisfies Message,
  },
];

describe("PinnedSheet", () => {
  it("renders pinned messages with unpin button for leaders", () => {
    const onUnpin = vi.fn();
    render(
      <PinnedSheet
        pinned={fakePinned}
        isLeader
        onUnpin={onUnpin}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/first pinned message/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unpin/i })).toBeInTheDocument();
  });

  it("hides unpin button for non-leaders", () => {
    render(
      <PinnedSheet
        pinned={fakePinned}
        isLeader={false}
        onUnpin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /unpin/i })).toBeNull();
  });

  it("calls onUnpin when Unpin is clicked", async () => {
    const onUnpin = vi.fn();
    render(
      <PinnedSheet
        pinned={fakePinned}
        isLeader
        onUnpin={onUnpin}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /unpin/i }));
    expect(onUnpin).toHaveBeenCalledWith("m1");
  });
});
