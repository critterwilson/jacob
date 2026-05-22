/**
 * @vitest-environment jsdom
 *
 * Guards the claim-staleness fix: a role granted server-side only enters
 * the user's ID token on its next rotation (~1h away), so `useRoleClaims`
 * must force-refresh the token — on mount and again on window focus — for
 * the new role to surface without a re-login.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIdTokenResult = vi.fn();
const mockUser = { uid: "u1", getIdTokenResult: mockGetIdTokenResult };

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

beforeEach(() => {
  mockGetIdTokenResult.mockReset();
});

describe("useRoleClaims", () => {
  it("force-refreshes the ID token on mount", async () => {
    mockGetIdTokenResult.mockResolvedValue({ claims: { admin: true } });

    const { result } = renderHook(() => useRoleClaims());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      isAdmin: true,
      isModerator: false,
      isMinistryOwner: false,
    });
    // A cached token would not carry a role granted moments ago — the
    // read must pass `true` to force a network refresh.
    expect(mockGetIdTokenResult).toHaveBeenCalledWith(true);
  });

  it("re-reads with a forced refresh on window focus so a just-granted role appears", async () => {
    // The token starts without the admin claim; the claim is granted
    // server-side while the app sits open in the background.
    mockGetIdTokenResult.mockResolvedValueOnce({ claims: {} });
    mockGetIdTokenResult.mockResolvedValue({ claims: { admin: true } });

    const { result } = renderHook(() => useRoleClaims());

    await waitFor(() =>
      expect(result.current).toEqual({
        isAdmin: false,
        isModerator: false,
        isMinistryOwner: false,
      }),
    );

    // User returns to the tab — the hook refetches and now sees admin.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current?.isAdmin).toBe(true));
    expect(mockGetIdTokenResult).toHaveBeenLastCalledWith(true);
  });
});
