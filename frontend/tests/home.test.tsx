/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
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

let groupsMock = {
  groups: [
    { id: "g1", name: "Sunday Study", memberCount: 4, description: "" },
    { id: "g2", name: "Youth Group", memberCount: 8, description: "" },
  ],
  loading: false,
};

vi.mock("@/lib/hooks/useGroups", () => ({
  useGroups: () => groupsMock,
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

type SermonMock = {
  sermon: import("@/lib/hooks/useWeeklySermon").WeeklySermon | null;
  loading: boolean;
};
let sermonMock: SermonMock = {
  sermon: {
    weekKey: "2026-W22",
    videoUrl: "https://youtu.be/abc123",
    title: "Abiding in the Vine",
    description: "Reflect on John 15.",
    postedAt: null,
    postedBy: "owner",
    weekStart: "2026-05-25",
  },
  loading: false,
};

vi.mock("@/lib/hooks/useWeeklySermon", () => ({
  useWeeklySermon: () => ({ ...sermonMock, mutate: vi.fn(), error: undefined }),
}));

let ownerMock: boolean | null = false;

vi.mock("@/lib/hooks/useMinistryOwner", () => ({
  useMinistryOwner: () => ownerMock,
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

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({})),
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

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { AppShell } from "@/components/nav/AppShell";
import { RecentActivity } from "@/components/home/RecentActivity";
import { WeeklySermon } from "@/components/home/WeeklySermon";
import { VideoEmbed } from "@/components/media/VideoEmbed";
import HomePage from "@/app/(authed)/home/page";

beforeEach(() => {
  maintenanceFlag = false;
  ownerMock = false;
  groupsMock = {
    groups: [
      { id: "g1", name: "Sunday Study", memberCount: 4, description: "" },
      { id: "g2", name: "Youth Group", memberCount: 8, description: "" },
    ],
    loading: false,
  };
  sermonMock = {
    sermon: {
      weekKey: "2026-W22",
      videoUrl: "https://youtu.be/abc123",
      title: "Abiding in the Vine",
      description: "Reflect on John 15.",
      postedAt: null,
      postedBy: "owner",
      weekStart: "2026-05-25",
    },
    loading: false,
  };
  vi.restoreAllMocks();
});

// ── AppShell ──────────────────────────────────────────────────────────────────

describe("AppShell", () => {
  it("renders desktop nav links", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getAllByRole("link", { name: "Groups" }).length).toBeGreaterThan(0);
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

// ── VideoEmbed ────────────────────────────────────────────────────────────────

describe("VideoEmbed", () => {
  it("embeds a YouTube share URL as an iframe", () => {
    render(<VideoEmbed url="https://youtu.be/dQw4w9WgXcQ" title="Sermon" />);
    const frame = screen.getByTitle("Sermon") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("embeds a YouTube watch URL", () => {
    render(<VideoEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="S" />);
    expect((screen.getByTitle("S") as HTMLIFrameElement).src).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("embeds a Vimeo URL", () => {
    render(<VideoEmbed url="https://vimeo.com/123456789" title="V" />);
    expect((screen.getByTitle("V") as HTMLIFrameElement).src).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("falls back to a Watch link for an unknown provider", () => {
    render(<VideoEmbed url="https://example.com/video.mp4" title="X" />);
    expect(screen.queryByTitle("X")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /watch/i })).toHaveAttribute(
      "href",
      "https://example.com/video.mp4",
    );
  });
});

// ── WeeklySermon ──────────────────────────────────────────────────────────────

describe("WeeklySermon", () => {
  const sermon = sermonMock.sermon!;

  it("renders the video embed, title, and description", () => {
    render(<WeeklySermon sermon={sermon} loading={false} />);
    expect(screen.getByRole("heading", { name: "Abiding in the Vine" })).toBeInTheDocument();
    expect(screen.getByText("Reflect on John 15.")).toBeInTheDocument();
    expect(screen.getByTitle("Abiding in the Vine").tagName).toBe("IFRAME");
  });

  it("renders an empty state when no sermon is posted", () => {
    render(<WeeklySermon sermon={null} loading={false} />);
    expect(screen.getByText(/no sermon has been posted yet/i)).toBeInTheDocument();
  });
});

// ── HomePage ──────────────────────────────────────────────────────────────────

describe("HomePage", () => {
  it("shows exactly the two surfaces: weekly sermon hero + recent activity", () => {
    render(<HomePage />);
    // Surface 1 — weekly sermon hero.
    expect(screen.getByRole("heading", { name: "Abiding in the Vine" })).toBeInTheDocument();
    expect(screen.getByText("This week's sermon")).toBeInTheDocument();
    // Surface 2 — recent chat activity.
    expect(screen.getByRole("heading", { name: /recent in your groups/i })).toBeInTheDocument();
    expect(screen.getByText("See you Sunday!")).toBeInTheDocument();
  });

  it("no longer renders the stripped sections", () => {
    render(<HomePage />);
    expect(screen.queryByRole("heading", { name: /^Your groups$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /from your ministry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Browse$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Psalms in 21 days/)).not.toBeInTheDocument();
  });

  it("shows an owner-only link to manage the weekly sermon", () => {
    ownerMock = true;
    render(<HomePage />);
    expect(
      screen.getByRole("link", { name: /update this week's sermon/i }),
    ).toHaveAttribute("href", "/feed/weekly-sermon");
  });

  it("hides the manage link from non-owners", () => {
    ownerMock = false;
    render(<HomePage />);
    expect(
      screen.queryByRole("link", { name: /this week's sermon/i }),
    ).not.toBeInTheDocument();
  });

  it("offers discover/join CTAs when the user is in no groups", () => {
    groupsMock = { groups: [], loading: false };
    render(<HomePage />);
    expect(screen.getByRole("link", { name: /discover groups/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /join with code/i })).toBeInTheDocument();
  });

  it("does NOT show maintenance banner when flag is off", () => {
    render(<HomePage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows maintenance banner when flag is on", () => {
    maintenanceFlag = true;
    render(<HomePage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/maintenance/i);
  });
});
