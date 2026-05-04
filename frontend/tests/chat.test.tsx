/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";


// ── Next.js router ──────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

// ── Firebase singletons ─────────────────────────────────────────────────────
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

// ── firebase/firestore ──────────────────────────────────────────────────────
const mockUnsubscribe = vi.fn();
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
  startAfter: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));

import * as fbFirestore from "firebase/firestore";

// ── Auth context ─────────────────────────────────────────────────────────────
const mockGetIdToken = vi.fn().mockResolvedValue("fake-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: mockGetIdToken,
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// ── useStickers ─────────────────────────────────────────────────────────────
const MOCK_STICKERS = [
  { id: "check-in", slug: "check-in", name: "Check-In", audience: "christian", order: 1, color: "#2563EB" },
  { id: "prayer-request", slug: "prayer-request", name: "Prayer Request", audience: "christian", order: 2, color: "#7C3AED" },
];

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: MOCK_STICKERS, loading: false }),
}));

// MessageInput consumes useMembers; default to an empty list so the
// mention machinery doesn't accidentally look up apiGet, whose mock is
// shared with the message-list tests.
vi.mock("@/lib/hooks/useMembers", () => ({
  useMembers: () => ({ members: [], loading: false, refresh: vi.fn() }),
}));

import { MessageInput } from "@/components/chat/MessageInput";
import { MessageItem } from "@/components/chat/MessageItem";
import { MessageList } from "@/components/chat/MessageList";
import type { Message } from "@/lib/hooks/useGroupMessages";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    authorUid: "alice",
    body: "hello world",
    stickerIds: ["check-in"],
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    parentMessageId: null,
    threadReplyCount: 0,
    mediaRefs: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default onSnapshot returns unsubscribe immediately
  vi.mocked(fbFirestore.onSnapshot).mockReturnValue(
    mockUnsubscribe as unknown as ReturnType<typeof fbFirestore.onSnapshot>,
  );
  vi.mocked(fbFirestore.query).mockReturnValue({} as ReturnType<typeof fbFirestore.query>);
  vi.mocked(fbFirestore.collection).mockReturnValue(
    {} as ReturnType<typeof fbFirestore.collection>,
  );
  vi.mocked(fbFirestore.where).mockReturnValue(
    {} as ReturnType<typeof fbFirestore.where>,
  );
  vi.mocked(fbFirestore.orderBy).mockReturnValue(
    {} as ReturnType<typeof fbFirestore.orderBy>,
  );
  vi.mocked(fbFirestore.limit).mockReturnValue(
    {} as ReturnType<typeof fbFirestore.limit>,
  );
  vi.mocked(fbFirestore.doc).mockReturnValue(
    {} as ReturnType<typeof fbFirestore.doc>,
  );
});

// useGroupMessages tests moved to `lib/hooks/__tests__/useGroupMessages.test.ts`
// to keep them isolated from the MessageInput / MessageList tests below
// (which use `vi.resetModules()` and would tangle with the polling
// hook's setInterval lifecycle).

// ── MessageInput ─────────────────────────────────────────────────────────────

describe("MessageInput", () => {
  it("shows validation error when body and attachments are both empty", async () => {
    render(<MessageInput gid="g1" />);
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(
      await screen.findByText(/add a message or a photo/i),
    ).toBeInTheDocument();
    expect(fbFirestore.addDoc).not.toHaveBeenCalled();
  });

  it("shows validation error when body exceeds 4000 characters", async () => {
    render(<MessageInput gid="g1" />);
    // Set value directly to bypass maxLength DOM constraint.
    fireEvent.change(screen.getByLabelText(/message body/i), {
      target: { value: "a".repeat(4001) },
    });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/4000 characters/i)).toBeInTheDocument();
    expect(fbFirestore.addDoc).not.toHaveBeenCalled();
  });

  it("defaults to check-in sticker when no sticker selected", async () => {
    vi.mocked(fbFirestore.addDoc).mockResolvedValue(
      { id: "new-msg" } as Awaited<ReturnType<typeof fbFirestore.addDoc>>,
    );

    render(<MessageInput gid="g1" />);
    await userEvent.type(screen.getByLabelText(/message body/i), "Hello!");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(fbFirestore.addDoc).toHaveBeenCalledOnce());
    const [, data] = vi.mocked(fbFirestore.addDoc).mock.calls[0];
    expect((data as Record<string, unknown>).stickerIds).toEqual(["check-in"]);
  });

  it("uses selected stickers when provided", async () => {
    vi.mocked(fbFirestore.addDoc).mockResolvedValue(
      { id: "new-msg" } as Awaited<ReturnType<typeof fbFirestore.addDoc>>,
    );

    render(<MessageInput gid="g1" />);
    // Click the Prayer Request sticker button
    await userEvent.click(
      screen.getByRole("button", { name: "Prayer Request" }),
    );
    await userEvent.type(screen.getByLabelText(/message body/i), "Please pray");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(fbFirestore.addDoc).toHaveBeenCalledOnce());
    const [, data] = vi.mocked(fbFirestore.addDoc).mock.calls[0];
    expect((data as Record<string, unknown>).stickerIds).toContain(
      "prayer-request",
    );
  });

  it("shows error message when addDoc fails", async () => {
    vi.mocked(fbFirestore.addDoc).mockRejectedValue(new Error("network error"));

    render(<MessageInput gid="g1" />);
    await userEvent.type(screen.getByLabelText(/message body/i), "test");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/failed to send/i)).toBeInTheDocument();
  });
});

// ── MessageItem ──────────────────────────────────────────────────────────────

describe("MessageItem", () => {
  it("renders body text for a normal message", () => {
    render(<MessageItem gid="g1" message={makeMessage()} isLeader={false} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders [message removed] for a deleted message", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({
          deletedAt: new Date().toISOString(),
        })}
        isLeader={false}
      />,
    );
    expect(screen.getByText(/\[message removed\]/i)).toBeInTheDocument();
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  it("shows Edit and Delete buttons for the author on hover (within 15 min)", () => {
    render(<MessageItem gid="g1" message={makeMessage()} isLeader={false} />);
    // Buttons exist in the DOM (hidden by CSS group-hover, but present)
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("does not show Edit button when message is older than 15 minutes", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({
          createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        })}
        isLeader={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    // Delete still available
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows Delete button for a leader on another user's message", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ authorUid: "bob" })}
        isLeader={true}
      />,
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    // Edit not shown (leader can't edit others' messages)
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("renders sticker badges", () => {
    render(<MessageItem gid="g1" message={makeMessage()} isLeader={false} />);
    expect(screen.getByText("Check-In")).toBeInTheDocument();
  });

  it("shows (edited) label when editedAt is set", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({
          editedAt: new Date().toISOString(),
        })}
        isLeader={false}
      />,
    );
    expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
  });
});

// ── MessageList ──────────────────────────────────────────────────────────────

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

  it("calls onLoadOlder when the button is clicked", async () => {
    const onLoadOlder = vi.fn();
    render(<MessageList {...defaultProps} hasMore={true} onLoadOlder={onLoadOlder} />);
    await userEvent.click(
      screen.getByRole("button", { name: /load older messages/i }),
    );
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });
});

// ── T26 wireup — MessageList renders ReactionBar for messages with counts ──

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
    // ReactionBar wraps chips with aria-label="Reactions".
    expect(screen.getByLabelText("Reactions")).toBeInTheDocument();
    // The chip itself has an aria-label combining sticker name + count.
    expect(
      screen.getByRole("button", { name: /check-in 2/i }),
    ).toBeInTheDocument();
  });
});

// ── T21 — MessageList filters muted + blocked authors ───────────────────────

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
        messages={[
          makeMessage({ id: "m1", body: "from-noisy", authorUid: "noisy" }),
        ]}
      />,
    );
    expect(screen.queryByText("from-noisy")).not.toBeInTheDocument();
    expect(screen.getByText(/muted user/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(screen.getByText("from-noisy")).toBeInTheDocument();
  });
});
