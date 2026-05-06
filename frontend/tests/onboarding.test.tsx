/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
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

import { ProfileForm } from "@/components/onboarding/ProfileForm";
import { AuthProvider } from "@/lib/auth-context";
import OnboardingPage from "@/app/onboarding/page";

// ---------------------------------------------------------------------------
// Fetch mock — covers the bootstrap GET that `useUser` now performs and
// the POST /api/users/me that `ProfileForm` submits. Per-test handlers
// override the default via `pushHandler`.
// ---------------------------------------------------------------------------
type Reply = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};
type BootstrapBody = {
  hasProfile: boolean;
  profile: Record<string, unknown> | null;
  claims?: { admin?: boolean };
  deletionRequestedAt?: string | null;
};

let nextBootstrap: BootstrapBody = { hasProfile: false, profile: null };
const fetchMock: Mock = vi.fn();
const handlers: Array<{
  match: (url: string, method: string) => boolean;
  reply: () => Reply;
}> = [];

function pushHandler(
  match: (url: string, method: string) => boolean,
  reply: () => Reply,
): void {
  handlers.push({ match, reply });
}

function mockAuthState(user: { uid: string; email: string } | null) {
  vi.mocked(fbAuth.onAuthStateChanged).mockImplementation(
    ((_auth: unknown, cb: (u: unknown) => void) => {
      cb(user);
      return () => {};
    }) as unknown as typeof fbAuth.onAuthStateChanged,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  handlers.length = 0;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input);
    const method = (init?.method || "GET").toUpperCase();
    for (const { match, reply } of handlers) {
      if (match(url, method)) return reply();
    }
    if (url.includes("/api/users/me/bootstrap") && method === "GET") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => nextBootstrap,
      };
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
  nextBootstrap = { hasProfile: false, profile: null };
  mockReplace.mockClear();
  mockPush.mockClear();
  vi.mocked(fbAuth.onAuthStateChanged).mockReset();
  vi.mocked(fbAuth.deleteUser).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Redirect logic
// ---------------------------------------------------------------------------
describe("OnboardingPage redirect logic", () => {
  it("redirects to /sign-in when not authenticated", async () => {
    mockAuthState(null);
    nextBootstrap = { hasProfile: false, profile: null };

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
    nextBootstrap = {
      hasProfile: true,
      profile: {
        uid: "uid-1",
        displayName: "Alice",
        email: "user@example.com",
        photoURL: null,
        role: "member",
        schemaVersion: 1,
        isMinor: false,
        createdAt: null,
      },
    };

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
    nextBootstrap = { hasProfile: false, profile: null };

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

  it("links the community-guidelines label to /guidelines", () => {
    renderForm();
    const link = screen.getByRole("link", { name: /community guidelines/i });
    expect(link).toHaveAttribute("href", "/guidelines");
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

  it("posts to /api/users/me and navigates to /groups on valid submission", async () => {
    pushHandler(
      (url, method) => url.includes("/api/users/me") && method === "POST",
      () => ({
        ok: true,
        status: 201,
        json: async () => ({
          uid: "uid-1",
          displayName: "Alice",
          email: "user@example.com",
          photoURL: null,
          role: "member",
          schemaVersion: 1,
          isMinor: false,
          createdAt: null,
        }),
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(screen.getByRole("radio", { name: /18 or older/i }));
    await user.click(screen.getByRole("checkbox", { name: /community guidelines/i }));
    await user.click(screen.getByRole("button", { name: /complete profile/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).includes("/api/users/me") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse((calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ displayName: "Alice", isMinor: false });
    });
    expect(mockPush).toHaveBeenCalledWith("/groups");
  });

  it("shows error message when the create-profile request fails", async () => {
    pushHandler(
      (url, method) => url.includes("/api/users/me") && method === "POST",
      () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: { code: "internal_error", message: "boom" } }),
      }),
    );

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
// useUser bootstrap (M2 of the data-layer migration)
//
// The cookie that gates `frontend/middleware.ts` is now set server-side
// from `GET /api/users/me/bootstrap` and from `POST /api/users/me`, so
// this hook no longer manages it. The tests below assert the new
// contract: hook returns the profile from the bootstrap response and
// does not import `firebase/firestore`.
// ---------------------------------------------------------------------------
describe("useUser", () => {
  it("returns the profile from the bootstrap response", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");
    nextBootstrap = {
      hasProfile: true,
      profile: {
        uid: "uid-1",
        displayName: "Alice",
        email: "alice@example.com",
        photoURL: null,
        role: "member",
        schemaVersion: 1,
        isMinor: false,
        createdAt: null,
      },
    };

    let result: ReturnType<typeof useUser> | undefined;
    function Probe() {
      result = useUser("uid-1");
      return null;
    }
    render(<Probe />);

    await waitFor(() => expect(result?.loading).toBe(false));
    expect(result?.profile?.displayName).toBe("Alice");
  });

  it("returns profile=null when hasProfile is false", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");
    nextBootstrap = { hasProfile: false, profile: null };

    let result: ReturnType<typeof useUser> | undefined;
    function Probe() {
      result = useUser("uid-missing");
      return null;
    }
    render(<Probe />);

    await waitFor(() => expect(result?.loading).toBe(false));
    expect(result?.profile).toBeNull();
  });

  it("starts in loading state before the bootstrap response arrives", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");

    let result: ReturnType<typeof useUser> | undefined;
    function Probe() {
      result = useUser("uid-pending");
      return null;
    }
    render(<Probe />);
    expect(result?.loading).toBe(true);
  });

  it("refresh() re-fetches the bootstrap endpoint", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");
    nextBootstrap = { hasProfile: false, profile: null };

    let hook: ReturnType<typeof useUser> | undefined;
    function Probe() {
      hook = useUser("uid-1");
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(hook?.loading).toBe(false));

    const before = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/users/me/bootstrap"),
    ).length;
    await hook!.refresh();
    const after = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/users/me/bootstrap"),
    ).length;
    expect(after).toBeGreaterThan(before);
  });
});
