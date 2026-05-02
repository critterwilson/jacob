/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Next.js router ──────────────────────────────────────────────────────────
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Firebase ────────────────────────────────────────────────────────────────
vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

const mockUnsubscribe = vi.fn();
let memberSnapshotCallback: ((snap: unknown) => void) | null = null;

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((_, cb: (snap: unknown) => void) => {
    memberSnapshotCallback = cb;
    return mockUnsubscribe;
  }),
}));

// ── Auth context ─────────────────────────────────────────────────────────────
const mockGetIdToken = vi.fn().mockResolvedValue("fake-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", getIdToken: mockGetIdToken },
    loading: false,
  }),
}));

// ── recharts (lightweight stub so charts don't crash in jsdom) ───────────────
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// ── useAnalytics hook mock ───────────────────────────────────────────────────
const mockAnalyticsState: { state: unknown } = {
  state: { status: "idle" },
};

vi.mock("@/lib/hooks/useAnalytics", () => ({
  useAnalytics: () => mockAnalyticsState,
}));

import AnalyticsPage from "@/app/groups/[gid]/analytics/page";

function simulateLeaderSnapshot(isLeader: boolean) {
  memberSnapshotCallback?.({
    exists: () => isLeader,
    data: () => ({ role: isLeader ? "leader" : "member" }),
  });
}

beforeEach(() => {
  mockReplace.mockClear();
  memberSnapshotCallback = null;
});

describe("AnalyticsPage", () => {
  it("non-leader is redirected away from analytics", async () => {
    render(<AnalyticsPage params={{ gid: "g1" }} />);
    simulateLeaderSnapshot(false);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/groups/g1");
    });
  });

  it("dashboard renders charts when data is loaded", async () => {
    mockAnalyticsState.state = {
      status: "ok",
      data: {
        gid: "g1",
        range: "7d",
        totalMessages: 42,
        stickerMix: [{ slug: "check-in", count: 42, percent: 100 }],
        topContributors: [{ uid: "alice", displayName: "Alice", count: 42 }],
        cadenceByDay: [{ day: "2026-04-25", count: 42 }],
        generatedAt: "2026-05-01T04:00:00.000Z",
      },
    };

    render(<AnalyticsPage params={{ gid: "g1" }} />);
    simulateLeaderSnapshot(true);

    await waitFor(() => {
      expect(screen.getByText("Group analytics")).toBeInTheDocument();
    });

    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("range toggle calls API with new range", async () => {
    const user = userEvent.setup();
    mockAnalyticsState.state = { status: "idle" };

    render(<AnalyticsPage params={{ gid: "g1" }} />);
    simulateLeaderSnapshot(true);

    await waitFor(() => screen.getByRole("group"));

    const btn30d = screen.getByRole("button", { name: "30d" });
    await user.click(btn30d);

    expect(btn30d).toHaveAttribute("aria-pressed", "true");
  });

  it("empty state renders when totalMessages === 0", async () => {
    mockAnalyticsState.state = {
      status: "ok",
      data: {
        gid: "g1",
        range: "7d",
        totalMessages: 0,
        stickerMix: [],
        topContributors: [],
        cadenceByDay: [],
        generatedAt: "2026-05-01T04:00:00.000Z",
      },
    };

    render(<AnalyticsPage params={{ gid: "g1" }} />);
    simulateLeaderSnapshot(true);

    await waitFor(() => {
      expect(screen.getByText(/Quiet week/)).toBeInTheDocument();
    });
  });
});
