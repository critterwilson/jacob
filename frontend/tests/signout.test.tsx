/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockSignOut = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/home",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com" },
    loading: false,
    signOut: mockSignOut,
  }),
}));

vi.mock("@/lib/hooks/useDeletionStatus", () => ({
  useDeletionStatus: () => ({ pending: false, finalizeAt: null, keepBody: true }),
}));

import { AppShell } from "@/components/nav/AppShell";

beforeEach(() => {
  mockReplace.mockReset();
  mockSignOut.mockReset();
});

describe("AppShell sign-out", () => {
  it("calls signOut and redirects to /sign-in when the desktop button is clicked", async () => {
    mockSignOut.mockResolvedValue(undefined);

    render(
      <AppShell>
        <div />
      </AppShell>,
    );

    // The desktop sidebar and the (hidden, until opened) drawer each render
    // a "Sign out" button — the desktop one is always visible.
    const buttons = screen.getAllByRole("button", { name: /sign out/i });
    await userEvent.click(buttons[0]);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/sign-in"),
    );
  });

  it("does not redirect when signOut throws", async () => {
    mockSignOut.mockRejectedValue(new Error("network down"));

    render(
      <AppShell>
        <div />
      </AppShell>,
    );

    const button = screen.getAllByRole("button", { name: /sign out/i })[0];
    await userEvent.click(button);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    // Button re-enables after failure so the user can retry.
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^sign out$/i })[0],
      ).not.toBeDisabled(),
    );
  });

  it("signs out from the mobile drawer and closes it", async () => {
    mockSignOut.mockResolvedValue(undefined);

    render(
      <AppShell>
        <div />
      </AppShell>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    expect(
      screen.getByRole("button", { name: /close navigation menu/i }),
    ).toBeInTheDocument();

    // Now there are two "Sign out" buttons (desktop + drawer); click the
    // drawer one (the second in document order).
    const signOutButtons = screen.getAllByRole("button", { name: /sign out/i });
    expect(signOutButtons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(signOutButtons[signOutButtons.length - 1]);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/sign-in"),
    );
    // Drawer collapsed.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /close navigation menu/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
