/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: {}, firestore: {} }));

const mockGetIdToken = vi.fn().mockResolvedValue("fake-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", getIdToken: mockGetIdToken },
    loading: false,
  }),
}));

// ── useDiscoverGroups mock ───────────────────────────────────────────────────
const mockGroups = [
  {
    gid: "g1",
    name: "Grace & Truth",
    description: "A study group",
    memberCount: 12,
    audience: "christian",
    joinMode: "open",
    leaderUids: ["alice"],
    stickerMixSnapshot: [],
  },
  {
    gid: "g2",
    name: "Prayer Warriors",
    description: "",
    memberCount: 5,
    audience: "christian",
    joinMode: "request",
    leaderUids: ["bob"],
    stickerMixSnapshot: [],
  },
];

const mockLoad = vi.fn();
const mockLoadMore = vi.fn();

vi.mock("@/lib/hooks/useDiscoverGroups", () => ({
  useDiscoverGroups: (params: { audience?: string }) => ({
    state: { status: "ok", groups: mockGroups, nextCursor: null },
    load: mockLoad,
    loadMore: mockLoadMore,
  }),
}));

import DiscoverPage from "@/app/(authed)/discover/page";

beforeEach(() => {
  mockLoad.mockClear();
  mockLoadMore.mockClear();
});

describe("DiscoverPage", () => {
  it("discover page renders cards", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Grace & Truth")).toBeInTheDocument();
      expect(screen.getByText("Prayer Warriors")).toBeInTheDocument();
    });
  });

  it("audience filter changes query", async () => {
    const user = userEvent.setup();
    render(<DiscoverPage />);

    await waitFor(() => screen.getByRole("group", { name: /filter by audience/i }));
    const bjjBtn = screen.getByRole("button", { name: "BJJ" });
    await user.click(bjjBtn);
    expect(bjjBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("Join button calls join-request endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ joined: true }),
    });

    const user = userEvent.setup();
    render(<DiscoverPage />);

    await waitFor(() => screen.getAllByRole("button", { name: "Join" }));
    const joinBtns = screen.getAllByRole("button", { name: "Join" });
    await user.click(joinBtns[0]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/groups/g1/join-requests"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Request to join button surfaces optional message field", async () => {
    const user = userEvent.setup();
    render(<DiscoverPage />);

    await waitFor(() => screen.getAllByText("Request to join"));
    const reqBtn = screen.getAllByRole("button", { name: "Request to join" })[0];
    await user.click(reqBtn);

    expect(screen.getByPlaceholderText(/optional message/i)).toBeInTheDocument();
  });
});
