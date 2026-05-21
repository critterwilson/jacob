/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  Timestamp: {
    now: vi.fn(),
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

import { InviteForm } from "@/components/groups/InviteForm";
import { InviteList } from "@/components/groups/InviteList";
import type { Invite } from "@/lib/hooks/useInvites";

const mockFetch = vi.fn();
global.fetch = mockFetch;
const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(global.navigator, "clipboard", {
  value: { writeText: clipboardWriteText },
  writable: true,
  configurable: true,
});

function makeIso(date: Date): string {
  return date.toISOString();
}

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    inviteId: "inv1",
    code: "ABCD1234",
    url: "https://example.com/join/ABCD1234",
    createdAt: null,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

// ── InviteForm ────────────────────────────────────────────────────────────────

describe("InviteForm", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockUseAuth.mockReturnValue({
      user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("token") },
      loading: false,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          inviteId: "inv1",
          code: "ABCD1234",
          url: "https://jacob.app/join?code=ABCD1234",
          expiresAt: null,
          maxUses: null,
          useCount: 0,
        }),
    });
  });

  it("renders expiry and maxUses selects with defaults", () => {
    render(<InviteForm gid="g1" groupName="Sunday Crew" />);
    expect(screen.getByRole("combobox", { name: /expires/i })).toHaveValue("never");
    expect(screen.getByRole("combobox", { name: /max uses/i })).toHaveValue("unlimited");
  });

  it("shows invite URL after successful generation", async () => {
    const user = userEvent.setup();
    render(<InviteForm gid="g1" groupName="Sunday Crew" />);
    await user.click(screen.getByRole("button", { name: /generate invite/i }));
    await waitFor(() => {
      expect(screen.getByText("https://jacob.app/join?code=ABCD1234")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("shows Copied! feedback when Copy is clicked", async () => {
    const user = userEvent.setup();
    render(<InviteForm gid="g1" groupName="Sunday Crew" />);
    await user.click(screen.getByRole("button", { name: /generate invite/i }));
    await waitFor(() => screen.getByRole("button", { name: /copy/i }));
    await user.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument(),
    );
  });

  it("shows error message on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Server error" } }),
    });
    const user = userEvent.setup();
    render(<InviteForm gid="g1" groupName="Sunday Crew" />);
    await user.click(screen.getByRole("button", { name: /generate invite/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    });
  });

  it("posts correct JSON body with selected options", async () => {
    const user = userEvent.setup();
    render(<InviteForm gid="g1" groupName="Sunday Crew" />);
    await user.selectOptions(screen.getByRole("combobox", { name: /expires/i }), "24h");
    await user.selectOptions(screen.getByRole("combobox", { name: /max uses/i }), "1");
    await user.click(screen.getByRole("button", { name: /generate invite/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({ expiry: "24h", maxUses: "1" });
  });
});

// ── InviteList ────────────────────────────────────────────────────────────────

describe("InviteList", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("token") },
      loading: false,
    });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  it("shows empty state when no invites", () => {
    render(<InviteList gid="g1" groupName="Sunday Crew" invites={[]} />);
    expect(screen.getByText(/no invites yet/i)).toBeInTheDocument();
  });

  it("renders invite code and Active status", () => {
    render(<InviteList gid="g1" groupName="Sunday Crew" invites={[makeInvite()]} />);
    expect(screen.getByText("ABCD1234")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Revoked status for revoked invite (no revoke button)", () => {
    const past = new Date(Date.now() - 1000);
    render(
      <InviteList
        gid="g1"
        groupName="Sunday Crew"
        invites={[makeInvite({ revokedAt: makeIso(past) })]}
      />,
    );
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("shows Expired status for expired invite", () => {
    const past = new Date(Date.now() - 3600_000);
    render(
      <InviteList
        gid="g1"
        groupName="Sunday Crew"
        invites={[
          makeInvite({
            expiresAt: makeIso(past),
          }),
        ]}
      />,
    );
    const pills = screen.getAllByText("Expired");
    expect(pills.length).toBeGreaterThan(0);
  });

  it("shows Used up status when useCount >= maxUses", () => {
    render(<InviteList gid="g1" groupName="Sunday Crew" invites={[makeInvite({ maxUses: 1, useCount: 1 })]} />);
    expect(screen.getByText("Used up")).toBeInTheDocument();
  });

  it("displays ∞ when maxUses is null", () => {
    render(<InviteList gid="g1" groupName="Sunday Crew" invites={[makeInvite({ maxUses: null })]} />);
    expect(screen.getByText("∞")).toBeInTheDocument();
  });

  it("calls DELETE on revoke and shows Revoking state", async () => {
    const user = userEvent.setup();
    render(<InviteList gid="g1" groupName="Sunday Crew" invites={[makeInvite()]} />);
    const btn = screen.getByRole("button", { name: /revoke/i });
    await user.click(btn);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/groups/g1/invites/inv1"),
      expect.objectContaining({ method: "DELETE" }),
    ));
  });
});
