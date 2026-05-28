/**
 * @vitest-environment jsdom
 *
 * Tests for /admin/boards/new — the focused create-board page. The
 * server now derives the slug from the name, so the form no longer has
 * a slug input. Covers validation, the POST call, and post-success
 * navigation back to /admin/boards.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => "/admin/boards/new",
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
  apiPost: vi.fn(),
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

import { apiPost as apiPostExport } from "@/lib/api";
import NewBoardPage from "@/app/(authed)/admin/boards/new/page";

const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockPush.mockReset();
  apiPost.mockReset();
});

describe("NewBoardPage", () => {
  it("no longer renders a slug input — slug is server-derived", () => {
    render(<NewBoardPage />);
    expect(screen.queryByRole("textbox", { name: /url slug/i })).toBeNull();
  });

  it("calls POST /api/admin/boards with form values and redirects on success", async () => {
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
    render(<NewBoardPage />);

    await ue.type(screen.getByRole("textbox", { name: /^name$/i }), "New Board");
    await ue.type(screen.getByRole("textbox", { name: /description/i }), "A new one");
    await ue.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, payload] = apiPost.mock.calls[0];
    expect(path).toBe("/api/admin/boards");
    // Slug is NOT sent — the server derives it from `name`.
    expect(payload).toEqual({
      name: "New Board",
      description: "A new one",
      audience: "general",
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin/boards"));
  });

  it("blocks submit when name is empty and shows a validation error", async () => {
    const ue = userEvent.setup();
    render(<NewBoardPage />);
    await ue.click(screen.getByRole("button", { name: /create board/i }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("surfaces backend error messages when the create call fails", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPost.mockRejectedValue(new ApiError(500, "server_error", "Server error"));

    const ue = userEvent.setup();
    render(<NewBoardPage />);
    await ue.type(screen.getByRole("textbox", { name: /^name$/i }), "Some Board");
    await ue.click(screen.getByRole("button", { name: /create board/i }));

    expect(await screen.findByText(/server error/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Cancel returns to /admin/boards without calling the API", async () => {
    const ue = userEvent.setup();
    render(<NewBoardPage />);

    await ue.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/admin/boards");
  });
});
