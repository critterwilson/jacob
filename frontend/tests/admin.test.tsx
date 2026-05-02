/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import AdminGroupsPage from "@/app/admin/groups/page";
import AdminUsersPage from "@/app/admin/users/page";
import ModerationQueuePage from "@/app/admin/queue/page";

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
        String(c[0]).includes("/api/admin/moderation"),
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
