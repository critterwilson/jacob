/**
 * @vitest-environment jsdom
 *
 * Dismissal contract for the message-interaction menus in chat.
 *
 * Christopher reported that the action pill / reaction picker on a
 * message would sometimes stick open and never dismiss — making
 * messages underneath unreadable. The fix moved per-menu open state
 * into a shared `MessageMenuContext` so only one menu can be open at
 * once and outside-tap / scroll / Esc / opening another menu all
 * reliably close it. These tests pin that contract.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: vi.fn().mockResolvedValue("tok"),
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [], loading: false }),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPut: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue({}),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { MessageItem } from "@/components/chat/MessageItem";
import { MessageMenuProvider } from "@/components/chat/MessageMenuContext";
import type { Message } from "@/lib/hooks/useGroupMessages";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    authorUid: "alice",
    body: "hello",
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

function renderTwoMessages() {
  return render(
    <MessageMenuProvider>
      <MessageItem
        gid="g1"
        message={makeMessage({ id: "m1", authorUid: "bob", body: "first" })}
        isLeader={false}
        isMyReaction={() => false}
        onToggleReaction={vi.fn()}
      />
      <MessageItem
        gid="g1"
        message={makeMessage({ id: "m2", authorUid: "carol", body: "second" })}
        isLeader={false}
        isMyReaction={() => false}
        onToggleReaction={vi.fn()}
      />
    </MessageMenuProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Message menu dismissal", () => {
  it("opens the More menu and closes it on Esc", async () => {
    const user = userEvent.setup();
    render(
      <MessageMenuProvider>
        <MessageItem
          gid="g1"
          message={makeMessage({ authorUid: "bob" })}
          isLeader={false}
        />
      </MessageMenuProvider>,
    );
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu", { name: /more actions/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: /more actions/i })).toBeNull();
  });

  it("closes the open More menu when the user clicks outside any message", async () => {
    const user = userEvent.setup();
    render(
      <MessageMenuProvider>
        <MessageItem
          gid="g1"
          message={makeMessage({ authorUid: "bob" })}
          isLeader={false}
        />
        <button type="button" data-testid="outside">
          outside
        </button>
      </MessageMenuProvider>,
    );
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu", { name: /more actions/i })).toBeInTheDocument();
    // Use fireEvent.mouseDown so we hit the document-level mousedown
    // handler the provider installs.
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu", { name: /more actions/i })).toBeNull();
  });

  it("opening a second message's reaction picker closes the first's More menu", async () => {
    const user = userEvent.setup();
    renderTwoMessages();
    const [moreA, moreB] = screen.getAllByRole("button", { name: /more actions/i });
    expect(moreA).toBeDefined();
    expect(moreB).toBeDefined();

    // Open the first message's More menu.
    await user.click(moreA);
    expect(screen.getByRole("menu", { name: /more actions/i })).toBeInTheDocument();

    // Open the second message's React picker.
    const [, reactB] = screen.getAllByRole("button", { name: /add reaction/i });
    await user.click(reactB);

    // The first menu must have closed — only one menu at a time across
    // the whole chat surface.
    expect(screen.queryByRole("menu", { name: /more actions/i })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: /reaction picker/i }),
    ).toBeInTheDocument();
  });

  it("picking an item from the More menu closes the menu", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    render(
      <MessageMenuProvider>
        <MessageItem
          gid="g1"
          message={makeMessage({ authorUid: "bob" })}
          isLeader={true}
          onTogglePin={onTogglePin}
        />
      </MessageMenuProvider>,
    );
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /^pin$/i }));
    expect(onTogglePin).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("menu", { name: /more actions/i })).toBeNull();
  });

  it("picking an emoji from the reaction picker closes the picker", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    render(
      <MessageMenuProvider>
        <MessageItem
          gid="g1"
          message={makeMessage({ authorUid: "bob" })}
          isLeader={false}
          isMyReaction={() => false}
          onToggleReaction={onToggleReaction}
        />
      </MessageMenuProvider>,
    );
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    await user.click(screen.getByRole("button", { name: "Like" }));
    expect(onToggleReaction).toHaveBeenCalledWith("m1", "like");
    expect(screen.queryByRole("dialog", { name: /reaction picker/i })).toBeNull();
  });
});
