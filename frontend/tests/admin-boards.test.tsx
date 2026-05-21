/**
 * @vitest-environment jsdom
 *
 * Tests for /admin/boards — admin-gating, board list rendering,
 * create and archive actions calling the right endpoints.
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
  apiPost as apiPostExport,
} from "@/lib/api";
import AdminBoardsPage from "@/app/(authed)/admin/boards/page";
import AdminLayout from "@/app/(authed)/admin/layout";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
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
  apiGet.mockReset();
  apiPost.mockReset();
  apiDelete.mockReset();
  apiPatch.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

// ── admin-gating (layout) ──────────────────────────────────────────────

describe("AdminLayout", () => {
  it("shows Boards nav link for admin users", async () => {
    render(<AdminLayout><div>content</div></AdminLayout>);
    await waitFor(() => expect(screen.getByText("Boards")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Boards" })).toHaveAttribute(
      "href",
      "/admin/boards",
    );
  });
});

// ── page renders board list ────────────────────────────────────────────

describe("AdminBoardsPage list", () => {
  it("fetches from GET /api/boards and renders rows", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    render(<AdminBoardsPage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/boards"));
    expect(await screen.findByText("Prayer & Praise")).toBeInTheDocument();
    expect(screen.getByText("prayer-praise")).toBeInTheDocument();
    expect(screen.getByText("Announcements")).toBeInTheDocument();
    expect(screen.getByText("christian")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows empty state when no boards returned", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    render(<AdminBoardsPage />);
    expect(await screen.findByText(/no boards yet/i)).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    const { ApiError } = await import("@/lib/api");
    apiGet.mockRejectedValue(new ApiError(500, "server_error", "Server exploded"));
    render(<AdminBoardsPage />);
    expect(await screen.findByText(/server exploded/i)).toBeInTheDocument();
  });

  it("renders an Edit button per row", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(2);
  });
});

// ── create board ───────────────────────────────────────────────────────

describe("AdminBoardsPage create", () => {
  it("calls POST /api/admin/boards with form values", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    apiPost.mockResolvedValue({
      boardId: "new-board",
      name: "New Board",
      slug: "new-board",
      description: "A new one",
      audience: "general",
      archivedAt: null,
      postCount: 0,
    });

    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await ue.type(screen.getByLabelText(/^name$/i), "New Board");
    await ue.clear(screen.getByLabelText(/^slug/i));
    await ue.type(screen.getByLabelText(/^slug/i), "new-board");
    await ue.type(screen.getByLabelText(/description/i), "A new one");
    await ue.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, payload] = apiPost.mock.calls[0];
    expect(path).toBe("/api/admin/boards");
    expect(payload).toMatchObject({
      name: "New Board",
      slug: "new-board",
      description: "A new one",
      audience: "general",
    });
  });

  it("auto-derives slug from name", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await ue.type(screen.getByLabelText(/^name$/i), "Prayer & Praise");
    const slugInput = screen.getByLabelText(/^slug/i) as HTMLInputElement;
    expect(slugInput.value).toBe("prayer-praise");
  });

  it("disables Create button when name or slug is empty", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    render(<AdminBoardsPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /create board/i })).toBeDisabled();
  });

  it("shows create error on 409 conflict", async () => {
    apiGet.mockResolvedValue({ boards: [] });
    const { ApiError } = await import("@/lib/api");
    apiPost.mockRejectedValue(new ApiError(409, "slug_conflict", "Slug already exists"));

    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await ue.type(screen.getByLabelText(/^name$/i), "Dupe");
    await ue.click(screen.getByRole("button", { name: /create board/i }));

    expect(await screen.findByText(/slug already exists/i)).toBeInTheDocument();
  });
});

// ── archive board ──────────────────────────────────────────────────────

describe("AdminBoardsPage archive", () => {
  it("calls DELETE /api/admin/boards/:id and removes row", async () => {
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

    const nameInput = screen.getByRole("textbox", { name: /edit name/i }) as HTMLInputElement;
    expect(nameInput.value).toBe("Prayer & Praise");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("calls PATCH with updated values and closes edit row", async () => {
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

    const nameInput = screen.getByRole("textbox", { name: /edit name/i });
    await ue.clear(nameInput);
    await ue.type(nameInput, "Renamed Board");

    await ue.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        "/api/admin/boards/prayer-praise",
        expect.objectContaining({ name: "Renamed Board" }),
      ),
    );
    expect(await screen.findByText("Renamed Board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("shows error banner on PATCH failure and keeps edit row open", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const { ApiError } = await import("@/lib/api");
    apiPatch.mockRejectedValue(new ApiError(500, "server_error", "Save failed"));

    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);
    await ue.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("Cancel closes edit row without calling PATCH", async () => {
    apiGet.mockResolvedValue({ boards: fakeBoards });
    const ue = userEvent.setup();
    render(<AdminBoardsPage />);
    await screen.findByText("Prayer & Praise");

    const [firstEditBtn] = screen.getAllByRole("button", { name: /^edit$/i });
    await ue.click(firstEditBtn);
    await ue.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Prayer & Praise")).toBeInTheDocument();
  });
});
