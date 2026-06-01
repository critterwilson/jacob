import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileTabBar } from "@/components/nav/MobileTabBar";
import { useAuth } from "@/lib/auth-context";
import { useGroups, type Group } from "@/lib/hooks/useGroups";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/hooks/useGroups", () => ({
  useGroups: vi.fn(),
}));

vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: vi.fn(),
}));

const mockUsePathname = vi.mocked(usePathname);
const mockUseAuth = vi.mocked(useAuth);
const mockUseGroups = vi.mocked(useGroups);
const mockUseRoleClaims = vi.mocked(useRoleClaims);

const NO_CLAIMS = {
  isAdmin: false,
  isModerator: false,
  isMinistryOwner: false,
};

// Build a complete Group matching the useGroups projection. The tab bar only
// reads `role`, but the mock return is type-checked against the full type, so
// supply every field and override per test.
const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: "g1",
  gid: "g1",
  name: "Tuesday Teens",
  description: "",
  avatarUrl: null,
  isPrivate: false,
  archivedAt: null,
  role: "member",
  joinedAt: null,
  memberCount: 5,
  lastMessageAt: null,
  ...overrides,
});

beforeEach(() => {
  mockUsePathname.mockReturnValue("/groups");
  // useAuth returns a broad shape across the app; the tab bar only reads
  // `user.uid`, so a minimal stub is enough.
  mockUseAuth.mockReturnValue({ user: { uid: "u1" } } as ReturnType<
    typeof useAuth
  >);
  mockUseGroups.mockReturnValue({ groups: [], loading: false, refresh: vi.fn() });
  mockUseRoleClaims.mockReturnValue(NO_CLAIMS);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MobileTabBar", () => {
  it("shows the four member destinations and not Manage for a plain member", () => {
    render(<MobileTabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByText("Groups")).toBeInTheDocument();
    expect(within(nav).getByText("Boards")).toBeInTheDocument();
    expect(within(nav).getByText("Events")).toBeInTheDocument();
    expect(within(nav).getByText("Grow")).toBeInTheDocument();

    expect(within(nav).queryByText("Manage")).not.toBeInTheDocument();
    // Home was removed as a destination.
    expect(within(nav).queryByText("Home")).not.toBeInTheDocument();
  });

  it("shows the Manage tab for a privileged claim (admin / ministry owner)", () => {
    mockUseRoleClaims.mockReturnValue({ ...NO_CLAIMS, isMinistryOwner: true });
    render(<MobileTabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByText("Manage")).toBeInTheDocument();
  });

  it("shows the Manage tab when the user leads any group", () => {
    mockUseGroups.mockReturnValue({
      groups: [makeGroup({ id: "g1", gid: "g1", name: "Tuesday Teens", role: "leader" })],
      loading: false,
      refresh: vi.fn(),
    });
    render(<MobileTabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByText("Manage")).toBeInTheDocument();
  });

  it("hides Manage while role claims are still loading (null)", () => {
    mockUseRoleClaims.mockReturnValue(null);
    render(<MobileTabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).queryByText("Manage")).not.toBeInTheDocument();
  });

  it("marks the active tab with aria-current=page", () => {
    mockUsePathname.mockReturnValue("/groups");
    render(<MobileTabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const groupsLink = within(nav).getByRole("link", { name: /groups/i });
    expect(groupsLink).toHaveAttribute("aria-current", "page");

    const boardsLink = within(nav).getByRole("link", { name: /boards/i });
    expect(boardsLink).not.toHaveAttribute("aria-current");
  });
});
