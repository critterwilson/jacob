/**
 * @vitest-environment jsdom
 *
 * MessageList tests. Sibling test files cover the same chat surface:
 *   tests/message-input.test.tsx        — MessageInput + apiPost
 *   tests/message-item.test.tsx         — MessageItem
 *   tests/message-list-filters.test.tsx — MessageList mute/block filters
 * Splitting the original 20-test chat.test.tsx into these files keeps
 * each vitest worker file under the heap pressure that combining
 * react-hook-form, zod, StickerPicker, and `vi.resetModules()` would
 * otherwise trigger.
 *
 * useGroupMessages tests live in
 * `lib/hooks/__tests__/useGroupMessages.test.ts`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
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

import { MessageList } from "@/components/chat/MessageList";
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

describe("MessageList", () => {
  const defaultProps = {
    gid: "g1",
    messages: [] as Message[],
    loading: false,
    loadingOlder: false,
    hasMore: false,
    isLeader: false,
    onLoadOlder: vi.fn(),
  };

  it("renders empty-state text when there are no messages", () => {
    render(<MessageList {...defaultProps} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("renders a message for each item", () => {
    render(
      <MessageList
        {...defaultProps}
        messages={[makeMessage({ id: "m1" }), makeMessage({ id: "m2", body: "second" })]}
      />,
    );
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("shows loading spinner when loading is true", () => {
    render(<MessageList {...defaultProps} loading={true} />);
    expect(screen.getByText(/loading messages/i)).toBeInTheDocument();
  });

  it("shows 'Load older messages' button when hasMore is true", () => {
    render(<MessageList {...defaultProps} hasMore={true} />);
    expect(
      screen.getByRole("button", { name: /load older messages/i }),
    ).toBeInTheDocument();
  });

  it("hides 'Load older messages' button when hasMore is false", () => {
    render(<MessageList {...defaultProps} hasMore={false} />);
    expect(
      screen.queryByRole("button", { name: /load older messages/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onLoadOlder when the button is clicked", () => {
    const onLoadOlder = vi.fn();
    render(<MessageList {...defaultProps} hasMore={true} onLoadOlder={onLoadOlder} />);
    fireEvent.click(
      screen.getByRole("button", { name: /load older messages/i }),
    );
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });
});

describe("MessageList — reactions wireup", () => {
  const defaultProps = {
    gid: "g1",
    messages: [] as Message[],
    loading: false,
    loadingOlder: false,
    hasMore: false,
    isLeader: false,
    onLoadOlder: vi.fn(),
  };

  it("renders ReactionBar for messages that have reactionCounts", () => {
    render(
      <MessageList
        {...defaultProps}
        messages={[
          makeMessage({
            id: "m1",
            body: "with reactions",
            reactionCounts: { "check-in": 2 },
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Reactions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check-in 2/i })).toBeInTheDocument();
  });
});
