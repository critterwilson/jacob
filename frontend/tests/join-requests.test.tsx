/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: {}, firestore: {} }));

const mockGetIdToken = vi.fn().mockResolvedValue("fake-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "leader1", email: "leader@example.com", getIdToken: mockGetIdToken },
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/useGroup", () => ({
  useGroup: () => ({ group: { name: "Test Group" }, loading: false }),
}));

// ── useGroupMembership — leader by default ───────────────────────────────────
const mockIsLeader = vi.fn(() => true);
vi.mock("@/lib/hooks/useGroupMembership", () => ({
  useGroupMembership: () => ({
    isLeader: mockIsLeader(),
    loading: false,
    membership: { role: "leader" },
  }),
}));

// ── useJoinRequests ──────────────────────────────────────────────────────────
const mockRefresh = vi.fn();
const mockJoinRequestsState = vi.fn();

vi.mock("@/lib/hooks/useJoinRequests", () => ({
  useJoinRequests: () => mockJoinRequestsState(),
}));

import JoinRequestsPage from "@/app/(authed)/groups/[gid]/join-requests/page";

const PENDING_REQ = {
  uid: "user-a",
  displayName: "Alice Smith",
  photoURL: null,
  message: "I'd love to join!",
  requestedAt: "2026-05-15T10:00:00Z",
  status: "pending" as const,
};

const PENDING_REQ_2 = {
  uid: "user-b",
  displayName: "Bob Jones",
  photoURL: null,
  message: "",
  requestedAt: "2026-05-16T10:00:00Z",
  status: "pending" as const,
};

beforeEach(() => {
  mockRefresh.mockClear();
  mockGetIdToken.mockClear();
  mockIsLeader.mockReturnValue(true);
  mockJoinRequestsState.mockReturnValue({
    state: { status: "ok", requests: [PENDING_REQ, PENDING_REQ_2], nextCursor: null },
    pendingCount: 2,
    refresh: mockRefresh,
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("JoinRequestsPage", () => {
  it("renders pending requests", async () => {
    render(<JoinRequestsPage params={{ gid: "g1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    });
  });

  it("shows the requester message when present", async () => {
    render(<JoinRequestsPage params={{ gid: "g1" }} />);
    await waitFor(() => {
      expect(screen.getByText(/I'd love to join!/)).toBeInTheDocument();
    });
  });

  it("renders a minor (pending_leader) row with the forward-to-owner affordance", async () => {
    const MINOR_REQ = {
      uid: "kid",
      displayName: "Casey Minor",
      photoURL: null,
      message: "can I join?",
      requestedAt: "2026-05-17T10:00:00Z",
      status: "pending_leader" as const,
      isMinor: true,
      requiresOwnerReview: true,
    };
    mockJoinRequestsState.mockReturnValue({
      state: { status: "ok", requests: [MINOR_REQ], nextCursor: null },
      pendingCount: 1,
      refresh: mockRefresh,
    });
    render(<JoinRequestsPage params={{ gid: "g1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Casey Minor")).toBeInTheDocument();
    });
    expect(screen.getByTestId("minor-note-kid")).toHaveTextContent(
      /your approval forwards to the owner/i,
    );
    // The approve button is relabeled to make the vouch semantics clear.
    expect(screen.getByTestId("approve-kid")).toHaveTextContent(
      /vouch & forward/i,
    );
  });

  it("approve calls correct endpoint and refreshes", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ gid: "g1", uid: "user-a", status: "approved" }),
    } as Response);

    const user = userEvent.setup();
    render(<JoinRequestsPage params={{ gid: "g1" }} />);

    await waitFor(() => screen.getByTestId("approve-user-a"));
    await user.click(screen.getByTestId("approve-user-a"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g1/join-requests/user-a/approve"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("reject calls correct endpoint and refreshes", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ gid: "g1", uid: "user-a", status: "rejected" }),
    } as Response);

    const user = userEvent.setup();
    render(<JoinRequestsPage params={{ gid: "g1" }} />);

    await waitFor(() => screen.getByTestId("reject-user-a"));
    await user.click(screen.getByTestId("reject-user-a"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g1/join-requests/user-a/reject"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows at-cap error when approve returns group_at_cap", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "group_at_cap", message: "This group is at its member limit." },
      }),
    } as Response);

    const user = userEvent.setup();
    render(<JoinRequestsPage params={{ gid: "g1" }} />);

    await waitFor(() => screen.getByTestId("approve-user-a"));
    await user.click(screen.getByTestId("approve-user-a"));

    await waitFor(() =>
      expect(screen.getByTestId("at-cap-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("at-cap-error")).toHaveTextContent(/member limit/i);
  });

  it("shows empty state when no pending requests", async () => {
    mockJoinRequestsState.mockReturnValue({
      state: { status: "ok", requests: [], nextCursor: null },
      pendingCount: 0,
      refresh: mockRefresh,
    });

    render(<JoinRequestsPage params={{ gid: "g1" }} />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-state")).toBeInTheDocument(),
    );
    expect(screen.getByText(/no pending join requests/i)).toBeInTheDocument();
  });

  it("non-leader is redirected (useJoinRequests not called with gid)", async () => {
    mockIsLeader.mockReturnValue(false);
    // When not a leader, useJoinRequests is called with undefined, returns empty
    mockJoinRequestsState.mockReturnValue({
      state: { status: "ok", requests: [], nextCursor: null },
      pendingCount: 0,
      refresh: mockRefresh,
    });

    render(<JoinRequestsPage params={{ gid: "g1" }} />);
    // The page redirects and renders null — no request rows visible
    expect(screen.queryByTestId("join-request-row")).not.toBeInTheDocument();
  });
});
