/**
 * @vitest-environment jsdom
 *
 * Covers: schema validation, useGroupSermons hook, SermonForm UI, and the
 * NewSermonPage leader-gate.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ gid: "g1" }),
}));

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
  useAuth: () => ({ user: { uid: "u1" }, loading: false }),
}));

const mockMembership = vi.fn();
vi.mock("@/lib/hooks/useGroupMembership", () => ({
  useGroupMembership: (...args: unknown[]) => mockMembership(...args),
}));

import {
  apiDelete as apiDeleteExport,
  apiGet as apiGetExport,
  apiPatch as apiPatchExport,
  apiPost as apiPostExport,
} from "@/lib/api";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiPatch = apiPatchExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;

const emptyList = { sermons: [], preachers: [] };

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
import {
  sermonCreateSchema,
  sermonEditSchema,
} from "@/components/groups/SermonForm";

describe("sermonCreateSchema", () => {
  it("accepts a valid https URL", () => {
    const res = sermonCreateSchema.safeParse({
      sourceUrl: "https://youtube.com/watch?v=abc",
    });
    expect(res.success).toBe(true);
  });

  it("accepts a valid http URL", () => {
    const res = sermonCreateSchema.safeParse({
      sourceUrl: "http://example.com/sermon",
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty sourceUrl", () => {
    const res = sermonCreateSchema.safeParse({ sourceUrl: "" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("sourceUrl");
    }
  });

  it("rejects javascript: URL", () => {
    expect(
      sermonCreateSchema.safeParse({ sourceUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("rejects data: URL", () => {
    expect(
      sermonCreateSchema.safeParse({
        sourceUrl: "data:text/html,<h1>hi</h1>",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid sermonDate format", () => {
    const res = sermonCreateSchema.safeParse({
      sourceUrl: "https://example.com",
      sermonDate: "01-01-2024",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].path[0]).toBe("sermonDate");
  });

  it("accepts empty sermonDate", () => {
    expect(
      sermonCreateSchema.safeParse({
        sourceUrl: "https://example.com",
        sermonDate: "",
      }).success,
    ).toBe(true);
  });

  it("accepts valid YYYY-MM-DD date", () => {
    expect(
      sermonCreateSchema.safeParse({
        sourceUrl: "https://example.com",
        sermonDate: "2024-01-15",
      }).success,
    ).toBe(true);
  });
});

describe("sermonEditSchema", () => {
  it("passes without sourceUrl", () => {
    expect(sermonEditSchema.safeParse({}).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useGroupSermons hook (uses real implementation via mocked api layer)
// ---------------------------------------------------------------------------
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";

describe("useGroupSermons", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
  });

  it("loads sermons + preachers", async () => {
    apiGet.mockResolvedValue({
      sermons: [
        {
          sermonId: "s1",
          title: "Sermon",
          preacher: "Pastor Jane",
          scripture: null,
          sermonDate: null,
          sourceUrl: "https://example.com",
          sourceType: "other",
          thumbnail: null,
          addedBy: "u1",
          addedAt: null,
          deletedAt: null,
        },
      ],
      preachers: ["Pastor Jane"],
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sermons).toHaveLength(1);
    expect(result.current.preachers).toEqual(["Pastor Jane"]);
  });

  it("addSermon posts to correct endpoint", async () => {
    apiGet.mockResolvedValue(emptyList);
    apiPost.mockResolvedValue({
      sermonId: "s1",
      title: "S",
      preacher: null,
      scripture: null,
      sermonDate: null,
      sourceUrl: "https://example.com",
      sourceType: "other",
      thumbnail: null,
      addedBy: "u1",
      addedAt: null,
      deletedAt: null,
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = await result.current.addSermon({
      sourceUrl: "https://example.com",
    });
    expect(created?.sermonId).toBe("s1");
    expect(apiPost).toHaveBeenCalledWith("/api/groups/g1/sermons", {
      sourceUrl: "https://example.com",
    });
  });

  it("deleteSermon resolves true on success", async () => {
    apiGet.mockResolvedValue(emptyList);
    apiDelete.mockResolvedValue({});
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await result.current.deleteSermon("s1")).toBe(true);
    expect(apiDelete).toHaveBeenCalledWith("/api/groups/g1/sermons/s1");
  });

  it("patchSermon sends PATCH to correct endpoint", async () => {
    apiGet.mockResolvedValue(emptyList);
    apiPatch.mockResolvedValue({
      sermonId: "s1",
      title: "Updated",
      preacher: "Rev. Smith",
      scripture: null,
      sermonDate: null,
      sourceUrl: "https://example.com",
      sourceType: "other",
      thumbnail: null,
      addedBy: "u1",
      addedAt: null,
      deletedAt: null,
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const updated = await result.current.patchSermon("s1", { title: "Updated" });
    expect(updated?.title).toBe("Updated");
    expect(apiPatch).toHaveBeenCalledWith("/api/groups/g1/sermons/s1", {
      title: "Updated",
    });
  });
});

// ---------------------------------------------------------------------------
// SermonForm component
// ---------------------------------------------------------------------------
import { SermonForm } from "@/components/groups/SermonForm";

describe("SermonForm — create mode", () => {
  it("renders source URL field", () => {
    render(
      <SermonForm
        mode="create"
        submitLabel="Add sermon"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByLabelText(/source url/i)).toBeInTheDocument();
  });

  it("shows validation error for empty URL on submit", async () => {
    const user = userEvent.setup();
    render(
      <SermonForm
        mode="create"
        submitLabel="Add sermon"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    await waitFor(() =>
      expect(screen.getByText(/url is required/i)).toBeInTheDocument(),
    );
  });

  it("shows validation error for non-http URL", async () => {
    const user = userEvent.setup();
    render(
      <SermonForm
        mode="create"
        submitLabel="Add sermon"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    await user.type(
      screen.getByLabelText(/source url/i),
      "ftp://not-allowed.com",
    );
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    await waitFor(() =>
      expect(screen.getByText(/valid http or https url/i)).toBeInTheDocument(),
    );
  });

  it("calls onSubmit with correct values on valid input", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(
      <SermonForm
        mode="create"
        submitLabel="Add sermon"
        onSubmit={handleSubmit}
      />,
    );
    await user.type(
      screen.getByLabelText(/source url/i),
      "https://youtube.com/watch?v=abc",
    );
    await user.type(screen.getByLabelText(/^title/i), "Grace Abounds");
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledOnce());
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://youtube.com/watch?v=abc",
        title: "Grace Abounds",
      }),
    );
  });
});

describe("SermonForm — edit mode", () => {
  it("does not render source URL field", () => {
    render(
      <SermonForm
        mode="edit"
        submitLabel="Save changes"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.queryByLabelText(/source url/i)).not.toBeInTheDocument();
  });

  it("pre-fills default values", () => {
    render(
      <SermonForm
        mode="edit"
        defaultValues={{ title: "Existing Title", preacher: "Rev. Smith" }}
        submitLabel="Save changes"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByDisplayValue("Existing Title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rev. Smith")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <SermonForm
        mode="edit"
        submitLabel="Save changes"
        onSubmit={vi.fn().mockResolvedValue(null)}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// NewSermonPage — leader gate (uses real hook via mocked apiGet)
// ---------------------------------------------------------------------------
import NewSermonPage from "@/app/(authed)/groups/[gid]/sermons/new/page";

describe("NewSermonPage — leader gate", () => {
  beforeEach(() => {
    apiGet.mockResolvedValue(emptyList);
  });

  it("shows error banner for non-leader", async () => {
    mockMembership.mockReturnValue({
      membership: null,
      isLeader: false,
      loading: false,
    });
    render(<NewSermonPage />);
    expect(
      screen.getByText(/only group leaders can add sermons/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/source url/i)).not.toBeInTheDocument();
  });

  it("shows create form for leader", async () => {
    mockMembership.mockReturnValue({
      membership: { role: "leader" },
      isLeader: true,
      loading: false,
    });
    render(<NewSermonPage />);
    expect(screen.getByLabelText(/source url/i)).toBeInTheDocument();
  });

  it("calls addSermon on valid submit and posts to /api/groups/:gid/sermons", async () => {
    mockMembership.mockReturnValue({
      membership: { role: "leader" },
      isLeader: true,
      loading: false,
    });
    apiPost.mockResolvedValue({
      sermonId: "s-new",
      title: "Test Sermon",
      preacher: null,
      scripture: null,
      sermonDate: null,
      sourceUrl: "https://youtube.com/watch?v=test",
      sourceType: "youtube",
      thumbnail: null,
      addedBy: "u1",
      addedAt: null,
      deletedAt: null,
    });
    const user = userEvent.setup();
    render(<NewSermonPage />);
    await user.type(
      screen.getByLabelText(/source url/i),
      "https://youtube.com/watch?v=test",
    );
    await user.click(screen.getByRole("button", { name: /add sermon/i }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/api/groups/g1/sermons",
        expect.objectContaining({
          sourceUrl: "https://youtube.com/watch?v=test",
        }),
      ),
    );
  });
});
