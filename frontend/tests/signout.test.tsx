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
  usePathname: () => "/groups",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiGetConditional: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
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
  it("calls signOut and redirects to /sign-in when the sidebar button is clicked", async () => {
    mockSignOut.mockResolvedValue(undefined);

    render(
      <AppShell>
        <div />
      </AppShell>,
    );

    // The desktop sidebar renders the only "Sign out" button now (the
    // mobile drawer that previously carried a second one was removed).
    const button = screen.getByRole("button", { name: /sign out/i });
    await userEvent.click(button);

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

    const button = screen.getByRole("button", { name: /sign out/i });
    await userEvent.click(button);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    // Button re-enables after failure so the user can retry.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^sign out$/i }),
      ).not.toBeDisabled(),
    );
  });
});
