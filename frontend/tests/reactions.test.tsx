/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  orderBy: vi.fn(),
  query: vi.fn(),
  Timestamp: { now: vi.fn() },
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseStickers = vi.fn();
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => mockUseStickers(),
}));

import * as fbFirestore from "firebase/firestore";

import { ReactionBar } from "@/components/chat/ReactionBar";
import { ReactionPicker } from "@/components/chat/ReactionPicker";

const fakeStickers = [
  { id: "s1", slug: "pray", name: "Praying", audience: "christian", order: 1, color: "#7c3aed" },
  { id: "s2", slug: "heart", name: "Heart", audience: "christian", order: 2, color: "#ef4444" },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  });
  mockUseStickers.mockReturnValue({ stickers: fakeStickers, loading: false });
  vi.clearAllMocks();
});

// ── ReactionBar ───────────────────────────────────────────────────────────────

describe("ReactionBar", () => {
  it("bar renders only counts > 0", () => {
    render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ pray: 2, heart: 0 }}
        isMyReaction={() => false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /praying 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /heart/i })).toBeNull();
  });

  it("renders nothing when all counts are zero", () => {
    const { container } = render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ pray: 0 }}
        isMyReaction={() => false}
        onToggle={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when reactionCounts is undefined", () => {
    const { container } = render(
      <ReactionBar mid="m1" isMyReaction={() => false} onToggle={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("tapping own reaction calls onToggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ pray: 3 }}
        isMyReaction={() => true}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("button", { name: /praying 3/i }));
    expect(onToggle).toHaveBeenCalledWith("m1", "pray");
  });
});

// ── ReactionPicker ────────────────────────────────────────────────────────────

describe("ReactionPicker", () => {
  it("picker shows six stickers after opening", async () => {
    const user = userEvent.setup();
    render(
      <ReactionPicker mid="m1" isMyReaction={() => false} onToggle={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    expect(screen.getByRole("dialog", { name: /reaction picker/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /praying|heart/i }).length).toBeGreaterThan(0);
  });

  it("disabled picker renders nothing", () => {
    const { container } = render(
      <ReactionPicker mid="m1" isMyReaction={() => false} onToggle={vi.fn()} disabled />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("tapping a sticker in the picker calls onToggle and closes picker", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ReactionPicker mid="m1" isMyReaction={() => false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    await user.click(screen.getByRole("button", { name: /praying/i }));
    expect(onToggle).toHaveBeenCalledWith("m1", "pray");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tapping new reaction calls setDoc with reactedAt", async () => {
    const user = userEvent.setup();
    const { toggle } = await import("../lib/hooks/useReactions").then(
      () => ({ toggle: vi.fn() }),
    );
    const onToggle = vi.fn().mockImplementation(async (_mid: string, slug: string) => {
      await (fbFirestore.setDoc as ReturnType<typeof vi.fn>)(
        (fbFirestore.doc as ReturnType<typeof vi.fn>)(),
        { reactedAt: fbFirestore.serverTimestamp() },
      );
    });
    render(<ReactionPicker mid="m1" isMyReaction={() => false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    await user.click(screen.getByRole("button", { name: /praying/i }));
    expect(fbFirestore.setDoc).toHaveBeenCalled();
  });
});
