/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockReplace = vi.fn();
const verifyEmailSearchParamsGet = vi.fn<(key: string) => string | null>(
  () => null,
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => ({ get: verifyEmailSearchParamsGet }),
}));

// vi.mock is hoisted; declare the auth sentinel via vi.hoisted so the
// mock factory can reference it without a TDZ error.
const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    currentUser: null as
      | { uid: string; email: string | null; emailVerified: boolean }
      | null,
  },
}));

vi.mock("@/lib/firebase", () => ({
  auth: mockAuth,
  firestore: { __mock: "firestore" },
  storage: { __mock: "storage" },
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  reload: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
}));

import * as fbAuth from "firebase/auth";

import VerifyEmailPage from "@/app/verify-email/page";
import { AuthProvider } from "@/lib/auth-context";

function mockAuthState(
  user: { uid: string; email: string | null; emailVerified: boolean } | null,
) {
  vi.mocked(fbAuth.onAuthStateChanged).mockImplementation(
    ((_a: unknown, cb: (u: unknown) => void) => {
      cb(user);
      return () => {};
    }) as unknown as typeof fbAuth.onAuthStateChanged,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockAuth.currentUser = null;
  verifyEmailSearchParamsGet.mockReset();
  verifyEmailSearchParamsGet.mockReturnValue(null);
  vi.mocked(fbAuth.onAuthStateChanged).mockReset();
  vi.mocked(fbAuth.reload).mockReset();
  vi.mocked(fbAuth.sendEmailVerification).mockReset();
  vi.mocked(fbAuth.signOut).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("VerifyEmailPage", () => {
  it("redirects unauthenticated users to /sign-in", async () => {
    mockAuthState(null);

    render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("redirects already-verified users straight to /onboarding", async () => {
    const user = {
      uid: "u1",
      email: "alice@example.com",
      emailVerified: true,
    };
    mockAuthState(user);
    mockAuth.currentUser = user;

    render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("polls reload() every 5s and redirects to /onboarding once verified", async () => {
    const user = {
      uid: "u1",
      email: "alice@example.com",
      emailVerified: false,
    };
    mockAuthState(user);
    mockAuth.currentUser = { ...user };

    let reloadCalls = 0;
    vi.mocked(fbAuth.reload).mockImplementation(async () => {
      reloadCalls++;
      // Flip the sentinel to verified on the second poll.
      if (reloadCalls === 2) {
        mockAuth.currentUser = { ...user, emailVerified: true };
      }
    });

    // Switch to fake timers AFTER initial render so the AuthProvider's
    // microtasks complete normally.
    const { rerender } = render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );
    await screen.findByRole("button", { name: /resend verification/i });

    vi.useFakeTimers();
    rerender(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    // First tick — still unverified.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mockReplace).not.toHaveBeenCalledWith("/onboarding");

    // Second tick — flips to verified, redirect fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    expect(reloadCalls).toBeGreaterThanOrEqual(2);
  });

  it("threads `next` onto /onboarding when already verified", async () => {
    verifyEmailSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    const user = {
      uid: "u1",
      email: "alice@example.com",
      emailVerified: true,
    };
    mockAuthState(user);
    mockAuth.currentUser = user;

    render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/onboarding?next=${encodeURIComponent("/join?code=ABCD1234")}`,
      );
    });
  });

  it("ignores an absolute-URL `next` and falls back to /onboarding", async () => {
    verifyEmailSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "https://evil.example/" : null,
    );
    const user = {
      uid: "u1",
      email: "alice@example.com",
      emailVerified: true,
    };
    mockAuthState(user);
    mockAuth.currentUser = user;

    render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("resends the verification email when the resend button is clicked", async () => {
    const user = {
      uid: "u1",
      email: "alice@example.com",
      emailVerified: false,
    };
    mockAuthState(user);
    mockAuth.currentUser = { ...user };
    vi.mocked(fbAuth.sendEmailVerification).mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <VerifyEmailPage />
      </AuthProvider>,
    );

    await screen.findByRole("button", { name: /resend verification/i });
    await userEvent.click(
      screen.getByRole("button", { name: /resend verification/i }),
    );

    await waitFor(() => {
      expect(fbAuth.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/verification email sent/i),
    ).toBeInTheDocument();
  });
});
