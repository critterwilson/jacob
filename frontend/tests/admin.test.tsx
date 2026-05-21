/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/(authed)/admin/layout";
import AdminGroupsPage from "@/app/(authed)/admin/groups/page";
import AdminUsersPage from "@/app/(authed)/admin/users/page";
import ModerationQueuePage from "@/app/(authed)/admin/queue/page";

// Stable user object — the same reference is returned on every render so
// components that depend on `user` identity (useCallback, useEffect deps) don't
// spin in an infinite update loop.
const mockUser = {
  uid: "admin-uid",
  email: "admin@example.com",
  getIdToken: vi.fn().mockResolvedValue("fake-token"),
  getIdTokenResult: vi.fn().mockResolvedValue({ claims: { admin: true } }),
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

// lib/api reads Firebase auth state via @/lib/firebase. Tests don't run with
// real Firebase env, so stub the module before any page (which transitively
// imports @/lib/api) is loaded.
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/queue",
  useSearchParams: () => new URLSearchParams(),
}));

// Minimal Link stub — renders a plain <a> so Next.js router context is not needed.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
      [k: string]: unknown;
    }) => React.createElement("a", { href, ...rest }, children),
  };
});

// ── fetch mock setup ──────────────────────────────────────────────────────────

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── AdminLayout ───────────────────────────────────────────────────────────────

describe("AdminLayout", () => {
  it("renders admin nav links once claim resolves", async () => {
    render(<AdminLayout>content</AdminLayout>);
    await waitFor(() =>
      expect(screen.getByText("Moderation Queue")).toBeInTheDocument(),
    );
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Groups")).toBeInTheDocument();
  });
});

// ── ModerationQueuePage ───────────────────────────────────────────────────────

describe("ModerationQueuePage", () => {
  it("shows empty state when API returns no items", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    });
    render(<ModerationQueuePage />);
    await waitFor(() =>
      expect(
        screen.getByText("No items match the current filters."),
      ).toBeInTheDocument(),
    );
  });

  it("renders items returned by the API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            itemId: "item-1",
            resourceRef: "uploads/abc",
            reason: "safesearch_adult",
            severity: 2,
            status: "pending",
            uploaderUid: "user-x",
            reportedBy: null,
            resourceType: null,
            groupId: null,
            context: null,
            auto: false,
            createdAt: null,
            extra: {},
          },
        ],
        nextCursor: null,
      }),
    });
    render(<ModerationQueuePage />);
    await waitFor(() =>
      expect(screen.getByText("uploads/abc")).toBeInTheDocument(),
    );
    expect(screen.getByText(/safesearch_adult/)).toBeInTheDocument();
  });

  it("calls resolve API when Approve is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              itemId: "item-1",
              resourceRef: "uploads/abc",
              reason: "test",
              severity: 1,
              status: "pending",
              uploaderUid: "user-x",
              reportedBy: null,
              resourceType: null,
              groupId: null,
              context: null,
              auto: false,
              createdAt: null,
              extra: {},
            },
          ],
          nextCursor: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ itemId: "item-1", status: "approved" }),
      });

    render(<ModerationQueuePage />);
    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/resolve"),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body as string).resolution).toBe("approve");
    });
  });

  it("sends ?status=&reason= query params to /api/admin/moderation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    });
    render(<ModerationQueuePage />);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/api/v1/admin/moderation"),
      );
      expect(call).toBeDefined();
      expect(String(call![0])).toContain("status=pending");
      expect(String(call![0])).toContain("limit=25");
    });
  });
});

// ── AdminUsersPage ────────────────────────────────────────────────────────────

describe("AdminUsersPage", () => {
  it("renders search input and Search button", () => {
    render(<AdminUsersPage />);
    expect(screen.getByPlaceholderText(/search by display name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("shows users returned by the API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          {
            uid: "uid-1",
            displayName: "Alice",
            email: "alice@example.com",
            createdAt: null,
            isBanned: false,
          },
        ],
      }),
    });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });

  it("shows Unban button for banned users", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          {
            uid: "uid-banned",
            displayName: "Eve",
            email: "eve@example.com",
            createdAt: null,
            isBanned: true,
          },
        ],
      }),
    });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unban" })).toBeInTheDocument(),
    );
  });
});

// ── AdminGroupsPage ───────────────────────────────────────────────────────────

describe("AdminGroupsPage", () => {
  it("renders search input and Search button", () => {
    render(<AdminGroupsPage />);
    expect(screen.getByPlaceholderText(/search by group name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("shows groups returned by the API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [
          { gid: "g-1", name: "Sunday Crew", memberCount: 5, createdAt: null },
        ],
      }),
    });
    render(<AdminGroupsPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Sunday Crew")).toBeInTheDocument(),
    );
    expect(screen.getByText(/5 members/)).toBeInTheDocument();
  });
});

// ── AdminUsersPage — role management ─────────────────────────────────────────

describe("AdminUsersPage — role management", () => {
  const baseUsers = {
    users: [
      {
        uid: "uid-1",
        displayName: "Alice",
        email: "alice@example.com",
        createdAt: null,
        isBanned: false,
      },
    ],
  };

  const noRoles = {
    uid: "uid-1",
    isAdmin: false,
    isModerator: false,
    isMinistryOwner: false,
  };

  it("shows Manage roles button for each user", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => baseUsers,
    });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /manage roles/i }),
    ).toBeInTheDocument();
  });

  it("opens roles panel and fetches roles on click", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => baseUsers,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => noRoles,
      });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }));
    await waitFor(() =>
      expect(screen.getByText("Moderator")).toBeInTheDocument(),
    );
    expect(screen.getByText("Ministry Owner")).toBeInTheDocument();
    // Roles fetch should have been called for uid-1
    const roleCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/roles"),
    );
    expect(roleCall).toBeDefined();
  });

  it("shows Grant buttons when user has no roles", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => baseUsers })
      .mockResolvedValueOnce({ ok: true, json: async () => noRoles });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /grant/i }).length).toBeGreaterThan(0),
    );
  });

  it("calls moderator endpoint when Grant is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => baseUsers })
      .mockResolvedValueOnce({ ok: true, json: async () => noRoles })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uid: "uid-1", moderator: true }),
      });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /grant/i }).length).toBeGreaterThan(0),
    );
    // Click first Grant button (Moderator row)
    fireEvent.click(screen.getAllByRole("button", { name: /grant/i })[0]!);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/moderator"),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body as string).grant).toBe(true);
    });
  });

  it("shows Revoke buttons when user already has roles", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => baseUsers })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          uid: "uid-1",
          isAdmin: false,
          isModerator: true,
          isMinistryOwner: true,
        }),
      });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /revoke/i }).length).toBeGreaterThan(0),
    );
  });

  it("shows note that admin claim cannot be granted in-app", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => baseUsers })
      .mockResolvedValueOnce({ ok: true, json: async () => noRoles });
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }));
    await waitFor(() =>
      expect(screen.getByText(/Admin SDK script/i)).toBeInTheDocument(),
    );
  });
});
