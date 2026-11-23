import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";

type AuthCallback = (user: User | null) => void;
const listeners: AuthCallback[] = [];
const mockSignOut = vi.fn(async () => {});

vi.mock("firebase/auth", () => {
  return {
    onAuthStateChanged: (_auth: unknown, cb: AuthCallback) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    signOut: (...args: unknown[]) => mockSignOut(...args),
    signInWithPopup: vi.fn(),
    GoogleAuthProvider: class {},
  };
});

vi.mock("@/lib/firebase", () => ({
  firebaseAuth: () => ({}),
  firestore: () => ({}),
}));

import { AuthProvider, useAuth } from "@/lib/auth-context";

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{loading ? "loading" : "ready"}</span>
      <span data-testid="uid">{user?.uid ?? "none"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    listeners.length = 0;
    mockSignOut.mockClear();
  });

  it("starts in loading=true and flips to false once auth state resolves", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("loading").textContent).toBe("loading");
    expect(listeners.length).toBe(1);

    act(() => {
      listeners[0](null);
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
    });
    expect(screen.getByTestId("uid").textContent).toBe("none");
  });

  it("exposes the signed-in user, then clears it on signOut", async () => {
    function ProbeWithSignOut() {
      const { user, signOut } = useAuth();
      return (
        <div>
          <span data-testid="uid">{user?.uid ?? "none"}</span>
          <button onClick={() => void signOut()}>signout</button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <ProbeWithSignOut />
      </AuthProvider>,
    );

    act(() => {
      listeners[0]({ uid: "abc" } as User);
    });
    await waitFor(() => {
      expect(screen.getByTestId("uid").textContent).toBe("abc");
    });

    await act(async () => {
      screen.getByText("signout").click();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);

    // onAuthStateChanged listener fires with null after sign-out in real life
    act(() => {
      listeners[0](null);
    });
    await waitFor(() => {
      expect(screen.getByTestId("uid").textContent).toBe("none");
    });
  });

  it("throws if useAuth is used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});
