/**
 * @vitest-environment jsdom
 *
 * ADR 0011 — frontend tests for the central ministry feed surface.
 * Covers: read view rendering (incl. pinned badge), "New post" button
 * visibility gated on the `ministry_owner` custom claim, compose page
 * role-gating, and the post-submit POST payload.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  usePathname: () => "/feed",
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiGetConditional: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseMinistryOwner = vi.fn();
vi.mock("@/lib/hooks/useMinistryOwner", () => ({
  useMinistryOwner: () => mockUseMinistryOwner(),
}));

const mockUseMinistryFeed = vi.fn();
vi.mock("@/lib/hooks/useMinistryFeed", () => ({
  useMinistryFeed: () => mockUseMinistryFeed(),
}));

const mockUseStickers = vi.fn();
vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => mockUseStickers(),
}));

vi.mock("@/lib/hooks/useMinistryPostReactions", () => ({
  useMinistryPostReactions: () => ({
    isMyReaction: () => false,
    toggle: vi.fn(),
    react: vi.fn(),
    unreact: vi.fn(),
  }),
}));

import { apiPost as apiPostExport } from "@/lib/api";
const apiPostMock = apiPostExport as unknown as ReturnType<typeof vi.fn>;

import MinistryFeedPage from "@/app/(authed)/feed/page";
import NewMinistryPostPage from "@/app/(authed)/feed/new/page";
import { NewMinistryPostForm } from "@/components/ministry/NewMinistryPostForm";
import type { MinistryPost } from "@/lib/hooks/useMinistryFeed";

const pinnedPost: MinistryPost = {
  postId: "pinned1",
  title: "Pinned sermon",
  body: "Pinned body",
  sermonUrl: null,
  coverImageRef: null,
  authorUid: "owner",
  createdAt: "2026-05-17T10:00:00Z",
  editedAt: null,
  deletedAt: null,
  pinnedAt: "2026-05-17T11:00:00Z",
  pinnedBy: "owner",
  reactionCounts: {},
};

const recentPost: MinistryPost = {
  postId: "recent1",
  title: "Recent devotional",
  body: "Recent body",
  sermonUrl: null,
  coverImageRef: null,
  authorUid: "owner",
  createdAt: "2026-05-17T09:00:00Z",
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  pinnedBy: null,
  reactionCounts: {},
};

beforeEach(() => {
  mockRouterPush.mockReset();
  mockRouterReplace.mockReset();
  mockUseAuth.mockReturnValue({
    user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  });
  mockUseStickers.mockReturnValue({ stickers: [], loading: false });
  mockUseMinistryFeed.mockReturnValue({
    posts: [pinnedPost, recentPost],
    loading: false,
    error: null,
  });
  apiPostMock.mockReset();
  apiPostMock.mockResolvedValue({ postId: "new" });
});

describe("MinistryFeedPage read view", () => {
  it("renders all posts with the pinned post badged", () => {
    mockUseMinistryOwner.mockReturnValue(false);
    render(<MinistryFeedPage />);
    expect(screen.getByText("Pinned sermon")).toBeInTheDocument();
    expect(screen.getByText("Recent devotional")).toBeInTheDocument();
    // Pinned badge — the badge text is rendered inside a styled span;
    // assert via the class hook to stay resilient to whitespace.
    const badge = document.querySelector(".text-parchment-amber");
    expect(badge).not.toBeNull();
    expect(badge?.textContent ?? "").toMatch(/Pinned/);
  });

  it("hides the New post CTA when the user is not a ministry owner", () => {
    mockUseMinistryOwner.mockReturnValue(false);
    render(<MinistryFeedPage />);
    expect(
      screen.queryByRole("link", { name: /new post/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /new ministry post/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the New post CTA (not the inline form) when the user IS a ministry owner", () => {
    mockUseMinistryOwner.mockReturnValue(true);
    render(<MinistryFeedPage />);
    // Two CTAs render: the desktop header link and the mobile-only
    // FloatingActionBar — both navigate to /feed/new.
    const ctas = screen.getAllByRole("link", { name: /new post/i });
    expect(ctas.length).toBeGreaterThan(0);
    ctas.forEach((cta) => expect(cta).toHaveAttribute("href", "/feed/new"));
    expect(
      screen.queryByRole("form", { name: /new ministry post/i }),
    ).not.toBeInTheDocument();
  });

  it("renders empty-state copy when there are no posts", () => {
    mockUseMinistryOwner.mockReturnValue(false);
    mockUseMinistryFeed.mockReturnValueOnce({
      posts: [],
      loading: false,
      error: null,
    });
    render(<MinistryFeedPage />);
    expect(screen.getByText(/Nothing posted yet/i)).toBeInTheDocument();
  });
});

describe("NewMinistryPostForm submit", () => {
  it("posts title + body and clears the form on success", async () => {
    render(<NewMinistryPostForm />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Sunday update" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "Reflect on Psalm 23." },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledTimes(1);
    });
    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/ministry-feed/posts",
      expect.objectContaining({
        title: "Sunday update",
        body: "Reflect on Psalm 23.",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(/Post published\./i)).toBeInTheDocument();
    });
  });

  it("includes sermonUrl when provided", async () => {
    render(<NewMinistryPostForm />);
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "T" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText(/sermon link/i), {
      target: { value: "https://example.com/sermon" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalled();
    });
    const payload = apiPostMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.sermonUrl).toBe("https://example.com/sermon");
  });

  it("does not POST when title is blank", async () => {
    render(<NewMinistryPostForm />);
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    // Wait a tick so the form has a chance to attempt submission.
    await new Promise((r) => setTimeout(r, 50));
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe("NewMinistryPostPage (/feed/new) role gate", () => {
  it("shows loading state while ownership is resolving", () => {
    mockUseMinistryOwner.mockReturnValue(null);
    render(<NewMinistryPostPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /new ministry post/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an error and back link when user is not a ministry owner", () => {
    mockUseMinistryOwner.mockReturnValue(false);
    render(<NewMinistryPostPage />);
    expect(
      screen.getByText(/only ministry owners can create posts/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ministry feed/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /new ministry post/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the compose form for ministry owners", () => {
    mockUseMinistryOwner.mockReturnValue(true);
    render(<NewMinistryPostPage />);
    expect(
      screen.getByRole("form", { name: /new ministry post/i }),
    ).toBeInTheDocument();
  });

  it("navigates to /feed after a successful post", async () => {
    mockUseMinistryOwner.mockReturnValue(true);
    apiPostMock.mockResolvedValueOnce({ postId: "new123" });
    render(<NewMinistryPostPage />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Grace Sunday" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "Walk in the light." },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/feed");
    });
  });
});
