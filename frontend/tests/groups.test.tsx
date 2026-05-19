/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub Next.js navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

// Stub Firebase singletons — network calls must never happen in tests
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

// Stub auth state — most tests use an authed user
const mockGetIdToken = vi.fn().mockResolvedValue("fake-id-token");
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", getIdToken: mockGetIdToken },
    loading: false,
    signOut: vi.fn(),
  }),
}));

import { CreateGroupForm } from "@/components/groups/CreateGroupForm";

beforeEach(() => {
  mockPush.mockClear();
  mockGetIdToken.mockClear();
  vi.restoreAllMocks();
  // Reset fetch mock between tests
  vi.stubGlobal("fetch", vi.fn());
});

// ── CreateGroupForm ───────────────────────────────────────────────────────────

describe("CreateGroupForm", () => {
  it("shows validation error when name is empty", async () => {
    render(<CreateGroupForm />);
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));
    expect(await screen.findByText(/group name is required/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows validation error when name exceeds 100 characters", async () => {
    render(<CreateGroupForm />);
    await userEvent.type(
      screen.getByLabelText(/group name/i),
      "a".repeat(101),
    );
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));
    expect(await screen.findByText(/100 characters/i)).toBeInTheDocument();
  });

  it("calls API and redirects on success", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ groupId: "new-group-id", inviteCode: "ABCD1234" }),
    } as Response);

    render(<CreateGroupForm />);
    await userEvent.type(screen.getByLabelText(/group name/i), "Sunday Study");
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/groups/new-group-id"));
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/groups$/);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "Sunday Study",
    });
  });

  it("shows API error message on failure", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Server unavailable" } }),
    } as Response);

    render(<CreateGroupForm />);
    await userEvent.type(screen.getByLabelText(/group name/i), "Bad Group");
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));

    expect(await screen.findByText(/server unavailable/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("includes isPrivate=true when checkbox is checked", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ groupId: "g1", inviteCode: "ABCD1234" }),
    } as Response);

    render(<CreateGroupForm />);
    await userEvent.type(screen.getByLabelText(/group name/i), "Private Group");
    await userEvent.click(screen.getByLabelText(/private group/i));
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).isPrivate).toBe(true);
  });
});
