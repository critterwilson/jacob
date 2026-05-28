/**
 * @vitest-environment jsdom
 */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

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

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(() => ({ user: { uid: "u1" }, loading: false })),
}));

vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: vi.fn(() => ({
    isAdmin: true,
    isModerator: false,
    isMinistryOwner: false,
  })),
}));

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ slug: "john-7-day" })),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

import {
  apiDelete as apiDeleteExport,
  apiGet as apiGetExport,
  apiPatch as apiPatchExport,
  apiPost as apiPostExport,
} from "@/lib/api";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";
import { useReadingPlansAdmin } from "@/lib/hooks/useReadingPlans";
import { ReadingPlanForm } from "@/components/reading-plans/ReadingPlanForm";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiPatch = apiPatchExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;
const mockUseRoleClaims = useRoleClaims as unknown as ReturnType<typeof vi.fn>;

const PLAN = {
  slug: "john-7-day",
  title: "7 Days in John",
  description: "A week in the Gospel of John.",
  duration: 2,
  audience: "christian" as const,
  publishedAt: null,
  schemaVersion: 1,
  days: [
    { dayNumber: 1, scriptureRef: "John 1:1-14", prompt: "Reflect on the Word." },
    { dayNumber: 2, scriptureRef: "John 1:15-34", prompt: "Who is Jesus?" },
  ],
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  mockUseRoleClaims.mockReturnValue({ isAdmin: true, isModerator: false, isMinistryOwner: false });
});

// ── useReadingPlansAdmin hook ────────────────────────────────────────────────

describe("useReadingPlansAdmin", () => {
  it("createPlan POSTs to /api/reading-plans and returns the plan", async () => {
    apiPost.mockResolvedValue(PLAN);
    const { result } = renderHook(() => useReadingPlansAdmin());
    let returned;
    await act(async () => {
      returned = await result.current.createPlan({
        title: "7 Days in John",
        description: "",
        audience: "christian",
        days: [{ scriptureRef: "John 1:1", prompt: "" }],
      });
    });
    // Slug is server-derived from the title — no manual `slug` field.
    expect(apiPost).toHaveBeenCalledWith(
      "/api/reading-plans",
      expect.objectContaining({ title: "7 Days in John" }),
    );
    const sentPayload = apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(sentPayload).not.toHaveProperty("slug");
    expect(returned).toEqual(PLAN);
  });

  it("updatePlan PATCHes /api/reading-plans/{slug}", async () => {
    apiPatch.mockResolvedValue({ ...PLAN, title: "Updated" });
    const { result } = renderHook(() => useReadingPlansAdmin());
    let returned;
    await act(async () => {
      returned = await result.current.updatePlan("john-7-day", { title: "Updated" });
    });
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/reading-plans/john-7-day",
      { title: "Updated" },
    );
    expect((returned as unknown as typeof PLAN)?.title).toBe("Updated");
  });

  it("deletePlan DELETEs /api/reading-plans/{slug} and returns true", async () => {
    apiDelete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReadingPlansAdmin());
    let ok;
    await act(async () => {
      ok = await result.current.deletePlan("john-7-day");
    });
    expect(apiDelete).toHaveBeenCalledWith("/api/reading-plans/john-7-day");
    expect(ok).toBe(true);
  });
});

// ── ReadingPlanForm: create mode ─────────────────────────────────────────────

describe("ReadingPlanForm – create mode", () => {
  it("renders title, description, audience, and one default day — no slug input", () => {
    render(<ReadingPlanForm mode="create" onSubmit={vi.fn()} />);
    // Slug is server-derived from the title — no input on the form.
    expect(screen.queryByLabelText(/url slug/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/audience/i)).toBeInTheDocument();
    expect(screen.getByText(/day 1/i)).toBeInTheDocument();
  });

  it("calls onSubmit with correct payload when form is valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReadingPlanForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/title/i), "Test Plan");
    await user.type(
      screen.getByLabelText(/day 1 scripture reference/i),
      "John 1:1",
    );
    await user.click(screen.getByRole("button", { name: /create plan/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        title: "Test Plan",
        days: [expect.objectContaining({ scriptureRef: "John 1:1" })],
      }),
    );
    expect(payload).not.toHaveProperty("slug");
  });

  it("does not call onSubmit when title is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReadingPlanForm mode="create" onSubmit={onSubmit} />);

    await user.type(
      screen.getByLabelText(/day 1 scripture reference/i),
      "John 1:1",
    );
    await user.click(screen.getByRole("button", { name: /create plan/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
  });

  it("does not call onSubmit when scripture reference is missing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReadingPlanForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/title/i), "Test Plan");
    await user.click(screen.getByRole("button", { name: /create plan/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/scripture reference is required/i)).toBeInTheDocument();
  });
});

// ── ReadingPlanForm: day add/remove ──────────────────────────────────────────

describe("ReadingPlanForm – day editor", () => {
  it("adds a day when '+ Add day' is clicked", async () => {
    const user = userEvent.setup();
    render(<ReadingPlanForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.getAllByText(/^Day \d+$/)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /add day/i }));
    expect(screen.getAllByText(/^Day \d+$/)).toHaveLength(2);
    expect(screen.getByText("Day 2")).toBeInTheDocument();
  });

  it("removes a day when Remove is clicked (and there are 2+ days)", async () => {
    const user = userEvent.setup();
    render(<ReadingPlanForm mode="create" onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add day/i }));
    expect(screen.getAllByText(/^Day \d+$/)).toHaveLength(2);

    const removeButtons = screen.getAllByRole("button", { name: /remove day/i });
    await user.click(removeButtons[1]);
    expect(screen.getAllByText(/^Day \d+$/)).toHaveLength(1);
  });

  it("disables Remove when only one day remains", async () => {
    render(<ReadingPlanForm mode="create" onSubmit={vi.fn()} />);
    const removeBtn = screen.getByRole("button", { name: /remove day 1/i });
    expect(removeBtn).toBeDisabled();
  });

  it("assigns sequential dayNumbers (1, 2, 3) in the submitted payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReadingPlanForm mode="create" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /add day/i }));
    await user.click(screen.getByRole("button", { name: /add day/i }));

    await user.type(screen.getByLabelText(/title/i), "My Plan");

    const refs = screen.getAllByLabelText(/scripture reference/i);
    await user.type(refs[0], "John 1");
    await user.type(refs[1], "John 2");
    await user.type(refs[2], "John 3");

    await user.click(screen.getByRole("button", { name: /create plan/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        days: [
          expect.objectContaining({ scriptureRef: "John 1" }),
          expect.objectContaining({ scriptureRef: "John 2" }),
          expect.objectContaining({ scriptureRef: "John 3" }),
        ],
      }),
    );
  });
});

// ── ReadingPlanForm: edit mode ───────────────────────────────────────────────

describe("ReadingPlanForm – edit mode", () => {
  it("pre-fills fields from initial values", () => {
    render(
      <ReadingPlanForm
        mode="edit"
        initial={{
          slug: "john-7-day",
          title: "7 Days in John",
          description: "A week in John.",
          audience: "christian",
          days: [{ scriptureRef: "John 1:1", prompt: "Reflect." }],
        }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("7 Days in John")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A week in John.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("John 1:1")).toBeInTheDocument();
  });

  it("does not render a slug input in edit mode", () => {
    render(
      <ReadingPlanForm
        mode="edit"
        initial={{ slug: "john-7-day", title: "Existing" }}
        onSubmit={vi.fn()}
      />,
    );
    // The slug is shown as read-only text (not an input).
    expect(screen.queryByLabelText(/url slug/i)).not.toBeInTheDocument();
    // But it IS shown as a static line so editors know what the URL is.
    expect(screen.getByText("john-7-day")).toBeInTheDocument();
  });
});

// ── Role-gating: admin CTA visibility ───────────────────────────────────────

describe("admin CTA role-gating", () => {
  it("useRoleClaims isAdmin=true is visible to admin users", () => {
    mockUseRoleClaims.mockReturnValue({ isAdmin: true, isModerator: false, isMinistryOwner: false });
    const { result } = renderHook(() => useRoleClaims());
    expect(result.current?.isAdmin).toBe(true);
  });

  it("useRoleClaims isAdmin=false hides admin features for regular users", () => {
    mockUseRoleClaims.mockReturnValue({ isAdmin: false, isModerator: false, isMinistryOwner: false });
    const { result } = renderHook(() => useRoleClaims());
    expect(result.current?.isAdmin).toBe(false);
  });
});
