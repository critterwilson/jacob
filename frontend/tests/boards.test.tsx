/**
 * @vitest-environment jsdom
 *
 * T32 — frontend tests for boards components and the new MessageRef helper.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reactionPath, refToString, type MessageRef } from "@/lib/messageRef";

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

const addDocMock = vi.fn().mockResolvedValue({ id: "p1" });

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  addDoc: (...args: unknown[]) => addDocMock(...args),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  Timestamp: { now: vi.fn() },
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseStickers = vi.fn();
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => mockUseStickers(),
  default: () => mockUseStickers(),
}));

import { BoardCard } from "@/components/boards/BoardCard";
import { NewPostForm } from "@/components/boards/NewPostForm";
import { ReplyList } from "@/components/boards/ReplyList";
import type { Board } from "@/lib/hooks/useBoards";
import type { BoardReply } from "@/lib/hooks/useBoardPost";

const fakeBoard: Board = {
  boardId: "b1",
  name: "Prayer & Praise",
  slug: "prayer-praise",
  description: "Cross-group prayer requests",
  audience: "christian",
  archivedAt: null,
  postCount: 4,
};

const fakeStickers = [
  { id: "s1", slug: "pray", name: "Praying", audience: "christian", order: 1, color: "#7c3aed" },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  });
  mockUseStickers.mockReturnValue({ stickers: fakeStickers, loading: false });
  addDocMock.mockClear();
});

// ── messageRef helper ──────────────────────────────────────────────────

describe("messageRef helpers", () => {
  it("group_message → groups path", () => {
    const ref: MessageRef = { kind: "group_message", gid: "g1", mid: "m1" };
    expect(reactionPath(ref, "pray", "u")).toEqual([
      "groups", "g1", "messages", "m1", "reactions", "pray", "users", "u",
    ]);
    expect(refToString(ref)).toBe("groups/g1/messages/m1");
  });

  it("board_post → boards path", () => {
    const ref: MessageRef = { kind: "board_post", boardId: "b1", postId: "p1" };
    expect(reactionPath(ref, "heart", "u")).toEqual([
      "boards", "b1", "posts", "p1", "reactions", "heart", "users", "u",
    ]);
    expect(refToString(ref)).toBe("boards/b1/posts/p1");
  });
});

// ── BoardCard ──────────────────────────────────────────────────────────

describe("BoardCard", () => {
  it("renders name, description, and post count", () => {
    render(<BoardCard board={fakeBoard} />);
    expect(screen.getByText("Prayer & Praise")).toBeInTheDocument();
    expect(screen.getByText("Cross-group prayer requests")).toBeInTheDocument();
    expect(screen.getByText("4 posts")).toBeInTheDocument();
  });

  it("singular post count when count == 1", () => {
    render(<BoardCard board={{ ...fakeBoard, postCount: 1 }} />);
    expect(screen.getByText("1 post")).toBeInTheDocument();
  });

  it("links to the board page", () => {
    render(<BoardCard board={fakeBoard} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/boards/b1");
  });
});

// ── NewPostForm ────────────────────────────────────────────────────────

describe("NewPostForm", () => {
  it("posts to firestore with sticker + body", async () => {
    const user = userEvent.setup();
    render(<NewPostForm boardId="b1" />);

    // Pick the sticker.
    await user.click(screen.getByRole("button", { name: /praying/i }));
    await user.type(screen.getByLabelText(/post body/i), "Lord, please heal");
    await user.click(screen.getByRole("button", { name: /^post$/i }));

    await waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(1));
    const [, payload] = addDocMock.mock.calls[0];
    expect(payload).toMatchObject({
      authorUid: "alice",
      body: "Lord, please heal",
      stickerIds: ["pray"],
      mediaRefs: [],
      replyCount: 0,
      reactionCounts: {},
    });
  });

  it("rejects empty sticker selection", async () => {
    const user = userEvent.setup();
    render(<NewPostForm boardId="b1" />);
    await user.type(screen.getByLabelText(/post body/i), "Hello");
    await user.click(screen.getByRole("button", { name: /^post$/i }));
    expect(addDocMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/pick at least one sticker/i)).toBeInTheDocument();
  });

  it("archived board disables the form", () => {
    render(<NewPostForm boardId="b1" archived />);
    expect(screen.getByText(/archived/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^post$/i })).toBeNull();
  });
});

// ── ReplyList ──────────────────────────────────────────────────────────

describe("ReplyList", () => {
  const baseReply = (over: Partial<BoardReply>): BoardReply => ({
    replyId: over.replyId ?? "r1",
    authorUid: "bob",
    body: "Amen.",
    stickerIds: [],
    mediaRefs: [],
    createdAt: { toDate: () => new Date(0) } as never,
    editedAt: null,
    deletedAt: null,
    ...over,
  });

  it("renders empty state when no replies", () => {
    render(<ReplyList replies={[]} />);
    expect(screen.getByText(/no replies yet/i)).toBeInTheDocument();
  });

  it("filters out soft-deleted replies", () => {
    render(
      <ReplyList
        replies={[
          baseReply({ replyId: "r1", body: "Visible" }),
          baseReply({
            replyId: "r2",
            body: "Hidden",
            deletedAt: { toDate: () => new Date(0) } as never,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("shows hidden moderation banner instead of body", () => {
    render(
      <ReplyList
        replies={[
          baseReply({
            replyId: "r1",
            body: "naughty content",
            moderation: { state: "hidden", reasons: ["Toxic"] },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/hidden by automated moderation/i)).toBeInTheDocument();
    expect(screen.queryByText(/naughty content/i)).toBeNull();
  });
});
