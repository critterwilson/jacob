/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module stubs ──────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/home",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
}));

const mockUser = { uid: "alice", email: "alice@example.com", displayName: "Alice" };

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

vi.mock("@/lib/hooks/useGroups", () => ({
  useGroups: () => ({
    groups: [
      { id: "g1", name: "Sunday Study", memberCount: 4, description: "" },
      { id: "g2", name: "Youth Group", memberCount: 8, description: "" },
    ],
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/useRecentMessages", () => ({
  useRecentMessages: () => ({
    messages: [
      {
        id: "m1",
        gid: "g1",
        groupName: "Sunday Study",
        authorUid: "alice",
        body: "See you Sunday!",
        createdAt: null,
        deletedAt: null,
        mediaRefs: [],
      },
      {
        id: "m2",
        gid: "g2",
        groupName: "Youth Group",
        authorUid: "bob",
        body: "Great meeting everyone",
        createdAt: null,
        deletedAt: null,
        mediaRefs: [],
      },
    ],
    loading: false,
  }),
}));

let maintenanceFlag = false;

vi.mock("@/lib/hooks/useMaintenanceBanner", () => ({
  useMaintenanceBanner: () => ({ maintenance: maintenanceFlag, loading: false }),
}));

vi.mock("@/lib/hooks/useDeletionStatus", () => ({
  useDeletionStatus: () => ({ pending: false, finalizeAt: null, keepBody: true }),
}));

vi.mock("@/lib/hooks/useDailyVerse", () => ({
  useDailyVerse: () => ({
    verse: {
      reference: "John 3:16",
      translation: "WEB",
      text: "For God so loved the world.",
      source: "bible-api.com",
    },
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/usePushSetup", () => ({
  usePushSetup: vi.fn(),
}));

vi.mock("@/lib/push", () => ({
  registerPushToken: vi.fn(async () => null),
  touchDeviceLastSeen: vi.fn(async () => {}),
}));

vi.mock("@/components/nav/PushPrompt", () => ({
  PushPrompt: () => null,
}));

vi.mock("@/components/nav/InstallPrompt", () => ({
  InstallPrompt: () => null,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { AppShell } from "@/components/nav/AppShell";
import { RecentActivity } from "@/components/home/RecentActivity";
import HomePage from "@/app/(authed)/home/page";

beforeEach(() => {
  maintenanceFlag = false;
  vi.restoreAllMocks();
});

// ── AppShell ──────────────────────────────────────────────────────────────────

describe("AppShell", () => {
  it("renders desktop nav links", () => {
    render(<AppShell><div /></AppShell>);
    // "Chats" appears in the desktop sidebar drawer AND the mobile bottom
    // tab bar (rendered with md:hidden). About / FAQ only live in the
    // drawer's long-tail menu, so they remain unique.
    expect(screen.getAllByRole("link", { name: "Chats" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FAQ" })).toBeInTheDocument();
  });

  it("shows hamburger button on mobile header", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("button", { name: /open navigation menu/i })).toBeInTheDocument();
  });

  it("opens and closes mobile drawer", async () => {
    render(<AppShell><div /></AppShell>);
    const hamburger = screen.getByRole("button", { name: /open navigation menu/i });

    // Drawer not visible yet
    expect(screen.queryByRole("button", { name: /close navigation menu/i })).not.toBeInTheDocument();

    await userEvent.click(hamburger);
    expect(screen.getByRole("button", { name: /close navigation menu/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close navigation menu/i }));
    expect(screen.queryByRole("button", { name: /close navigation menu/i })).not.toBeInTheDocument();
  });
});

// ── RecentActivity ────────────────────────────────────────────────────────────

describe("RecentActivity", () => {
  it("renders messages with group names", () => {
    const msgs = [
      {
        id: "m1", gid: "g1", groupName: "Sunday Study",
        authorUid: "alice", body: "Hello world", createdAt: null, deletedAt: null, mediaRefs: [],
      },
    ];
    render(<RecentActivity messages={msgs} loading={false} />);
    expect(screen.getByText("Sunday Study")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows empty state when no messages", () => {
    render(<RecentActivity messages={[]} loading={false} />);
    expect(screen.getByText(/no recent messages/i)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<RecentActivity messages={[]} loading={true} />);
    expect(screen.getByText(/loading recent activity/i)).toBeInTheDocument();
  });

  it("shows photo placeholder when body is empty and mediaRefs has items", () => {
    const msgs = [
      {
        id: "m2", gid: "g1", groupName: "Sunday Study",
        authorUid: "alice", body: "", createdAt: null, deletedAt: null, mediaRefs: ["gs://bucket/photo.jpg"],
      },
    ];
    render(<RecentActivity messages={msgs} loading={false} />);
    expect(screen.getByText(/📷 Photo/)).toBeInTheDocument();
  });
});

// ── HomePage ──────────────────────────────────────────────────────────────────

describe("HomePage", () => {
  it("renders welcome heading and groups", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /welcome/i })).toBeInTheDocument();
    expect(screen.getAllByText("Sunday Study").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Youth Group").length).toBeGreaterThan(0);
  });

  it("renders recent messages", () => {
    render(<HomePage />);
    expect(screen.getByText("See you Sunday!")).toBeInTheDocument();
    expect(screen.getByText("Great meeting everyone")).toBeInTheDocument();
  });

  it("does NOT show maintenance banner when flag is off", () => {
    render(<HomePage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows maintenance banner when flag is on", () => {
    maintenanceFlag = true;
    render(<HomePage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/maintenance/i);
  });
});
