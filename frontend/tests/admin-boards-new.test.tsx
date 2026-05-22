/**
 * @vitest-environment jsdom
 *
 * Tests for /admin/boards/new — the focused create-board page. Covers
 * slug auto-derivation, validation, the POST call, slug-conflict
 * messaging, and post-success navigation back to /admin/boards.
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
  it("auto-derives slug from the name field", async () => {
    const ue = userEvent.setup();
    render(<NewBoardPage />);

    await ue.type(screen.getByRole("textbox", { name: /^name$/i }), "Prayer & Praise");
    const slugInput = screen.getByRole("textbox", { name: /url slug/i }) as HTMLInputElement;
    expect(slugInput.value).toBe("prayer-praise");
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
    // Slug auto-fills to "new-board", description optional, audience defaults to general.
    await ue.type(screen.getByRole("textbox", { name: /description/i }), "A new one");
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
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin/boards"));
  });

  it("blocks submit when name is empty and shows a validation error", async () => {
    const ue = userEvent.setup();
    render(<NewBoardPage />);
    await ue.click(screen.getByRole("button", { name: /create board/i }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("shows a helpful error on slug_conflict", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPost.mockRejectedValue(
      new ApiError(409, "slug_conflict", "A board with this slug already exists"),
    );

    const ue = userEvent.setup();
    render(<NewBoardPage />);
    await ue.type(screen.getByRole("textbox", { name: /^name$/i }), "Dupe");
    await ue.click(screen.getByRole("button", { name: /create board/i }));

    expect(
      await screen.findByText(/board with this slug already exists/i),
    ).toBeInTheDocument();
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
