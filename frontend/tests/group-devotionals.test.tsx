/**
 * @vitest-environment jsdom
 *
 * Group-scoped devotionals UI surfaces (PR #300):
 * - The group /devotionals list shows the leader-only "Write devotional" CTA.
 * - The new-group-devotional page auto-scopes `groupId` on submit and refuses
 *   non-leaders with a banner.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useParams: () => ({ gid: "g1" }),
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

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockMembership = vi.fn();
vi.mock("@/lib/hooks/useGroupMembership", () => ({
  useGroupMembership: () => mockMembership(),
}));

const mockCreateDevotional = vi.fn();
const mockUseGroupDevotionals = vi.fn();
vi.mock("@/lib/hooks/useDevotionals", () => ({
  useDevotionals: () => ({ devotionals: [], loading: false }),
  useDevotional: () => ({ devotional: null, loading: false }),
  useGroupDevotionals: () => mockUseGroupDevotionals(),
  useDevotionalMutations: () => ({
    createDevotional: mockCreateDevotional,
    patchDevotional: vi.fn(),
    deleteDevotional: vi.fn(),
  }),
}));

import GroupDevotionalsPage from "@/app/(authed)/groups/[gid]/devotionals/page";
import NewGroupDevotionalPage from "@/app/(authed)/groups/[gid]/devotionals/new/page";

beforeEach(() => {
  routerPush.mockReset();
  mockCreateDevotional.mockReset();
  mockUseAuth.mockReturnValue({ user: { uid: "u1" }, loading: false });
  mockUseGroupDevotionals.mockReturnValue({
    devotionals: [],
    loading: false,
    reload: vi.fn(),
  });
});

// ── /groups/{gid}/devotionals (list) ─────────────────────────────────────────

describe("GroupDevotionalsPage CTA visibility", () => {
  it("hides Write devotional for non-leader members", () => {
    mockMembership.mockReturnValue({ isLeader: false, loading: false });
    render(<GroupDevotionalsPage />);
    expect(
      screen.queryByRole("link", { name: /write devotional/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Write devotional for leaders, linking to /new", () => {
    mockMembership.mockReturnValue({ isLeader: true, loading: false });
    render(<GroupDevotionalsPage />);
    const cta = screen.getByRole("link", { name: /write devotional/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("href", "/groups/g1/devotionals/new");
  });

  it("renders an empty-state when the group has no devotionals", () => {
    mockMembership.mockReturnValue({ isLeader: false, loading: false });
    render(<GroupDevotionalsPage />);
    expect(screen.getByText(/no devotionals yet/i)).toBeInTheDocument();
  });

  it("lists every devotional returned by the hook", () => {
    mockMembership.mockReturnValue({ isLeader: false, loading: false });
    mockUseGroupDevotionals.mockReturnValue({
      devotionals: [
        {
          slug: "g1-week-1",
          title: "Week 1: Joy",
          scriptureRef: "Phil 4:4",
          body: "Rejoice in the Lord always.",
          audioUrl: null,
          sourceAttribution: "",
          publishedAt: null,
          audience: "christian",
          groupId: "g1",
          groupName: "Crossroads",
        },
      ],
      loading: false,
      reload: vi.fn(),
    });
    render(<GroupDevotionalsPage />);
    expect(
      screen.getByRole("heading", { name: "Week 1: Joy" }),
    ).toBeInTheDocument();
  });
});

// ── /groups/{gid}/devotionals/new (create page) ──────────────────────────────

describe("NewGroupDevotionalPage role gating", () => {
  it("refuses non-leader members with a banner", () => {
    mockMembership.mockReturnValue({ isLeader: false, loading: false });
    render(<NewGroupDevotionalPage />);
    expect(
      screen.getByText(/only group leaders can write devotionals/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
  });

  it("renders the form for leaders", () => {
    mockMembership.mockReturnValue({ isLeader: true, loading: false });
    render(<NewGroupDevotionalPage />);
    expect(screen.getByText(/write a devotional/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
  });

  it("submits with groupId auto-set to the route gid", async () => {
    mockMembership.mockReturnValue({ isLeader: true, loading: false });
    mockCreateDevotional.mockResolvedValue({
      slug: "g1-week-1",
      title: "Week 1",
      scriptureRef: "Phil 4:4",
      body: "Rejoice in the Lord always.",
      audioUrl: null,
      sourceAttribution: "",
      publishedAt: null,
      audience: "christian",
      groupId: "g1",
      groupName: "Crossroads",
    });

    render(<NewGroupDevotionalPage />);
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: "g1-week-1" },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Week 1" },
    });
    fireEvent.change(screen.getByLabelText(/body/i), {
      target: { value: "Rejoice in the Lord always." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /publish to group/i }),
    );

    await waitFor(() => expect(mockCreateDevotional).toHaveBeenCalled());
    expect(mockCreateDevotional).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "g1-week-1",
        title: "Week 1",
        // Critical: the form scopes to the route's gid, the user doesn't
        // pick this.
        groupId: "g1",
      }),
    );
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/devotionals/g1-week-1"),
    );
  });
});
