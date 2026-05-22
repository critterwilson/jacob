/**
 * @vitest-environment jsdom
 *
 * Verifies the FloatingActionBar is wired into the pages that have one
 * dominant create action, gated to the role that can perform it, and
 * that each such page keeps its inline CTA for desktop (md:inline-flex)
 * while the bar itself is mobile-only (md:hidden). Pages with no single
 * dominant action (e.g. /boards) must not get a bar.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ gid: "g1" }),
  usePathname: () => "/",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
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
  useAuth: () => ({ user: { uid: "u1" }, loading: false, signOut: vi.fn() }),
}));

// Role hooks — `mock`-prefixed so the hoisted vi.mock factories may
// reference them; each test sets the return value it needs.
const mockMinistryOwner = vi.fn();
const mockMembership = vi.fn();
const mockRoleClaims = vi.fn();

vi.mock("@/lib/hooks/useMinistryOwner", () => ({
  useMinistryOwner: () => mockMinistryOwner(),
}));
vi.mock("@/lib/hooks/useGroupMembership", () => ({
  useGroupMembership: () => mockMembership(),
}));
vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: () => mockRoleClaims(),
}));

// Data hooks — static empty payloads; these pages only need to render.
vi.mock("@/lib/hooks/useMinistryFeed", () => ({
  useMinistryFeed: () => ({ posts: [], loading: false, error: null }),
}));
vi.mock("@/lib/hooks/useGroupSermons", () => ({
  useGroupSermons: () => ({
    sermons: [],
    preachers: [],
    loading: false,
    error: null,
  }),
}));
vi.mock("@/lib/hooks/useEvents", () => ({
  useEvents: () => ({
    events: [],
    loading: false,
    error: null,
    createEvent: vi.fn(),
    rsvp: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/useDevotionals", () => ({
  useDevotionals: () => ({ devotionals: [], loading: false }),
  useGroupDevotionals: () => ({ devotionals: [], loading: false }),
}));
vi.mock("@/lib/hooks/useReadingPlans", () => ({
  useReadingPlans: () => ({ plans: [], loading: false }),
}));
vi.mock("@/lib/hooks/useBoards", () => ({
  useBoards: () => ({ boards: [], loading: false }),
}));

import MinistryFeedPage from "@/app/(authed)/feed/page";
import SermonsListPage from "@/app/(authed)/groups/[gid]/sermons/page";
import EventsListPage from "@/app/(authed)/groups/[gid]/events/page";
import GroupDevotionalsPage from "@/app/(authed)/groups/[gid]/devotionals/page";
import DevotionalsIndexPage from "@/app/(authed)/devotionals/page";
import ReadingPlansIndexPage from "@/app/(authed)/reading-plans/page";
import BoardsPage from "@/app/(authed)/boards/page";

const leader = { isLeader: true, membership: null, role: null, loading: false };
const member = {
  isLeader: false,
  membership: null,
  role: null,
  loading: false,
};

beforeEach(() => {
  mockMinistryOwner.mockReset();
  mockMembership.mockReset();
  mockRoleClaims.mockReset();
});

/**
 * Asserts the page rendered both a FloatingActionBar (mobile) and a
 * desktop-only inline CTA for the same `name`, and returns the bar.
 */
function expectMobileAndDesktopCta(role: "link" | "button", name: RegExp) {
  const bar = screen.getByTestId("floating-action-bar");
  expect(bar).toHaveClass("md:hidden");
  expect(within(bar).getByRole(role, { name })).toBeInTheDocument();

  const all = screen.getAllByRole(role, { name });
  const inline = all.find((el) => !bar.contains(el));
  expect(inline, "expected a desktop inline CTA").toBeDefined();
  expect(inline).toHaveClass("md:inline-flex");
  return bar;
}

describe("FloatingActionBar — organization feed", () => {
  it("shows the bar for the organization owner", () => {
    mockMinistryOwner.mockReturnValue(true);
    render(<MinistryFeedPage />);
    const bar = expectMobileAndDesktopCta("link", /new post/i);
    expect(within(bar).getByRole("link", { name: /new post/i })).toHaveAttribute(
      "href",
      "/feed/new",
    );
  });

  it("hides the bar from non-owners", () => {
    mockMinistryOwner.mockReturnValue(false);
    render(<MinistryFeedPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — sermons", () => {
  it("shows the bar for a group leader", () => {
    mockMembership.mockReturnValue(leader);
    render(<SermonsListPage />);
    const bar = expectMobileAndDesktopCta("link", /add sermon/i);
    expect(
      within(bar).getByRole("link", { name: /add sermon/i }),
    ).toHaveAttribute("href", "/groups/g1/sermons/new");
  });

  it("hides the bar from ordinary members", () => {
    mockMembership.mockReturnValue(member);
    render(<SermonsListPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — events", () => {
  it("shows the bar for a group leader and opens the form on tap", () => {
    mockMembership.mockReturnValue(leader);
    render(<EventsListPage />);
    const bar = expectMobileAndDesktopCta("button", /new event/i);
    // Tapping the bar opens the inline create form.
    fireEvent.click(within(bar).getByRole("button", { name: /new event/i }));
    expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
  });

  it("hides the bar from ordinary members", () => {
    mockMembership.mockReturnValue(member);
    render(<EventsListPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — group devotionals", () => {
  it("shows the bar for a group leader", () => {
    mockMembership.mockReturnValue(leader);
    render(<GroupDevotionalsPage />);
    const bar = expectMobileAndDesktopCta("link", /write devotional/i);
    expect(
      within(bar).getByRole("link", { name: /write devotional/i }),
    ).toHaveAttribute("href", "/groups/g1/devotionals/new");
  });

  it("hides the bar from ordinary members", () => {
    mockMembership.mockReturnValue(member);
    render(<GroupDevotionalsPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — platform devotionals", () => {
  it("shows the bar for the organization owner", () => {
    mockRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: true,
    });
    render(<DevotionalsIndexPage />);
    expectMobileAndDesktopCta("link", /write devotional/i);
  });

  it("hides the bar from ordinary readers", () => {
    mockRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: false,
    });
    render(<DevotionalsIndexPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — reading plans", () => {
  it("shows the bar for an admin", () => {
    mockRoleClaims.mockReturnValue({
      isAdmin: true,
      isModerator: false,
      isMinistryOwner: false,
    });
    render(<ReadingPlansIndexPage />);
    expectMobileAndDesktopCta("link", /new plan/i);
  });

  it("hides the bar from non-admins", () => {
    mockRoleClaims.mockReturnValue({
      isAdmin: false,
      isModerator: false,
      isMinistryOwner: false,
    });
    render(<ReadingPlansIndexPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});

describe("FloatingActionBar — pages with no single dominant action", () => {
  it("is absent from the boards index", () => {
    render(<BoardsPage />);
    expect(
      screen.queryByTestId("floating-action-bar"),
    ).not.toBeInTheDocument();
  });
});
