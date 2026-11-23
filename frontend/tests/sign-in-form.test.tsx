import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

const mockSignIn = vi.fn();
const mockSignOut = vi.fn(async () => {});
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
  onAuthStateChanged: () => () => {},
  signOut: () => mockSignOut(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {},
}));

vi.mock("@/lib/firebase", () => ({
  firebaseAuth: () => ({ signOut: mockSignOut }),
  firestore: () => ({}),
}));

import { SignInForm } from "@/components/auth/SignInForm";
import { AuthProvider } from "@/lib/auth-context";

function renderForm() {
  return render(
    <AuthProvider>
      <SignInForm />
    </AuthProvider>,
  );
}

describe("SignInForm", () => {
  beforeEach(() => {
    pushSpy.mockClear();
    mockSignIn.mockReset();
    mockSignOut.mockClear();
  });

  it("shows inline errors for invalid email", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(
      await screen.findByText(/enter a valid email/i),
    ).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("blocks unverified users and shows the verify message", async () => {
    mockSignIn.mockResolvedValueOnce({
      user: { emailVerified: false },
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByText(/verify your email/i),
    ).toBeInTheDocument();
    expect(mockSignOut).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("redirects to /home on a verified sign-in", async () => {
    mockSignIn.mockResolvedValueOnce({
      user: { emailVerified: true, uid: "u1" },
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/home"));
  });

  it("surfaces wrong-password as a friendly error", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/wrong-password" });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByText(/incorrect/i)).toBeInTheDocument();
  });
});
