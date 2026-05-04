/**
 * @vitest-environment jsdom
 *
 * MessageList mute/block filter tests, split out of chat.test.tsx.
 * These tests use `vi.resetModules()` + dynamic re-imports to swap
 * `useMutes` / `useBlocks` mocks per test. When run alongside the
 * MessageInput / MessageItem tests in the same file, vitest's worker
 * memory model balloons and OOMs. In their own file the suite finishes
 * in ~200ms.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [], loading: false }),
}));

vi.mock("@/lib/hooks/useMembers", () => ({
  useMembers: () => ({ members: [], loading: false, refresh: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import type { Message } from "@/lib/hooks/useGroupMessages";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    authorUid: "alice",
    body: "hello world",
    stickerIds: [],
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    parentMessageId: null,
    threadReplyCount: 0,
    mediaRefs: [],
    ...overrides,
  };
}

describe("MessageList — mute + block filters", () => {
  const defaultProps = {
    gid: "g1",
    messages: [] as Message[],
    loading: false,
    loadingOlder: false,
    hasMore: false,
    isLeader: false,
    onLoadOlder: vi.fn(),
  };

  it("hides messages from blocked authors entirely", async () => {
    vi.resetModules();
    vi.doMock("@/lib/hooks/useBlocks", () => ({
      useBlocks: () => ({
        isBlocked: (uid: string) => uid === "eve",
        blockedSet: new Set(["eve"]),
        blockedList: ["eve"],
        block: vi.fn(),
        unblock: vi.fn(),
        loading: false,
      }),
    }));
    vi.doMock("@/lib/hooks/useMutes", () => ({
      useMutes: () => ({
        isMuted: () => false,
        mutedSet: new Set(),
        mute: vi.fn(),
        unmute: vi.fn(),
        loading: false,
      }),
    }));
    const { MessageList: ML } = await import("@/components/chat/MessageList");
    render(
      <ML
        {...defaultProps}
        messages={[
          makeMessage({ id: "m1", body: "from-alice", authorUid: "alice" }),
          makeMessage({ id: "m2", body: "from-eve", authorUid: "eve" }),
        ]}
      />,
    );
    expect(screen.getByText("from-alice")).toBeInTheDocument();
    expect(screen.queryByText("from-eve")).not.toBeInTheDocument();
  });

  it("collapses muted-author messages until 'Show' is clicked", async () => {
    vi.resetModules();
    vi.doMock("@/lib/hooks/useBlocks", () => ({
      useBlocks: () => ({
        isBlocked: () => false,
        blockedSet: new Set(),
        blockedList: [],
        block: vi.fn(),
        unblock: vi.fn(),
        loading: false,
      }),
    }));
    vi.doMock("@/lib/hooks/useMutes", () => ({
      useMutes: () => ({
        isMuted: (uid: string) => uid === "noisy",
        mutedSet: new Set(["noisy"]),
        mute: vi.fn(),
        unmute: vi.fn(),
        loading: false,
      }),
    }));
    const { MessageList: ML } = await import("@/components/chat/MessageList");
    render(
      <ML
        {...defaultProps}
        messages={[makeMessage({ id: "m1", body: "from-noisy", authorUid: "noisy" })]}
      />,
    );
    expect(screen.queryByText("from-noisy")).not.toBeInTheDocument();
    expect(screen.getByText(/muted user/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(screen.getByText("from-noisy")).toBeInTheDocument();
  });
});
