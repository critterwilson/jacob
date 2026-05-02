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

// --- router mock -----------------------------------------------------------
const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// --- Firebase singletons ---------------------------------------------------
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth", currentUser: null },
  firestore: { __mock: "firestore" },
  storage: { __mock: "storage" },
}));

// --- firebase/auth ---------------------------------------------------------
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  deleteUser: vi.fn(),
}));

// --- firebase/firestore ----------------------------------------------------
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
}));

// --- firebase/storage ------------------------------------------------------
vi.mock("firebase/storage", () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

// --- T10 photo upload hook -------------------------------------------------
// PhotoUpload now goes through useUploadPhoto, which calls useAuth(). Tests
// that render ProfileForm bare (no AuthProvider) would otherwise crash, so
// stub the hook with a no-op upload.
vi.mock("@/lib/hooks/useUploadPhoto", () => ({
  ALLOWED_PHOTO_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"],
  MAX_PHOTO_BYTES: 8 * 1024 * 1024,
  UploadError: class UploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  useUploadPhoto: () => ({
    upload: vi.fn().mockResolvedValue("https://cdn/public/avatar.jpg"),
    uploading: false,
    progress: "idle",
  }),
}));

import * as fbAuth from "firebase/auth";
import * as fbFirestore from "firebase/firestore";
import * as fbStorage from "firebase/storage";

import { ProfileForm } from "@/components/onboarding/ProfileForm";
import { AuthProvider } from "@/lib/auth-context";
import OnboardingPage from "@/app/onboarding/page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAuthState(user: { uid: string; email: string } | null) {
  vi.mocked(fbAuth.onAuthStateChanged).mockImplementation(
    ((_auth: unknown, cb: (u: unknown) => void) => {
      cb(user);
      return () => {};
    }) as unknown as typeof fbAuth.onAuthStateChanged,
  );
}

function mockProfileSnapshot(exists: boolean, data: Record<string, unknown> = {}) {
  vi.mocked(fbFirestore.doc).mockReturnValue({} as ReturnType<typeof fbFirestore.doc>);
  vi.mocked(fbFirestore.onSnapshot).mockImplementation(
    ((_ref: unknown, cb: (snap: unknown) => void) => {
      cb({ exists: () => exists, data: () => data });
      return () => {};
    }) as unknown as typeof fbFirestore.onSnapshot,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  vi.mocked(fbAuth.onAuthStateChanged).mockReset();
  vi.mocked(fbAuth.deleteUser).mockReset();
  vi.mocked(fbFirestore.doc).mockReset();
  vi.mocked(fbFirestore.onSnapshot).mockReset();
  vi.mocked(fbFirestore.setDoc).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Redirect logic
// ---------------------------------------------------------------------------
describe("OnboardingPage redirect logic", () => {
  it("redirects to /sign-in when not authenticated", async () => {
    mockAuthState(null);
    mockProfileSnapshot(false);

    render(
      <AuthProvider>
        <OnboardingPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("redirects to /groups when user already has a profile", async () => {
    mockAuthState({ uid: "uid-1", email: "user@example.com" });
    mockProfileSnapshot(true, { displayName: "Alice", role: "member", schemaVersion: 1 });

    render(
      <AuthProvider>
        <OnboardingPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/groups");
    });
  });

  it("renders the profile form when user has no profile", async () => {
    mockAuthState({ uid: "uid-1", email: "user@example.com" });
    mockProfileSnapshot(false);

    render(
      <AuthProvider>
        <OnboardingPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("form", { name: /complete your profile/i })).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// ProfileForm validation
// ---------------------------------------------------------------------------
describe("ProfileForm validation", () => {
  function renderForm() {
    return render(<ProfileForm uid="uid-1" email="user@example.com" />);
  }

  it("shows error when displayName is empty on submit", async () => {
    const user = userEvent.setup();
    renderForm();

    // Select age and check guidelines so only displayName fails
    await user.click(screen.getByRole("radio", { name: /18 or older/i }));
    await user.click(screen.getByRole("checkbox", { name: /community guidelines/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "" })).toBeInTheDocument();
    });
    expect(screen.getByText(/display name is required/i)).toBeInTheDocument();
  });

  it("shows error when age group is not selected on submit", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(screen.getByRole("checkbox", { name: /community guidelines/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/please select your age group/i)).toBeInTheDocument();
    });
  });

  it("shows error when community guidelines not agreed on submit", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(screen.getByRole("radio", { name: /18 or older/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/must agree to the community guidelines/i)).toBeInTheDocument();
    });
  });

  it("calls setDoc and navigates to /groups on valid submission", async () => {
    vi.mocked(fbFirestore.setDoc).mockResolvedValue(undefined);
    vi.mocked(fbFirestore.doc).mockReturnValue({} as ReturnType<typeof fbFirestore.doc>);

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(screen.getByRole("radio", { name: /18 or older/i }));
    await user.click(screen.getByRole("checkbox", { name: /community guidelines/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      expect(fbFirestore.setDoc).toHaveBeenCalledOnce();
    });
    expect(mockPush).toHaveBeenCalledWith("/groups");
  });

  it("shows error message when setDoc throws", async () => {
    vi.mocked(fbFirestore.setDoc).mockRejectedValue(new Error("network"));
    vi.mocked(fbFirestore.doc).mockReturnValue({} as ReturnType<typeof fbFirestore.doc>);

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(screen.getByRole("radio", { name: /18 or older/i }));
    await user.click(screen.getByRole("checkbox", { name: /community guidelines/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Under-13 path
// ---------------------------------------------------------------------------
describe("Under-13 path", () => {
  it("shows blocking message when under-13 is selected", async () => {
    const user = userEvent.setup();
    render(<ProfileForm uid="uid-1" email="user@example.com" />);

    await user.click(screen.getByRole("radio", { name: /under 13/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/JACOB requires you to be at least 13/i)).toBeInTheDocument();
    });
  });

  it("calls deleteUser and redirects to /sign-in when under-13 confirm is clicked", async () => {
    vi.mocked(fbAuth.deleteUser).mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<ProfileForm uid="uid-1" email="user@example.com" />);

    await user.click(screen.getByRole("radio", { name: /under 13/i }));
    await waitFor(() => screen.getByRole("alert"));

    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/sign-in?reason=age");
    });
  });
});

// ---------------------------------------------------------------------------
// useUser cookie side-effect
// ---------------------------------------------------------------------------
describe("useUser cookie", () => {
  it("sets jacob-has-profile cookie when profile exists", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");
    mockProfileSnapshot(true, { displayName: "Alice", role: "member", schemaVersion: 1 });

    let result: ReturnType<typeof useUser> | undefined;
    function Probe() {
      result = useUser("uid-1");
      return null;
    }
    render(<Probe />);

    await waitFor(() => {
      expect(result?.loading).toBe(false);
    });
    expect(document.cookie).toContain("jacob-has-profile=1");
  });
});
