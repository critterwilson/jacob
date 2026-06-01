/**
 * @vitest-environment jsdom
 *
 * Post-v2-redesign: `/home` is no longer a destination — it redirects to
 * `/groups`, where the weekly sermon now lives (the surface members land
 * on). This spec covers the new shell, the redirect, the Groups landing
 * surface, and the shared home components (RecentActivity / VideoEmbed /
 * WeeklySermon) that survive.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module stubs ──────────────────────────────────────────────────────────────

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/groups",
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

vi.mock("@/lib/hooks/useMyOrgs", () => ({
  useMyOrgs: () => ({ orgs: [], loading: false, error: null }),
}));

vi.mock("@/lib/hooks/useRoleClaims", () => ({
  useRoleClaims: () => ({
    isAdmin: false,
    isModerator: false,
    isMinistryOwner: false,
  }),
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
  apiGetConditional: vi.fn(),
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
import HomeRedirect from "@/app/(authed)/home/page";
import GroupsPage from "@/app/(authed)/groups/page";

beforeEach(() => {
  mockReplace.mockReset();
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
});

// ── AppShell (drawer removed; desktop sidebar + slim mobile top bar) ──────────

describe("AppShell", () => {
  it("renders desktop nav links matching the new IA", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getAllByRole("link", { name: "Groups" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FAQ" })).toBeInTheDocument();
  });

  it("no longer renders a Home nav link", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  });

  it("no longer renders the mobile hamburger drawer", () => {
    render(<AppShell><div /></AppShell>);
    expect(
      screen.queryByRole("button", { name: /open navigation menu/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: /main navigation/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the mobile top-bar account shortcut to /settings", () => {
    render(<AppShell><div /></AppShell>);
    expect(
      screen.getByRole("link", { name: /^account$/i }),
    ).toHaveAttribute("href", "/settings");
  });
});

// ── /home redirect ────────────────────────────────────────────────────────────

describe("HomeRedirect", () => {
  it("redirects /home to /groups", () => {
    render(<HomeRedirect />);
    expect(mockReplace).toHaveBeenCalledWith("/groups");
  });
});

// ── Groups page (where the weekly sermon now lives) ───────────────────────────

describe("GroupsPage", () => {
  it("renders the weekly sermon hero at the top", () => {
    render(<GroupsPage />);
    expect(
      screen.getByRole("heading", { name: "Abiding in the Vine" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This week's sermon")).toBeInTheDocument();
  });

  it("lists the user's groups", () => {
    render(<GroupsPage />);
    expect(screen.getByText("Sunday Study")).toBeInTheDocument();
    expect(screen.getByText("Youth Group")).toBeInTheDocument();
  });

  it("shows an owner-only link to manage the weekly sermon", () => {
    ownerMock = true;
    render(<GroupsPage />);
    expect(
      screen.getByRole("link", { name: /update this week's sermon/i }),
    ).toHaveAttribute("href", "/feed/weekly-sermon");
  });

  it("hides the manage link from non-owners", () => {
    ownerMock = false;
    render(<GroupsPage />);
    expect(
      screen.queryByRole("link", { name: /this week's sermon/i }),
    ).not.toBeInTheDocument();
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
