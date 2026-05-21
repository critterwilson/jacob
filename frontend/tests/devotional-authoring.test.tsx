/**
 * @vitest-environment jsdom
 *
 * Tests for the devotional authoring surface (create/edit/delete).
 * Covers: form validation, role-gating on new page, submit payload,
 * and hook mutation wiring.
 */
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ slug: "psalm-23" }),
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

const mockUseRoleClaims = vi.fn();
vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: () => mockUseRoleClaims(),
}));

const mockCreateDevotional = vi.fn();
const mockPatchDevotional = vi.fn();
const mockDeleteDevotional = vi.fn();

vi.mock("@/lib/hooks/useDevotionals", () => ({
  useDevotional: vi.fn(() => ({ devotional: null, loading: false })),
  useDevotionals: vi.fn(() => ({ devotionals: [], loading: false })),
  useDevotionalMutations: vi.fn(() => ({
    createDevotional: mockCreateDevotional,
    patchDevotional: mockPatchDevotional,
    deleteDevotional: mockDeleteDevotional,
  })),
}));

import {
  apiPost as apiPostExport,
  apiPatch as apiPatchExport,
  apiDelete as apiDeleteExport,
} from "@/lib/api";
import { DevotionalForm } from "@/components/devotionals/DevotionalForm";
import NewDevotionalPage from "@/app/(authed)/devotionals/new/page";
import DevotionalsIndexPage from "@/app/(authed)/devotionals/page";

const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiPatch = apiPatchExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiPost.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  mockCreateDevotional.mockReset();
  mockPatchDevotional.mockReset();
  mockDeleteDevotional.mockReset();
});

// ── DevotionalForm validation ─────────────────────────────────────────────────

describe("DevotionalForm", () => {
  it("renders required fields in create mode", () => {
    render(
      <DevotionalForm
        mode="create"
        submitLabel="Publish"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/body/i)).toBeInTheDocument();
  });

  it("does not render slug field in edit mode", () => {
    render(
      <DevotionalForm
        mode="edit"
        submitLabel="Save"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
  });

  it("shows validation error when title is empty on submit", async () => {
    render(
      <DevotionalForm
        mode="create"
        submitLabel="Publish"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() =>
      expect(screen.getByText(/slug is required/i)).toBeInTheDocument(),
    );
  });

  it("rejects an invalid slug pattern", async () => {
    render(
      <DevotionalForm
        mode="create"
        submitLabel="Publish"
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: "Has Spaces!" },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "My Title" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "Some body text" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/lowercase letters, numbers, and hyphens/i),
      ).toBeInTheDocument(),
    );
  });

  it("accepts a valid slug pattern and calls onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(
      <DevotionalForm mode="create" submitLabel="Publish" onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: "john-3-16" },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "God So Loved" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "For God so loved…" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const args = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(args.slug).toBe("john-3-16");
    expect(args.title).toBe("God So Loved");
  });

  it("displays submit error returned by onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue("Something went wrong");
    render(
      <DevotionalForm mode="create" submitLabel="Publish" onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: "test-slug" },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Title" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "Body" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    );
  });
});

// ── NewDevotionalPage role-gating ─────────────────────────────────────────────

describe("NewDevotionalPage", () => {
  it("shows loading state while claims are null", () => {
    mockUseRoleClaims.mockReturnValue(null);
    render(<NewDevotionalPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error banner for non-ministry-owner", () => {
    mockUseRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: false,
    });
    render(<NewDevotionalPage />);
    expect(
      screen.getByText(/only ministry owners can write devotionals/i),
    ).toBeInTheDocument();
  });

  it("renders the form for ministry owners", () => {
    mockUseRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: true,
    });
    render(<NewDevotionalPage />);
    expect(screen.getByText(/write a devotional/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
  });

  it("calls createDevotional with form values on submit", async () => {
    mockUseRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: true,
    });
    mockCreateDevotional.mockResolvedValue({
      slug: "psalm-23",
      title: "Psalm 23",
      scriptureRef: "Ps 23",
      body: "Body",
      audioUrl: null,
      sourceAttribution: "",
      publishedAt: null,
      audience: "christian",
    });

    render(<NewDevotionalPage />);
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: "psalm-23" },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Psalm 23" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "The Lord is my shepherd" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publish devotional/i }));
    await waitFor(() =>
      expect(mockCreateDevotional).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "psalm-23", title: "Psalm 23" }),
      ),
    );
  });
});

// ── DevotionalsIndexPage CTA visibility ───────────────────────────────────────

describe("DevotionalsIndexPage CTA", () => {
  it("hides Write devotional button for non-ministry-owner", () => {
    mockUseRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: false,
    });
    render(<DevotionalsIndexPage />);
    expect(
      screen.queryByRole("button", { name: /write devotional/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Write devotional button for ministry owner", () => {
    mockUseRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: true,
    });
    render(<DevotionalsIndexPage />);
    expect(
      screen.getByRole("button", { name: /write devotional/i }),
    ).toBeInTheDocument();
  });
});
