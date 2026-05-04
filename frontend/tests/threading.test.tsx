/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

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

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiPost as apiPostExport } from "@/lib/api";
const apiPostMock = apiPostExport as unknown as ReturnType<typeof vi.fn>;

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: vi.fn().mockResolvedValue("fake-token"),
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({
    stickers: [
      { id: "check-in", slug: "check-in", name: "Check-In", audience: "christian", order: 1, color: "#2563EB" },
    ],
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/useThreadMessages", () => ({
  useThreadMessages: vi.fn(() => ({
    messages: [],
    loading: false,
    loadingOlder: false,
    hasMore: false,
    loadOlder: vi.fn(),
  })),
}));

import { useThreadMessages } from "@/lib/hooks/useThreadMessages";
import { ThreadReplyInput } from "@/components/chat/ThreadReplyInput";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { MessageItem } from "@/components/chat/MessageItem";
import type { Message } from "@/lib/hooks/useGroupMessages";

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

// ── useThreadMessages ─────────────────────────────────────────────────────────
// The hook is structurally identical to useGroupMessages (already unit-tested
// in chat.test.tsx). Here we verify the contract via the ThreadPanel component.

// ── ThreadReplyInput ──────────────────────────────────────────────────────────

describe("ThreadReplyInput", () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    apiPostMock.mockResolvedValue({ id: "reply1" });
  });

  it("shows validation error when reply body is empty", async () => {
    render(
      <ThreadReplyInput
        gid="g1"
        parentMessageId="m1"
        parentStickerIds={["check-in"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /reply/i }));
    expect(await screen.findByText(/cannot be empty/i)).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("calls apiPost once when 'Also post to channel' is unchecked", async () => {
    render(
      <ThreadReplyInput
        gid="g1"
        parentMessageId="m1"
        parentStickerIds={["check-in"]}
      />,
    );
    await userEvent.type(screen.getByLabelText(/reply body/i), "Great point!");
    await userEvent.click(screen.getByRole("button", { name: /reply/i }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    const [path, data] = apiPostMock.mock.calls[0];
    expect(path).toBe("/api/groups/g1/messages");
    expect((data as Record<string, unknown>).parentMessageId).toBe("m1");
    expect((data as Record<string, unknown>).stickerIds).toEqual(["check-in"]);
  });

  it("calls apiPost twice when 'Also post to channel' is checked", async () => {
    render(
      <ThreadReplyInput
        gid="g1"
        parentMessageId="m1"
        parentStickerIds={["check-in"]}
      />,
    );
    await userEvent.type(screen.getByLabelText(/reply body/i), "Great point!");
    await userEvent.click(screen.getByRole("checkbox", { name: /also post to channel/i }));
    await userEvent.click(screen.getByRole("button", { name: /reply/i }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));

    const calls = apiPostMock.mock.calls;
    const replyCall = calls[0][1] as Record<string, unknown>;
    const repostCall = calls[1][1] as Record<string, unknown>;

    expect(replyCall.parentMessageId).toBe("m1");
    expect(repostCall.parentMessageId).toBeNull();
    expect(repostCall.repostOfThread).toBe("m1");
  });

  it("shows error when apiPost fails", async () => {
    apiPostMock.mockReset();
    apiPostMock.mockRejectedValueOnce(new Error("network error"));

    render(
      <ThreadReplyInput
        gid="g1"
        parentMessageId="m1"
        parentStickerIds={[]}
      />,
    );
    await userEvent.type(screen.getByLabelText(/reply body/i), "test");
    await userEvent.click(screen.getByRole("button", { name: /reply/i }));

    expect(await screen.findByText(/failed to send reply/i)).toBeInTheDocument();
  });
});

// ── MessageItem thread affordances ───────────────────────────────────────────

describe("MessageItem thread affordances", () => {
  it("does not show reply count link when threadReplyCount is 0", () => {
    const onReply = vi.fn();
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ threadReplyCount: 0 })}
        isLeader={false}
        onReply={onReply}
      />,
    );
    // No "N replies" count button — only the hover "Reply" action button
    expect(screen.queryByText(/\d+ repl/i)).not.toBeInTheDocument();
  });

  it("shows reply count when threadReplyCount > 0", () => {
    const onReply = vi.fn();
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ threadReplyCount: 3 })}
        isLeader={false}
        onReply={onReply}
      />,
    );
    expect(screen.getByText(/3 replies/i)).toBeInTheDocument();
  });

  it("shows singular 'reply' when threadReplyCount is 1", () => {
    const onReply = vi.fn();
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ threadReplyCount: 1 })}
        isLeader={false}
        onReply={onReply}
      />,
    );
    expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
  });

  it("calls onReply when reply count link is clicked", async () => {
    const onReply = vi.fn();
    const message = makeMessage({ threadReplyCount: 2 });
    render(
      <MessageItem
        gid="g1"
        message={message}
        isLeader={false}
        onReply={onReply}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /2 replies/i }));
    expect(onReply).toHaveBeenCalledWith(message);
  });

  it("shows Reply button in hover toolbar for top-level messages when onReply is provided", () => {
    const onReply = vi.fn();
    render(
      <MessageItem
        gid="g1"
        message={makeMessage()}
        isLeader={false}
        onReply={onReply}
      />,
    );
    expect(screen.getByRole("button", { name: /^reply$/i })).toBeInTheDocument();
  });

  it("does not show Reply button for thread replies (parentMessageId set)", () => {
    const onReply = vi.fn();
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ parentMessageId: "parent1" })}
        isLeader={false}
        onReply={onReply}
      />,
    );
    expect(screen.queryByRole("button", { name: /^reply$/i })).not.toBeInTheDocument();
  });

  it("shows unread dot when user has participated in the thread", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ threadReplyCount: 2, participants: ["alice"] })}
        isLeader={false}
        onReply={vi.fn()}
        currentUserUid="alice"
      />,
    );
    expect(screen.getByRole("button", { name: /2 replies, open thread/i })).toBeInTheDocument();
    // The dot is aria-hidden but the button label includes the participation context
  });

  it("does not show unread dot when user has not participated", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ threadReplyCount: 2, participants: ["bob"] })}
        isLeader={false}
        onReply={vi.fn()}
        currentUserUid="alice"
      />,
    );
    // Button exists but no dot (aria-hidden element absent)
    expect(screen.getByText(/2 replies/i)).toBeInTheDocument();
  });
});

// ── ThreadPanel ───────────────────────────────────────────────────────────────

describe("ThreadPanel", () => {
  it("renders empty-state text when there are no replies", () => {
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage()}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/no replies yet/i)).toBeInTheDocument();
  });

  it("renders the original message in the panel", () => {
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage({ body: "parent body" })}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("parent body")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage()}
        isLeader={false}
        currentUserUid="alice"
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /close thread/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows reply messages when useThreadMessages returns data", () => {
    vi.mocked(useThreadMessages).mockReturnValueOnce({
      messages: [
        makeMessage({
          id: "r1",
          authorUid: "bob",
          body: "great thread reply",
          parentMessageId: "m1",
        }),
      ],
      loading: false,
      loadingOlder: false,
      hasMore: false,
      loadOlder: vi.fn(),
    });

    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage()}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("great thread reply")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    vi.mocked(useThreadMessages).mockReturnValueOnce({
      messages: [],
      loading: true,
      loadingOlder: false,
      hasMore: false,
      loadOlder: vi.fn(),
    });

    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage()}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/loading replies/i)).toBeInTheDocument();
  });

  it("shows unread dot in panel header when user has participated", () => {
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage({ participants: ["alice"] })}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/you have participated in this thread/i),
    ).toBeInTheDocument();
  });

  it("does not show unread dot when user has not participated", () => {
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={makeMessage({ participants: ["bob"] })}
        isLeader={false}
        currentUserUid="alice"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByLabelText(/you have participated in this thread/i),
    ).not.toBeInTheDocument();
  });
});
