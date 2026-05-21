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

// ── home-surface section hooks ────────────────────────────────────────────────

type PlanTodayMock = {
  data: import("@/lib/hooks/useReadingPlans").ActivePlanToday | null;
  loading: boolean;
};
let planTodayMock: PlanTodayMock = {
  data: {
    plan: {
      slug: "psalms",
      title: "Psalms in 21 days",
      description: "A walk through the Psalter.",
      duration: 21,
      audience: "christian",
      publishedAt: null,
    },
    nextDay: {
      dayNumber: 3,
      scriptureRef: "Psalm 3",
      prompt: "Reflect on God as a shield.",
    },
    completedDays: [1, 2],
    streak: 2,
    lastCompletedAt: null,
    allDaysComplete: false,
  },
  loading: false,
};

vi.mock("@/lib/hooks/useReadingPlans", () => ({
  useReadingPlanToday: () => planTodayMock,
  // The page imports this name; export it as the existing real hook
  // would. Components on /home don't use these, but TS picks them up.
  useReadingPlans: () => ({ plans: [], loading: false }),
  useReadingPlan: () => ({ plan: null, loading: false }),
  usePlanProgress: () => ({
    progress: null,
    loading: false,
    reload: vi.fn(),
    markComplete: vi.fn(),
  }),
}));

type DevotionalsMock = {
  devotionals: import("@/lib/hooks/useDevotionals").Devotional[];
  loading: boolean;
};
let devotionalsMock: DevotionalsMock = {
  devotionals: [
    {
      slug: "abide",
      title: "Abide",
      scriptureRef: "John 15:5",
      body: "**Abide in me**, as I in you.",
      audioUrl: null,
      sourceAttribution: "Public domain.",
      publishedAt: null,
      audience: "christian",
      groupId: null,
      groupName: null,
    },
  ],
  loading: false,
};

vi.mock("@/lib/hooks/useDevotionals", () => ({
  useDevotionals: () => devotionalsMock,
  useDevotional: () => ({ devotional: null, loading: false }),
}));

type MinistryMock = {
  posts: import("@/lib/hooks/useMinistryFeed").MinistryPost[];
  loading: boolean;
  error: string | null;
};
let ministryMock: MinistryMock = {
  posts: [
    {
      postId: "p1",
      title: "Sunday sermon notes",
      body: "Some encouragement for the week.",
      sermonUrl: null,
      coverImageRef: null,
      authorUid: "leader",
      createdAt: null,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      pinnedBy: null,
      reactionCounts: {},
    },
    {
      postId: "p2",
      title: "Pinned: weekly memory verse",
      body: "Romans 12:12 — Rejoice in hope, be patient in tribulation.",
      sermonUrl: null,
      coverImageRef: null,
      authorUid: "leader",
      createdAt: null,
      editedAt: null,
      deletedAt: null,
      pinnedAt: "2026-05-19T00:00:00Z",
      pinnedBy: "leader",
      reactionCounts: {},
    },
  ],
  loading: false,
  error: null,
};

vi.mock("@/lib/hooks/useMinistryFeed", () => ({
  useMinistryFeed: () => ministryMock,
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
import { ContinueReadingPlan } from "@/components/home/ContinueReadingPlan";
import { MinistryHighlights } from "@/components/home/MinistryHighlights";
import { RecentActivity } from "@/components/home/RecentActivity";
import { TodayDevotional } from "@/components/home/TodayDevotional";
import HomePage from "@/app/(authed)/home/page";
import { apiPost } from "@/lib/api";

const mockApiPost = apiPost as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  maintenanceFlag = false;
  planTodayMock = {
    data: {
      plan: {
        slug: "psalms",
        title: "Psalms in 21 days",
        description: "A walk through the Psalter.",
        duration: 21,
        audience: "christian",
        publishedAt: null,
      },
      nextDay: {
        dayNumber: 3,
        scriptureRef: "Psalm 3",
        prompt: "Reflect on God as a shield.",
      },
      completedDays: [1, 2],
      streak: 2,
      lastCompletedAt: null,
      allDaysComplete: false,
    },
    loading: false,
  };
  devotionalsMock = {
    devotionals: [
      {
        slug: "abide",
        title: "Abide",
        scriptureRef: "John 15:5",
        body: "**Abide in me**, as I in you.",
        audioUrl: null,
        sourceAttribution: "Public domain.",
        publishedAt: null,
        audience: "christian",
        groupId: null,
        groupName: null,
      },
    ],
    loading: false,
  };
  ministryMock = {
    posts: [
      {
        postId: "p1",
        title: "Sunday sermon notes",
        body: "Some encouragement for the week.",
        sermonUrl: null,
        coverImageRef: null,
        authorUid: "leader",
        createdAt: null,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        pinnedBy: null,
        reactionCounts: {},
      },
    ],
    loading: false,
    error: null,
  };
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue({});
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

// ── ContinueReadingPlan ───────────────────────────────────────────────────────

describe("ContinueReadingPlan", () => {
  const baseData = planTodayMock.data!;

  it("renders the active plan with next day + streak chip", () => {
    render(<ContinueReadingPlan data={baseData} loading={false} />);
    expect(screen.getByText(/Psalms in 21 days/)).toBeInTheDocument();
    expect(screen.getByText(/Day 3 of 21/)).toBeInTheDocument();
    expect(screen.getByText("Reflect on God as a shield.")).toBeInTheDocument();
    expect(screen.getByText(/2 day streak/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open day 3/ })).toHaveAttribute(
      "href",
      "/reading-plans/psalms/day/3",
    );
  });

  it("renders the empty state when there is no active plan", () => {
    render(<ContinueReadingPlan data={{ ...baseData, plan: null, nextDay: null }} loading={false} />);
    expect(screen.getByText(/haven't started a reading plan yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse reading plans/i })).toHaveAttribute(
      "href",
      "/reading-plans",
    );
  });

  it("renders the completed state when allDaysComplete is true", () => {
    render(
      <ContinueReadingPlan
        data={{ ...baseData, nextDay: null, allDaysComplete: true }}
        loading={false}
      />,
    );
    expect(screen.getByText(/Reading plan complete/i)).toBeInTheDocument();
    expect(screen.getByText(/finished every day/i)).toBeInTheDocument();
  });

  it("renders the skeleton when loading", () => {
    const { container } = render(<ContinueReadingPlan data={null} loading={true} />);
    // Skeleton component renders as a div with role-less placeholder bars.
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Psalms/)).not.toBeInTheDocument();
  });

  it("renders empty state when not loading and data is null", () => {
    render(<ContinueReadingPlan data={null} loading={false} />);
    expect(screen.getByText(/haven't started a reading plan yet/i)).toBeInTheDocument();
  });

  it("marks the next day complete on click and disables the button", async () => {
    const user = userEvent.setup();
    render(<ContinueReadingPlan data={baseData} loading={false} />);

    const button = screen.getByRole("button", { name: /Mark complete/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/reading-plans/psalms/progress/mark",
        { dayNumber: 3 },
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Marked complete/i }),
      ).toBeDisabled();
    });
  });
});

// ── TodayDevotional ───────────────────────────────────────────────────────────

describe("TodayDevotional", () => {
  it("renders title, scripture ref, and a stripped preview", () => {
    render(
      <TodayDevotional
        devotional={{
          slug: "abide",
          title: "Abide",
          scriptureRef: "John 15:5",
          body: "**Abide in me**, as I in you.\nMore body.",
          audioUrl: null,
          sourceAttribution: "",
          publishedAt: null,
          audience: "christian",
          groupId: null,
          groupName: null,
        }}
        loading={false}
      />,
    );
    expect(screen.getByRole("heading", { name: "Abide" })).toBeInTheDocument();
    expect(screen.getByText("John 15:5")).toBeInTheDocument();
    // Markdown emphasis stripped.
    expect(
      screen.getByText(/Abide in me, as I in you. More body./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/devotionals/abide");
  });

  it("renders the empty state when no devotional is supplied", () => {
    render(<TodayDevotional devotional={null} loading={false} />);
    expect(screen.getByText(/No devotionals published yet/i)).toBeInTheDocument();
  });

  it("renders the skeleton when loading", () => {
    const { container } = render(<TodayDevotional devotional={null} loading={true} />);
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No devotionals/i)).not.toBeInTheDocument();
  });
});

// ── MinistryHighlights ───────────────────────────────────────────────────────

describe("MinistryHighlights", () => {
  it("renders up to two posts and skips deleted ones", () => {
    render(
      <MinistryHighlights
        posts={[
          {
            postId: "p1",
            title: "First",
            body: "Body 1",
            sermonUrl: null,
            coverImageRef: null,
            authorUid: "u",
            createdAt: null,
            editedAt: null,
            deletedAt: null,
            pinnedAt: null,
            pinnedBy: null,
            reactionCounts: {},
          },
          {
            postId: "p2",
            title: "Second",
            body: "Body 2",
            sermonUrl: null,
            coverImageRef: null,
            authorUid: "u",
            createdAt: null,
            editedAt: null,
            deletedAt: "2026-01-01T00:00:00Z",
            pinnedAt: null,
            pinnedBy: null,
            reactionCounts: {},
          },
          {
            postId: "p3",
            title: "Third",
            body: "Body 3",
            sermonUrl: null,
            coverImageRef: null,
            authorUid: "u",
            createdAt: null,
            editedAt: null,
            deletedAt: null,
            pinnedAt: null,
            pinnedBy: null,
            reactionCounts: {},
          },
          {
            postId: "p4",
            title: "Fourth",
            body: "Body 4",
            sermonUrl: null,
            coverImageRef: null,
            authorUid: "u",
            createdAt: null,
            editedAt: null,
            deletedAt: null,
            pinnedAt: null,
            pinnedBy: null,
            reactionCounts: {},
          },
        ]}
        loading={false}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
    // The deleted post and the post past the limit do not render.
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
    expect(screen.queryByText("Fourth")).not.toBeInTheDocument();
  });

  it("flags pinned posts with the Pinned eyebrow", () => {
    render(
      <MinistryHighlights
        posts={[
          {
            postId: "p1",
            title: "A nice update",
            body: "",
            sermonUrl: null,
            coverImageRef: null,
            authorUid: "u",
            createdAt: null,
            editedAt: null,
            deletedAt: null,
            pinnedAt: "2026-05-19T00:00:00Z",
            pinnedBy: "leader",
            reactionCounts: {},
          },
        ]}
        loading={false}
      />,
    );
    expect(screen.getByText("Pinned")).toBeInTheDocument();
  });

  it("renders the empty state with a feed link when no posts", () => {
    render(<MinistryHighlights posts={[]} loading={false} />);
    expect(screen.getByText(/Nothing posted yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open ministry feed/i })).toHaveAttribute(
      "href",
      "/feed",
    );
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

  it("renders all composed sections — verse, plan, devotional, ministry, groups, activity, browse", () => {
    render(<HomePage />);
    // Verse (from DailyVerse mock)
    expect(screen.getByText(/For God so loved the world/i)).toBeInTheDocument();
    // Reading plan section
    expect(screen.getByText(/Psalms in 21 days/)).toBeInTheDocument();
    expect(screen.getByText(/Day 3 of 21/)).toBeInTheDocument();
    // Devotional section
    expect(screen.getByRole("heading", { name: "Abide" })).toBeInTheDocument();
    // Ministry section
    expect(screen.getByText(/Sunday sermon notes/)).toBeInTheDocument();
    // Recent activity
    expect(screen.getByText("See you Sunday!")).toBeInTheDocument();
    // Browse
    expect(screen.getByRole("link", { name: /Devotionals/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reading plans/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Discover groups/ })).toBeInTheDocument();
  });

  it("shows the no-plan empty state when the user has no progress", () => {
    planTodayMock = {
      data: {
        plan: null,
        nextDay: null,
        completedDays: [],
        streak: 0,
        lastCompletedAt: null,
        allDaysComplete: false,
      },
      loading: false,
    };
    render(<HomePage />);
    expect(screen.getByText(/haven't started a reading plan yet/i)).toBeInTheDocument();
  });

  it("shows the ministry-feed empty state when no posts", () => {
    ministryMock = { posts: [], loading: false, error: null };
    render(<HomePage />);
    expect(screen.getByText(/Nothing posted yet/i)).toBeInTheDocument();
  });

  it("shows the devotional empty state when no devotionals are published", () => {
    devotionalsMock = { devotionals: [], loading: false };
    render(<HomePage />);
    expect(screen.getByText(/No devotionals published yet/i)).toBeInTheDocument();
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
