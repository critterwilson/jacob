/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Timestamp } from "firebase/firestore";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: {}, firestore: {} }));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "bob", email: "bob@example.com", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  }),
}));

// ── useGroup ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/hooks/useGroup", () => ({
  useGroup: () => ({
    group: {
      id: "g1",
      name: "Public Study Group",
      description: "A study group",
      isPrivate: false,
      memberCount: 7,
      joinMode: "open",
    },
    loading: false,
  }),
}));

// ── useGroupMessages ──────────────────────────────────────────────────────────
const mockMessages = [
  {
    id: "m1",
    authorUid: "alice",
    body: "Hello from alice",
    stickerIds: [],
    mediaRefs: [],
    createdAt: { toMillis: () => Date.now() } as unknown as Timestamp,
    editedAt: null,
    deletedAt: null,
    parentMessageId: null,
    threadReplyCount: 0,
    mentions: [],
    reactionCounts: {},
    participants: [],
    announcedAt: null,
  },
];

vi.mock("@/lib/hooks/useGroupMessages", () => ({
  useGroupMessages: () => ({
    messages: mockMessages,
    loading: false,
    loadingOlder: false,
    hasMore: false,
    loadOlder: vi.fn(),
  }),
}));

// ── Hooks used by MessageList / MessageItem ───────────────────────────────────
vi.mock("@/lib/hooks/useBlocks", () => ({
  useBlocks: () => ({ isBlocked: () => false }),
}));
vi.mock("@/lib/hooks/useMutes", () => ({
  useMutes: () => ({ isMuted: () => false }),
}));
vi.mock("@/lib/hooks/useMembers", () => ({
  useMembers: () => ({ members: [] }),
}));
vi.mock("@/lib/hooks/useReactions", () => ({
  useReactions: () => ({
    isMyReaction: () => false,
    toggle: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [] }),
}));

// ── JoinRequestButton ─────────────────────────────────────────────────────────
vi.mock("@/components/discover/JoinRequestButton", () => ({
  JoinRequestButton: ({ joinMode }: { joinMode: string }) => (
    <button type="button">{joinMode === "open" ? "Join" : "Request to join"}</button>
  ),
}));

// ── ReportButton ──────────────────────────────────────────────────────────────
vi.mock("@/components/moderation/ReportButton", () => ({
  ReportButton: () => <button type="button">Report</button>,
}));

import ReadOnlyGroupPage from "@/app/(authed)/discover/[gid]/page";

describe("T31 — read-only group browsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("read-only page renders messages without input", async () => {
    render(<ReadOnlyGroupPage params={{ gid: "g1" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hello from alice")).toBeInTheDocument();
    });

    // No message input
    expect(screen.queryByRole("textbox", { name: /message/i })).toBeNull();
    // No send button
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });

  it("reply, edit, delete buttons not rendered in readonly mode", async () => {
    render(<ReadOnlyGroupPage params={{ gid: "g1" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hello from alice")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /^reply$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("reaction picker hidden in readonly mode", async () => {
    render(<ReadOnlyGroupPage params={{ gid: "g1" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hello from alice")).toBeInTheDocument();
    });

    // ReactionPicker renders a button with an emoji or "+" label
    expect(screen.queryByRole("button", { name: /react|emoji|add reaction/i })).toBeNull();
  });
});
