/**
 * @vitest-environment jsdom
 *
 * Asserts the mobile bottom tab bar's four slots (Home / Groups /
 * Boards / Grow) and the AppShell mobile-header "Account" shortcut that
 * replaces the now-removed You tab. The organization feed is not a tab;
 * it lives in the drawer's Explore section.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/home",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
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

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useDeletionStatus", () => ({
  useDeletionStatus: () => ({ pending: false, finalizeAt: null, keepBody: true }),
}));

import { MobileTabBar } from "@/components/nav/MobileTabBar";
import { AppShell } from "@/components/nav/AppShell";

describe("MobileTabBar", () => {
  it("renders the four primary destinations ending with Grow", () => {
    render(<MobileTabBar />);
    const tabs = screen.getAllByRole("link");
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      "Home",
      "Groups",
      "Boards",
      "Grow",
    ]);
    expect(tabs[1]).toHaveAttribute("href", "/groups");
    expect(tabs[3]).toHaveAttribute("href", "/grow");
  });

  it("does not render an organization Feed tab", () => {
    render(<MobileTabBar />);
    expect(
      screen.queryByRole("link", { name: /^feed$/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render a You / Settings tab", () => {
    render(<MobileTabBar />);
    expect(
      screen.queryByRole("link", { name: /^you$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^settings$/i }),
    ).not.toBeInTheDocument();
  });

  it("is pinned to the bottom of the viewport (fixed, full-width, above content)", () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole("navigation", { name: /primary navigation/i });
    // Always-visible: fixed at the bottom edge, never scrolls away.
    expect(nav).toHaveClass("fixed");
    expect(nav).toHaveClass("bottom-0");
    expect(nav).toHaveClass("inset-x-0");
    // Above page content, below drawer (z-40) / dialogs (z-50).
    expect(nav).toHaveClass("z-30");
    // Lifts touch targets above the iOS home indicator.
    expect(nav).toHaveClass("pb-safe-b");
  });
});

describe("AppShell mobile header", () => {
  it("renders the Account shortcut linking to /settings", () => {
    render(
      <AppShell>
        <div />
      </AppShell>,
    );
    const account = screen.getByRole("link", { name: /^account$/i });
    expect(account).toHaveAttribute("href", "/settings");
  });
});
