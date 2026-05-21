/**
 * @vitest-environment jsdom
 *
 * Asserts the mobile bottom tab bar's five slots (Home / Chats / Feed /
 * Boards / Grow) and the AppShell mobile-header "Account" shortcut that
 * replaces the now-removed You tab.
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
  it("renders the five primary destinations ending with Grow", () => {
    render(<MobileTabBar />);
    const tabs = screen.getAllByRole("link");
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      "Home",
      "Chats",
      "Feed",
      "Boards",
      "Grow",
    ]);
    expect(tabs[4]).toHaveAttribute("href", "/grow");
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
