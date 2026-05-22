/**
 * @vitest-environment jsdom
 *
 * Tests for /admin/boards (the list page) — admin-gating, board list
 * rendering, archive and inline-edit calling the right endpoints. The
 * create flow lives at /admin/boards/new and is covered by
 * admin-boards-new.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseRoleClaims = vi.fn();
vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: () => mockUseRoleClaims(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/boards",
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
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import {
  apiDelete as apiDeleteExport,
  apiGet as apiGetExport,
  apiPatch as apiPatchExport,
} from "@/lib/api";
import AdminBoardsPage from "@/app/(authed)/admin/boards/page";
import AdminLayout from "@/app/(authed)/admin/layout";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;
const apiPatch = apiPatchExport as unknown as ReturnType<typeof vi.fn>;

const adminUser = {
  uid: "admin1",
  email: "admin@example.com",
  getIdToken: vi.fn().mockResolvedValue("tok"),
  getIdTokenResult: vi.fn().mockResolvedValue({ claims: { admin: true } }),
};

const fakeBoards = [
  {
    boardId: "prayer-praise",
    name: "Prayer & Praise",
    slug: "prayer-praise",
    description: "Cross-group prayer",
    audience: "christian",
    archivedAt: null,
    postCount: 7,
  },
  {
    boardId: "announcements",
    name: "Announcements",
    slug: "announcements",
    description: "",
    audience: "general",
    archivedAt: null,
    postCount: 2,
  },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({ user: adminUser, loading: false });
  mockUseRoleClaims.mockReturnValue({ isAdmin: true, isModerator: false });
  apiGet.mockReset();
  apiDelete.mockReset();
  apiPatch.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

// ── admin-gating (layout) ──────────────────────────────────────────────

describe("AdminLayout", () => {
  it("shows Boards nav link for admin users", async () => {
    render(<AdminLayout><div>content</div></AdminLayout>);
    // Layout renders both a mobile chip nav and a desktop sidebar; both
    // contain a Boards link. We only care that one exists and points at
    // the right URL.
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Boards" }).length).toBeGreaterThan(0),
    );
    for (const link of screen.getAllByRole("link", { name: "Boards" })) {
      expect(link).toHaveAttribute("href", "/admin/boards");
    }
  });
});

// ── page renders board list ────────────────────────────────────────────

describe("AdminBoardsPage list", () => {
  it("fetches from GET /api/boards and renders cards", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    render(<AdminBoardsPage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/boards"));
    expect(await screen.findByText("Prayer & Praise")).toBeInTheDocument();
    expect(screen.getByText("/boards/prayer-praise")).toBeInTheDocument();
    expect(screen.getByText("Announcements")).toBeInTheDocument();
    expect(screen.getByText("christian")).toBeInTheDocument();
    expect(screen.getByText(/7 posts/)).toBeInTheDocument();
  });

  it("shows empty state when no boards returned", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    render(<AdminBoardsPage />);
    expect(await screen.findByText(/no boards yet/i)).toBeInTheDocument();
  });

  it("hides archived boards from the list", async () => {
    apiGet.mockResolvedValue({
      boards: [
        ...fakeBoards,
        {
          boardId: "old",
          name: "Old Board",
          slug: "old",
          description: "",
          audience: "general",
          archivedAt: "2026-01-01T00:00:00Z",
          postCount: 0,
        },
      ],
    });
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");
    expect(screen.queryByText("Old Board")).not.toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    const { ApiError } = await import("@/lib/api");
    apiGet.mockRejectedValue(new ApiError(500, "server_error", "Server exploded"));
    render(<AdminBoardsPage />);
    expect(await screen.findByText(/server exploded/i)).toBeInTheDocument();
  });

  it("renders an Edit button per card", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(2);
  });

  it("exposes a New board link in the header on desktop", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");
    const newLinks = screen.getAllByRole("link", { name: /new board/i });
    expect(newLinks.length).toBeGreaterThan(0);
    for (const link of newLinks) {
      expect(link).toHaveAttribute("href", "/admin/boards/new");
    }
  });
});

// ── archive board ──────────────────────────────────────────────────────

describe("AdminBoardsPage archive", () => {
  it("calls DELETE /api/admin/boards/:id and removes card", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    apiDelete.mockResolvedValue(undefined);

    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstArchiveBtn] = screen.getAllByRole("button", { name: /^archive$/i });
    fireEvent.click(firstArchiveBtn);

    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith("/api/admin/boards/prayer-praise"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Prayer & Praise")).not.toBeInTheDocument(),
    );
  });

  it("does not call DELETE when user cancels confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    apiGet.mockResolvedValue({ boards: fakeBoards });

    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstArchiveBtn] = screen.getAllByRole("button", { name: /^archive$/i });
    fireEvent.click(firstArchiveBtn);

    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Prayer & Praise")).toBeInTheDocument();
  });

  it("shows inline error on archive failure", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const { ApiError } = await import("@/lib/api");
    apiDelete.mockRejectedValue(new ApiError(500, "server_error", "Archive failed"));

    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstArchiveBtn] = screen.getAllByRole("button", { name: /^archive$/i });
    fireEvent.click(firstArchiveBtn);

    expect(await screen.findByText(/archive failed/i)).toBeInTheDocument();
    expect(screen.getByText("Prayer & Praise")).toBeInTheDocument();
  });
});

// ── edit board ─────────────────────────────────────────────────────────

describe("AdminBoardsPage edit", () => {
  it("opens inline edit form on Edit click and pre-populates fields", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);

    const nameInput = screen.getByRole("textbox", { name: /^name$/i }) as HTMLInputElement;
    expect(nameInput.value).toBe("Prayer & Praise");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("calls PATCH with updated values and closes edit card", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    apiPatch.mockResolvedValue({
      ...fakeBoards[0],
      name: "Renamed Board",
      description: "Updated desc",
    });

    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);

    const nameInput = screen.getByRole("textbox", { name: /^name$/i });
    await ue.clear(nameInput);
    await ue.type(nameInput, "Renamed Board");

    await ue.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/admin/boards/prayer-praise",
        expect.objectContaining({ name: "Renamed Board" }),
      ),
    );
    expect(await screen.findByText("Renamed Board")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  it("shows error banner on PATCH failure and keeps edit card open", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const { ApiError } = await import("@/lib/api");
    apiPatch.mockRejectedValue(new ApiError(500, "server_error", "Save failed"));

    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);
    await ue.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("Cancel closes edit card without calling PATCH", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);
    await ue.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(apiPatch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Prayer & Praise")).toBeInTheDocument();
  });

  it("edit form does not allow changing the slug", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);

    expect(screen.queryByRole("textbox", { name: /url slug/i })).not.toBeInTheDocument();
  });
});
