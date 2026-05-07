/**
 * @vitest-environment jsdom
 *
 * Coverage for the four frontend auth-flow consistency fixes from the
 * Opus frontend review (H-FRONT-3, H-FRONT-5, H-FRONT-6, M-FRONT-15).
 */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: {},
  storage: {},
}));

vi.mock("firebase/auth", () => ({
  sendEmailVerification: vi.fn(),
}));

import * as fbAuth from "firebase/auth";

import { VerifyEmailInterstitial } from "@/components/auth/VerifyEmailInterstitial";
import { humanizeAuthError } from "@/components/auth/error-messages";

// useAuth is mocked per-suite below.
const authState: {
  user: { emailVerified: boolean; email: string | null; reload: () => Promise<void> } | null;
  loading: boolean;
  signOut: ReturnType<typeof vi.fn>;
} = {
  user: null,
  loading: false,
  signOut: vi.fn(),
};
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  authState.user = null;
  authState.loading = false;
  authState.signOut = vi.fn().mockResolvedValue(undefined);
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// H-FRONT-3 — /verify-email interstitial
// ---------------------------------------------------------------------------
describe("VerifyEmailInterstitial", () => {
  it("redirects to /sign-in when no user is signed in", async () => {
    authState.user = null;
    authState.loading = false;
    render(<VerifyEmailInterstitial />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/sign-in"),
    );
  });

  it("redirects to /onboarding immediately when emailVerified is already true", async () => {
    authState.user = {
      emailVerified: true,
      email: "alice@example.com",
      reload: vi.fn().mockResolvedValue(undefined),
    };
    render(<VerifyEmailInterstitial />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/onboarding"),
    );
  });

  it("shows the polling UI for an unverified user and lists their email", () => {
    authState.user = {
      emailVerified: false,
      email: "alice@example.com",
      reload: vi.fn().mockResolvedValue(undefined),
    };
    render(<VerifyEmailInterstitial />);
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend verification email/i }),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("polls auth.currentUser.reload() on a 5s interval and routes to /onboarding once verified", async () => {
    // Spying on setInterval (instead of vi.useFakeTimers()) lets us
    // assert the cadence and drive ticks manually without fighting
    // waitFor's real-timer clock.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const reload = vi.fn().mockResolvedValue(undefined);
    authState.user = {
      emailVerified: false,
      email: "alice@example.com",
      reload,
    };

    render(<VerifyEmailInterstitial />);

    // The effect schedules the poll exactly once, with a 5 000 ms
    // interval — anything else would either thrash the user or wait
    // far too long for verification to land.
    const matching = setIntervalSpy.mock.calls.find(
      ([, ms]) => ms === 5_000,
    );
    expect(matching).toBeDefined();
    const tick = matching![0] as () => Promise<void>;

    // First tick: still unverified, no redirect.
    await act(async () => {
      await tick();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // Verification lands; next tick observes it and routes onward.
    authState.user!.emailVerified = true;
    await act(async () => {
      await tick();
    });
    expect(reload).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/onboarding"),
    );

    setIntervalSpy.mockRestore();
  });

  it("resend button calls sendEmailVerification and surfaces a confirmation banner", async () => {
    vi.mocked(fbAuth.sendEmailVerification).mockResolvedValue(undefined);
    authState.user = {
      emailVerified: false,
      email: "alice@example.com",
      reload: vi.fn().mockResolvedValue(undefined),
    };

    render(<VerifyEmailInterstitial />);
    await userEvent.click(
      screen.getByRole("button", { name: /resend verification email/i }),
    );

    await waitFor(() =>
      expect(fbAuth.sendEmailVerification).toHaveBeenCalledWith(
        authState.user,
      ),
    );
    expect(
      await screen.findByText(/verification email sent/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// H-FRONT-5 — middleware onboarding gate covers every authed route
// ---------------------------------------------------------------------------
//
// We can't run real Next.js middleware here — instead we import the
// `requiresProfile` helper through the module under test and assert
// that gated paths return true and public paths return false. This is
// the precise contract the matcher relies on.
import { middleware } from "@/middleware";

// Fabricate a NextRequest-like object — the middleware only reads
// `nextUrl.pathname`, `headers.get("host")`, and `cookies.get(name)`.
function fakeRequest(pathname: string, hasProfileCookie: boolean) {
  return {
    headers: new Headers(),
    cookies: {
      get(name: string) {
        if (name === "jacob-has-profile" && hasProfileCookie) {
          return { value: "1" };
        }
        return undefined;
      },
    },
    nextUrl: { pathname },
    url: `https://app.jacob.test${pathname}`,
  } as unknown as Parameters<typeof middleware>[0];
}

describe("middleware onboarding gate", () => {
  const GATED_PATHS = [
    "/groups",
    "/groups/abc123",
    "/chat/abc123",
    "/boards",
    "/boards/board1",
    "/discover",
    "/discover/g1",
    "/devotionals",
    "/devotionals/today",
    "/reading-plans",
    "/reading-plans/john",
    "/search",
    "/orgs/org1",
    "/orgs/org1/admin",
    "/admin",
    "/admin/users",
    "/admin/flags",
    "/appeals/new",
    "/appeals/abc",
    "/home",
    "/settings/notifications",
    "/settings/blocked",
    "/settings/delete-account",
    "/settings/export",
    "/join",
    "/join?code=ABC",
  ];

  const PUBLIC_PATHS = [
    "/",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/verify-email",
    "/onboarding",
    "/about",
    "/privacy",
    "/terms",
    "/guidelines",
    "/faq",
    "/transparency",
  ];

  it.each(GATED_PATHS)(
    "redirects to /onboarding when %s is requested without the profile cookie",
    async (pathname) => {
      const cleanPath = pathname.split("?")[0];
      const res = await middleware(fakeRequest(cleanPath, false));
      // NextResponse.redirect produces a Response with a 3xx status
      // and a Location header. Assert the destination ends in
      // /onboarding so the test isn't tied to the URL constructor's
      // origin handling.
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(res.headers.get("location")).toMatch(/\/onboarding$/);
    },
  );

  it.each(PUBLIC_PATHS)(
    "lets %s through without the profile cookie (no redirect)",
    async (pathname) => {
      const res = await middleware(fakeRequest(pathname, false));
      // NextResponse.next() returns a 200-ish response with no
      // Location header — i.e. the request is allowed to proceed.
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("lets gated paths through when the profile cookie is set", async () => {
    const res = await middleware(fakeRequest("/groups/abc", true));
    expect(res.headers.get("location")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// H-FRONT-6 — useUser preserves previous profile on transport error
// ---------------------------------------------------------------------------
describe("useUser transport-error resilience", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains the previously-loaded profile when a refetch fails with a transport error", async () => {
    const profile = {
      uid: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      photoURL: null,
      role: "member",
      schemaVersion: 1,
      isMinor: false,
      createdAt: "2026-05-01T00:00:00Z",
    };
    // First call succeeds; subsequent calls simulate a transport
    // failure (fetch throws TypeError → ApiError(0,"network_error")).
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          hasProfile: true,
          profile,
          claims: { admin: false },
          deletionRequestedAt: null,
        }),
      })
      .mockRejectedValue(new TypeError("network down"));

    const { useUser } = await import("@/lib/hooks/useUser");
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.uid).toBe("alice");

    // Trigger a refresh — the second fetch throws, but the hook must
    // hold onto the prior profile rather than zeroing it.
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.profile?.uid).toBe("alice");
  });

  it("clears the profile on a clean 200-with-hasProfile=false response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        hasProfile: false,
        profile: null,
        claims: { admin: false },
        deletionRequestedAt: null,
      }),
    });

    const { useUser } = await import("@/lib/hooks/useUser");
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M-FRONT-15 — humanizeAuthError handles auth/user-disabled
// ---------------------------------------------------------------------------
describe("humanizeAuthError", () => {
  it("maps auth/user-disabled to a clear, support-pointed message", () => {
    const msg = humanizeAuthError({ code: "auth/user-disabled" });
    expect(msg).toMatch(/account has been disabled/i);
    expect(msg).toContain("support@jacob.app");
  });

  it("still falls back to a generic message for unknown codes", () => {
    expect(humanizeAuthError({ code: "auth/some-new-code" })).toMatch(
      /something went wrong/i,
    );
  });
});
