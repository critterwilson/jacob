/**
 * @vitest-environment jsdom
 *
 * Regression coverage for C-FRONT-1: clicking a ReactionBar chip used
 * to mutate a `useRef`, which never triggered a re-render. The button's
 * `aria-pressed` state didn't flip until the next 10s poll. The hook's
 * own ref-based assertions never caught this — only a render-time
 * consumer test does.
 *
 * Also covers M-FRONT-4: the chip count bumps locally on toggle (+1
 * for react, -1 for unreact) and reconciles when the next message
 * stream lands. Rolls back on API error.
 */
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { uid: "alice" } }),
}));

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue({}),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const MOCK_STICKERS = [
  { id: "amen", slug: "amen", name: "Amen", audience: "christian", order: 1, color: "#0" },
  { id: "fire", slug: "fire", name: "Fire", audience: "christian", order: 2, color: "#0" },
];
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: MOCK_STICKERS, loading: false }),
}));

import { apiPost, apiDelete } from "@/lib/api";
import { ReactionBar } from "@/components/chat/ReactionBar";
import type { Message } from "@/lib/hooks/useGroupMessages";
import { useReactions } from "@/lib/hooks/useReactions";

const mockApiPost = apiPost as unknown as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as unknown as ReturnType<typeof vi.fn>;

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  authorUid: "bob",
  body: "hi",
  stickerIds: [],
  createdAt: "2026-05-01T00:00:01Z",
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  threadReplyCount: 0,
  mediaRefs: [],
  ...overrides,
});

// Canonical regression consumer — uses ONLY the original
// `isMyReaction` / `toggle` API. The ref-based hook mutated a Set
// here without triggering a re-render, so `aria-pressed` stayed
// "false" after the click. The state-based fix re-renders this
// consumer on click.
function MinimalConsumer({ messages }: { messages: Message[] }) {
  const { isMyReaction, toggle } = useReactions("g1", messages);
  const m = messages[0];
  return (
    <ReactionBar
      mid={m.id}
      reactionCounts={m.reactionCounts}
      isMyReaction={isMyReaction}
      onToggle={(mid, slug) => void toggle(mid, slug)}
    />
  );
}

// Full consumer that exercises the count-merging API too.
function HookConsumer({ messages }: { messages: Message[] }) {
  const { isMyReaction, toggle, mergeReactionCounts } = useReactions("g1", messages);
  const m = messages[0];
  return (
    <ReactionBar
      mid={m.id}
      reactionCounts={mergeReactionCounts(m.id, m.reactionCounts)}
      isMyReaction={isMyReaction}
      onToggle={(mid, slug) => void toggle(mid, slug)}
    />
  );
}

beforeEach(() => {
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue({});
  mockApiDelete.mockReset();
  mockApiDelete.mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReactionBar + useReactions (C-FRONT-1)", () => {
  it("flips aria-pressed synchronously when consumer uses only isMyReaction", async () => {
    // This is THE regression test. The old ref-based hook updated a
    // mutable Set on click; React saw no state change and never
    // re-rendered this consumer. The new state-based hook flips
    // aria-pressed in the same render cycle.
    const messages = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: { amen: 3 } }),
    ];
    render(<MinimalConsumer messages={messages} />);
    const btn = screen.getByRole("button", { name: /amen 3/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("bumps the chip count locally and reconciles on next poll", async () => {
    const initial = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: { amen: 3 } }),
    ];
    const { rerender } = render(<HookConsumer messages={initial} />);
    const btn = screen.getByRole("button", { name: /amen 3/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    // Local bump.
    expect(screen.getByRole("button", { name: /amen 4/i })).toBeInTheDocument();
    // Server poll arrives, confirms the reaction. Chip stays at 4 — the
    // optimistic delta is dropped (server is authoritative).
    rerender(
      <HookConsumer
        messages={[
          baseMessage({
            id: "m1",
            myReactions: ["amen"],
            reactionCounts: { amen: 4 },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /amen 4/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rolls back the chip count if the API call fails", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("network"));
    const messages = [
      baseMessage({ id: "m1", myReactions: [], reactionCounts: { amen: 3 } }),
    ];
    render(<HookConsumer messages={messages} />);
    const btn = screen.getByRole("button", { name: /amen 3/i });
    await act(async () => {
      fireEvent.click(btn);
      // flush the rejected promise.
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /amen 3/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("decrements the chip on un-react and flips aria-pressed off", async () => {
    const messages = [
      baseMessage({ id: "m1", myReactions: ["amen"], reactionCounts: { amen: 4 } }),
    ];
    render(<HookConsumer messages={messages} />);
    // Wait one tick so the hydration effect runs and isMyReaction becomes true.
    await act(async () => { await Promise.resolve(); });
    const btn = screen.getByRole("button", { name: /amen 4/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(btn);
    });
    const after = screen.getByRole("button", { name: /amen 3/i });
    expect(after).toHaveAttribute("aria-pressed", "false");
    expect(mockApiDelete).toHaveBeenCalled();
  });
});
