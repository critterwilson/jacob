/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// next/navigation: stub useRouter so navigation calls don't crash.
// useSearchParams is read by SignInForm / SignUpForm to thread `?next=`.
// Each test that cares about it overrides searchParamsGet per-test.
const mockPush = vi.fn();
const searchParamsGet = vi.fn<(key: string) => string | null>(() => null);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

// Replace the Firebase singletons with sentinels — every firebase/auth
// import is mocked below, so the values are never dereferenced.
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

// firebase/auth: each function is a vi.fn we can configure per-test.
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  GoogleAuthProvider: vi.fn().mockImplementation(() => ({})),
}));

import * as fbAuth from "firebase/auth";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { SignInForm } from "@/components/auth/SignInForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { AuthProvider, useAuth } from "@/lib/auth-context";

beforeEach(() => {
  mockPush.mockClear();
  searchParamsGet.mockReset();
  searchParamsGet.mockReturnValue(null);
  vi.mocked(fbAuth.onAuthStateChanged).mockReset();
  vi.mocked(fbAuth.signInWithEmailAndPassword).mockReset();
  vi.mocked(fbAuth.signInWithPopup).mockReset();
  vi.mocked(fbAuth.signOut).mockReset();
  vi.mocked(fbAuth.createUserWithEmailAndPassword).mockReset();
  vi.mocked(fbAuth.sendEmailVerification).mockReset();
  vi.mocked(fbAuth.sendPasswordResetEmail).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------
describe("AuthProvider / useAuth", () => {
  function Probe() {
    const { user, loading } = useAuth();
    return (
      <div>
        <span data-testid="loading">{String(loading)}</span>
        <span data-testid="user">{user ? user.uid : "none"}</span>
      </div>
    );
  }

  it("starts in loading state and flips after onAuthStateChanged fires", async () => {
    let captured: ((u: unknown) => void) | null = null;
    vi.mocked(fbAuth.onAuthStateChanged).mockImplementation(
      ((_auth: unknown, cb: (u: unknown) => void) => {
        captured = cb;
        return () => {};
      }) as unknown as typeof fbAuth.onAuthStateChanged,
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("user").textContent).toBe("none");

    act(() => {
      captured?.({ uid: "alice" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("alice");
  });

  it("signOut delegates to firebase and clears user when auth state updates", async () => {
    let captured: ((u: unknown) => void) | null = null;
    vi.mocked(fbAuth.onAuthStateChanged).mockImplementation(
      ((_auth: unknown, cb: (u: unknown) => void) => {
        captured = cb;
        return () => {};
      }) as unknown as typeof fbAuth.onAuthStateChanged,
    );
    vi.mocked(fbAuth.signOut).mockResolvedValue(undefined);

    function Caller() {
      const { user, signOut } = useAuth();
      return (
        <button type="button" onClick={() => signOut()}>
          {user ? `out:${user.uid}` : "no user"}
        </button>
      );
    }

    render(
      <AuthProvider>
        <Caller />
      </AuthProvider>,
    );

    act(() => {
      captured?.({ uid: "alice" });
    });
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("out:alice"),
    );

    await userEvent.click(screen.getByRole("button"));
    expect(fbAuth.signOut).toHaveBeenCalledTimes(1);

    act(() => {
      captured?.(null);
    });
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("no user"),
    );
  });

  it("useAuth throws when used outside an AuthProvider", () => {
    function Bad() {
      useAuth();
      return null;
    }
    // React logs the error to the console; suppress for the assertion.
    const orig = console.error;
    console.error = () => {};
    expect(() => render(<Bad />)).toThrow(/AuthProvider/);
    console.error = orig;
  });
});

// ---------------------------------------------------------------------------
// SignInForm validation + flow
// ---------------------------------------------------------------------------
describe("SignInForm", () => {
  it("shows email validation error on a malformed address", async () => {
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.type(screen.getByLabelText(/password/i), "anything");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fbAuth.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("blocks unverified accounts and signs them out", async () => {
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: { emailVerified: false },
    } as unknown as fbAuth.UserCredential);
    vi.mocked(fbAuth.signOut).mockResolvedValue(undefined);

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/verify your email/i)).toBeInTheDocument();
    expect(fbAuth.signOut).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("redirects to / when verified credentials succeed", async () => {
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: { emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("humanizes wrong-password errors", async () => {
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockRejectedValue(
      Object.assign(new Error("nope"), { code: "auth/invalid-credential" }),
    );

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrongpassw0rd!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByText(/email or password is incorrect/i),
    ).toBeInTheDocument();
  });

  it("humanizes auth/user-disabled (banned account) on sign-in", async () => {
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockRejectedValue(
      Object.assign(new Error("disabled"), { code: "auth/user-disabled" }),
    );

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "banned@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "anything12!a");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByText(/account has been disabled/i),
    ).toBeInTheDocument();
  });

  it("redirects to / after Google sign-in", async () => {
    vi.mocked(fbAuth.signInWithPopup).mockResolvedValue({
      user: { uid: "g1", emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  // — `?next=` honoring (invite-link round-trip) —
  it("redirects to the `next` query param after email/password sign-in", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: { emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/join?code=ABCD1234"),
    );
  });

  it("redirects to the `next` query param after Google sign-in", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    vi.mocked(fbAuth.signInWithPopup).mockResolvedValue({
      user: { uid: "g1", emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/join?code=ABCD1234"),
    );
  });

  it("ignores an absolute-URL `next` (open-redirect guard)", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "https://evil.example/steal" : null,
    );
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: { emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("ignores a protocol-relative `next` (open-redirect guard)", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "//evil.example/x" : null,
    );
    vi.mocked(fbAuth.signInWithEmailAndPassword).mockResolvedValue({
      user: { emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("forwards `next` onto the Create-an-account link", () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    render(<SignInForm />);
    const link = screen.getByRole("link", { name: /create an account/i });
    expect(link).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent("/join?code=ABCD1234")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// SignUpForm validation + flow
// ---------------------------------------------------------------------------
describe("SignUpForm", () => {
  it("rejects passwords shorter than 10 characters", async () => {
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "short1!");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    expect(
      await screen.findByText(/must be at least 10 characters/i),
    ).toBeInTheDocument();
    expect(fbAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("rejects passwords missing a number", async () => {
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "nodigitsymbol!");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    expect(
      await screen.findByText(/at least one number/i),
    ).toBeInTheDocument();
  });

  it("rejects passwords missing a symbol", async () => {
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "noSymbol12345");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    expect(
      await screen.findByText(/at least one symbol/i),
    ).toBeInTheDocument();
  });

  it("creates account, sends verification, and redirects to /verify-email", async () => {
    const fakeUser = { uid: "alice", emailVerified: false };
    vi.mocked(fbAuth.createUserWithEmailAndPassword).mockResolvedValue({
      user: fakeUser,
    } as unknown as fbAuth.UserCredential);
    vi.mocked(fbAuth.sendEmailVerification).mockResolvedValue(undefined);

    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    // ADR 0012: DOB collected on the signup form so under-13 is caught
    // before we create the Firebase Auth user. Use a clearly-adult DOB.
    await userEvent.type(screen.getByLabelText(/date of birth/i), "1990-04-12");
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    await waitFor(() =>
      expect(fbAuth.sendEmailVerification).toHaveBeenCalledWith(fakeUser),
    );
    expect(mockPush).toHaveBeenCalledWith("/verify-email");
  });

  it("shows email-already-in-use as a friendly message", async () => {
    vi.mocked(fbAuth.createUserWithEmailAndPassword).mockRejectedValue(
      Object.assign(new Error("dup"), { code: "auth/email-already-in-use" }),
    );

    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.type(screen.getByLabelText(/date of birth/i), "1990-04-12");
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    expect(
      await screen.findByText(/already registered/i),
    ).toBeInTheDocument();
  });

  it("redirects to /onboarding after Google sign-in on sign-up page", async () => {
    vi.mocked(fbAuth.signInWithPopup).mockResolvedValue({
      user: { uid: "g1", emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignUpForm />);
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding"));
  });

  // — `?next=` survives the email/password signup funnel —
  it("threads `next` onto /verify-email after email/password signup", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    vi.mocked(fbAuth.createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: "alice", emailVerified: false },
    } as unknown as fbAuth.UserCredential);
    vi.mocked(fbAuth.sendEmailVerification).mockResolvedValue(undefined);

    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.type(screen.getByLabelText(/date of birth/i), "1990-04-12");
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/verify-email?next=${encodeURIComponent("/join?code=ABCD1234")}`,
      ),
    );
  });

  it("threads `next` onto /onboarding after Google sign-up", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    vi.mocked(fbAuth.signInWithPopup).mockResolvedValue({
      user: { uid: "g1", emailVerified: true },
    } as unknown as fbAuth.UserCredential);

    render(<SignUpForm />);
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/onboarding?next=${encodeURIComponent("/join?code=ABCD1234")}`,
      ),
    );
  });

  it("ignores an absolute-URL `next` and falls back to /verify-email", async () => {
    searchParamsGet.mockImplementation((k) =>
      k === "next" ? "https://evil.example/steal" : null,
    );
    vi.mocked(fbAuth.createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: "alice", emailVerified: false },
    } as unknown as fbAuth.UserCredential);
    vi.mocked(fbAuth.sendEmailVerification).mockResolvedValue(undefined);

    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.type(screen.getByLabelText(/date of birth/i), "1990-04-12");
    await userEvent.click(screen.getByLabelText(/i agree/i));
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/verify-email"));
  });

  it("blocks the email/password submit when the ToS checkbox is unchecked", async () => {
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenoughpw1!");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    expect(
      await screen.findByText(/must agree to the terms of service/i),
    ).toBeInTheDocument();
    expect(fbAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("blocks the Google sign-up button when the ToS checkbox is unchecked", async () => {
    render(<SignUpForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(
      await screen.findByText(/must agree to the terms of service/i),
    ).toBeInTheDocument();
    expect(fbAuth.signInWithPopup).not.toHaveBeenCalled();
  });

  it("the ToS label links to /terms and /privacy", () => {
    render(<SignUpForm />);
    expect(
      screen.getByRole("link", { name: /terms of service/i }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: /privacy policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });
});

// ---------------------------------------------------------------------------
// ForgotPasswordForm
// ---------------------------------------------------------------------------
describe("ForgotPasswordForm", () => {
  it("validates email format", async () => {
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "not-email");
    await userEvent.click(
      screen.getByRole("button", { name: /send reset link/i }),
    );
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fbAuth.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("shows confirmation after a successful submit", async () => {
    vi.mocked(fbAuth.sendPasswordResetEmail).mockResolvedValue(undefined);

    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "alice@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: /send reset link/i }),
    );

    expect(
      await screen.findByText(/password-reset link is on its way/i),
    ).toBeInTheDocument();
  });
});

// silence unused-import warning for the Mock type alias above
type _Mock = Mock;
