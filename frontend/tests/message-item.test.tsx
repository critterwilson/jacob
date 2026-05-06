/**
 * @vitest-environment jsdom
 *
 * MessageItem tests, split out of chat.test.tsx (the file's cumulative
 * memory exceeded the vitest worker's heap when MessageInput +
 * MessageItem + MessageList tests were all queued together).
 */
import { render, screen } from "@testing-library/react";
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

const MOCK_STICKERS = [
  { id: "check-in", slug: "check-in", name: "Check-In", audience: "christian", order: 1, color: "#2563EB" },
];

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: MOCK_STICKERS, loading: false }),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  // MessageBody internally calls useUnfurl which hits POST /api/unfurl.
  // Default to a benign resolved value so render-only tests don't
  // explode when the body contains a URL.
  apiPost: vi.fn().mockResolvedValue({
    url: "",
    title: null,
    description: null,
    imageUrl: null,
    siteName: null,
  }),
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

describe("MessageItem", () => {
  it("renders body text for a normal message", () => {
    render(<MessageItem gid="g1" message={makeMessage()} isLeader={false} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders [message removed] for a deleted message", () => {
    render(
      <MessageItem
        gid="g1"
        message={makeMessage({ deletedAt: new Date().toISOString() })}
        isLeader={false}
      />,
    );
    expect(screen.getByText(/\[message removed\]/i)).toBeInTheDocument();
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  it("shows Edit and Delete buttons for the author on hover (within 15 min)", () => {
    render(<MessageItem gid="g1" message={makeMessage()} isLeader={false} />);
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
        message={makeMessage({ editedAt: new Date().toISOString() })}
        isLeader={false}
      />,
    );
    expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
  });

  it("renders markdown bold from the message body (C-FRONT-2)", () => {
    // Pre-fix, MessageItem rendered the body as plain text with a
    // `whitespace-pre-wrap` paragraph — `**bold**` shipped to users as
    // literal asterisks. MessageBody is now wired in so markdown
    // tokens become real HTML.
    const { container } = render(
      <MessageItem
        gid="g1"
        message={makeMessage({ body: "this is **bold** text" })}
        isLeader={false}
      />,
    );
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
    // Author should NOT see literal asterisks anywhere in the rendered
    // body.
    expect(container.textContent).not.toMatch(/\*\*bold\*\*/);
  });

  it("autolinks URLs in the body (C-FRONT-2)", () => {
    const { container } = render(
      <MessageItem
        gid="g1"
        message={makeMessage({ body: "see https://example.com" })}
        isLeader={false}
      />,
    );
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("renders mention badges and preserves markdown around them (C-FRONT-2)", () => {
    const { container } = render(
      <MessageItem
        gid="g1"
        message={makeMessage({
          body: "**hello** @Bob Smith and friends",
          mentions: ["bob"],
        })}
        members={[{ uid: "bob", displayName: "Bob Smith", photoURL: null }]}
        isLeader={false}
      />,
    );
    // Markdown still applied around the mention.
    expect(container.querySelector("strong")?.textContent).toBe("hello");
    // Mention rendered as a badge with @-prefix.
    expect(container.textContent).toContain("@Bob Smith");
    expect(container.textContent).toContain("and friends");
  });
});
