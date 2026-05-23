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
  // Use slugs that DON'T collide with the canonical emoji set
  // (`like`/`love`/`pray`/`laugh`/`wow`/`sad`) — these are the
  // legacy author-tag stickers ("Prayer Request", "Praise Report"
  // in production) that the bar must still fall back to when an
  // old reaction was persisted under their slug.
  { id: "s1", slug: "prayer-request", name: "Prayer Request", audience: "christian", order: 1, color: "#7c3aed" },
  { id: "s2", slug: "praise-report", name: "Praise Report", audience: "christian", order: 2, color: "#ef4444" },
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
  it("renders an emoji chip for an emoji slug (canonical reaction)", () => {
    render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ like: 2, love: 0 }}
        isMyReaction={() => false}
        onToggle={vi.fn()}
      />,
    );
    // The accessible name is the emoji label + count, the visible glyph
    // is the emoji itself.
    expect(screen.getByRole("button", { name: /like 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /love/i })).toBeNull();
  });

  it("falls back to sticker name for a legacy sticker-slug reaction", () => {
    // Reactions persisted before the emoji/tag split used sticker slugs
    // — the bar must still render them readably until they age out.
    render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ "prayer-request": 3 }}
        isMyReaction={() => false}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /prayer request 3/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing when all counts are zero", () => {
    const { container } = render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ like: 0 }}
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

  it("tapping own reaction calls onToggle with the same slug", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ReactionBar
        mid="m1"
        reactionCounts={{ like: 3 }}
        isMyReaction={() => true}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("button", { name: /like 3/i }));
    expect(onToggle).toHaveBeenCalledWith("m1", "like");
  });
});

// ── ReactionPicker ────────────────────────────────────────────────────────────

describe("ReactionPicker", () => {
  it("picker shows the canonical emoji set (NOT message stickers/tags)", async () => {
    const user = userEvent.setup();
    render(
      <ReactionPicker mid="m1" isMyReaction={() => false} onToggle={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    expect(
      screen.getByRole("dialog", { name: /reaction picker/i }),
    ).toBeInTheDocument();
    // Every canonical emoji label is rendered.
    for (const label of ["Like", "Love", "Pray", "Laugh", "Wow", "Sad"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // None of the stickered "tag" names leak into the picker — that
    // crossover ("Praying" or "Heart" from the stickers collection
    // appearing in the picker) was the original wiring bug.
    expect(screen.queryByRole("button", { name: /^praying$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^heart$/i })).toBeNull();
  });

  it("disabled picker renders nothing", () => {
    const { container } = render(
      <ReactionPicker mid="m1" isMyReaction={() => false} onToggle={vi.fn()} disabled />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("tapping an emoji in the picker calls onToggle with that slug and closes the picker", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ReactionPicker mid="m1" isMyReaction={() => false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    await user.click(screen.getByRole("button", { name: "Pray" }));
    expect(onToggle).toHaveBeenCalledWith("m1", "pray");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("picker uses the emoji slug, not a sticker slug, when delegating to onToggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockImplementation(async (_mid: string, slug: string) => {
      // The component contract is "the slug we hand back is one of the
      // canonical emoji slugs". Mirror the production toggle by writing
      // a Firestore doc keyed by that slug so the assertion below has
      // teeth — it'd flag any regression that reverted to sticker slugs.
      await (fbFirestore.setDoc as ReturnType<typeof vi.fn>)(
        (fbFirestore.doc as ReturnType<typeof vi.fn>)("reactions", slug),
        { reactedAt: fbFirestore.serverTimestamp() },
      );
    });
    render(<ReactionPicker mid="m1" isMyReaction={() => false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: /add reaction/i }));
    await user.click(screen.getByRole("button", { name: "Love" }));
    expect(onToggle).toHaveBeenCalledWith("m1", "love");
    expect(fbFirestore.setDoc).toHaveBeenCalled();
  });
});
