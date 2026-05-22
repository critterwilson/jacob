/**
 * @vitest-environment jsdom
 *
 * Boards routed-page wiring:
 *  - /boards surfaces a reachable path to board creation for admins
 *    (creation lives at /admin/boards) and never offers it to members.
 *  - /boards/[boardId] mounts the NewPostForm composer, so any signed-in
 *    member on a board has a visible way to add a post.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

const mockUseParams = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => mockUseParams(),
  usePathname: () => "/boards",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
      [k: string]: unknown;
    }) => React.createElement("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseBoards = vi.fn();
vi.mock("@/lib/hooks/useBoards", () => ({
  useBoards: () => mockUseBoards(),
}));

const mockUseRoleClaims = vi.fn();
vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: () => mockUseRoleClaims(),
}));

const mockUseBoardPosts = vi.fn();
vi.mock("@/lib/hooks/useBoardPosts", () => ({
  useBoardPosts: () => mockUseBoardPosts(),
}));

const mockUseStickers = vi.fn();
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => mockUseStickers(),
  default: () => mockUseStickers(),
}));

import BoardsPage from "@/app/(authed)/boards/page";
import BoardPage from "@/app/(authed)/boards/[boardId]/page";
import type { Board } from "@/lib/hooks/useBoards";

const fakeBoard: Board = {
  boardId: "b1",
  name: "Prayer & Praise",
  slug: "prayer-praise",
  description: "Cross-group prayer requests",
  audience: "christian",
  archivedAt: null,
  postCount: 4,
};

const NON_ADMIN = { isAdmin: false, isModerator: false, isMinistryOwner: false };
const ADMIN = { isAdmin: true, isModerator: false, isMinistryOwner: false };

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  });
  mockUseBoards.mockReturnValue({ boards: [], loading: false });
  mockUseRoleClaims.mockReturnValue(NON_ADMIN);
  mockUseBoardPosts.mockReturnValue({ posts: [], loading: false });
  mockUseStickers.mockReturnValue({
    stickers: [
      { id: "s1", slug: "pray", name: "Praying", audience: "christian", order: 1, color: "#7c3aed" },
    ],
    loading: false,
  });
  mockUseParams.mockReturnValue({ boardId: "b1" });
});

// ── /boards — admin path to board creation ─────────────────────────────

describe("BoardsPage — create-board affordance", () => {
  it("admin sees a 'Manage boards' link to /admin/boards", () => {
    mockUseRoleClaims.mockReturnValue(ADMIN);
    render(<BoardsPage />);
    const link = screen.getByRole("link", { name: /manage boards/i });
    expect(link).toHaveAttribute("href", "/admin/boards");
  });

  it("admin empty state offers a 'Create the first board' CTA", () => {
    mockUseRoleClaims.mockReturnValue(ADMIN);
    render(<BoardsPage />);
    const cta = screen.getByRole("link", { name: /create the first board/i });
    expect(cta).toHaveAttribute("href", "/admin/boards");
  });

  it("non-admin sees neither create affordance", () => {
    mockUseRoleClaims.mockReturnValue(NON_ADMIN);
    render(<BoardsPage />);
    expect(screen.queryByRole("link", { name: /manage boards/i })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /create the first board/i }),
    ).toBeNull();
    expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    expect(screen.getByText(/check back soon/i)).toBeInTheDocument();
  });

  it("renders board cards when boards exist", () => {
    mockUseBoards.mockReturnValue({ boards: [fakeBoard], loading: false });
    render(<BoardsPage />);
    const card = screen.getByRole("link", { name: /prayer & praise/i });
    expect(card).toHaveAttribute("href", "/boards/b1");
  });
});

// ── /boards/[boardId] — post composer is mounted ───────────────────────

describe("BoardPage — post composer wiring", () => {
  it("mounts the NewPostForm composer for a signed-in member", () => {
    mockUseBoards.mockReturnValue({ boards: [fakeBoard], loading: false });
    render(<BoardPage />);
    // The composer is a <form aria-label="New board post"> — its
    // presence proves the board page exposes a way to post.
    expect(
      screen.getByRole("form", { name: /new board post/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/post body/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^post$/i }),
    ).toBeInTheDocument();
  });

  it("shows the post composer even on an empty board", () => {
    mockUseBoards.mockReturnValue({ boards: [fakeBoard], loading: false });
    mockUseBoardPosts.mockReturnValue({ posts: [], loading: false });
    render(<BoardPage />);
    expect(
      screen.getByRole("form", { name: /new board post/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument();
  });
});
