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
// Fetch mock
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
  applicationStatus?: string | null;
};

let nextBootstrap: BootstrapBody = { hasProfile: false, profile: null };
let nextApplication: Reply = {
  ok: false,
  status: 404,
  json: async () => ({
    error: { code: "application_not_found", message: "no app" },
  }),
};
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
    if (url.includes("/api/applications/me") && method === "GET") {
      return nextApplication;
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
  nextBootstrap = { hasProfile: false, profile: null };
  nextApplication = {
    ok: false,
    status: 404,
    json: async () => ({
      error: { code: "application_not_found", message: "no app" },
    }),
  };
  mockReplace.mockClear();
  mockPush.mockClear();
  vi.mocked(fbAuth.onAuthStateChanged).mockReset();
  vi.mocked(fbAuth.deleteUser).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const ADULT_DOB = "1990-04-12";
const UNDER_13_DOB = `${new Date().getFullYear() - 10}-04-12`;

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
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("redirects to /awaiting-approval when application is already pending", async () => {
    mockAuthState({ uid: "uid-1", email: "user@example.com" });
    nextBootstrap = { hasProfile: false, profile: null };
    nextApplication = {
      ok: true,
      status: 200,
      json: async () => ({
        uid: "uid-1",
        email: "user@example.com",
        displayName: "Alice",
        photoURL: null,
        dob: ADULT_DOB,
        age: 35,
        isMinor: false,
        phone: null,
        location: null,
        faithBackground: null,
        status: "pending",
        createdAt: null,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        parentalConsentObtained: null,
        parentalConsentNotes: "",
        rejectionReason: "",
        grandfathered: false,
      }),
    };

    render(
      <AuthProvider>
        <OnboardingPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/awaiting-approval");
    });
  });

  it("renders the profile form when user has no profile and no application", async () => {
    mockAuthState({ uid: "uid-1", email: "user@example.com" });
    nextBootstrap = { hasProfile: false, profile: null };

    render(
      <AuthProvider>
        <OnboardingPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("form", { name: /complete your profile/i }),
      ).toBeInTheDocument();
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

    await user.type(screen.getByLabelText(/date of birth/i), ADULT_DOB);
    await user.click(
      screen.getByRole("checkbox", { name: /community guidelines/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(
      await screen.findByText(/display name is required/i),
    ).toBeInTheDocument();
  });

  it("shows error when dob is empty on submit", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.click(
      screen.getByRole("checkbox", { name: /community guidelines/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(
      await screen.findByText(/date of birth is required/i),
    ).toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/date of birth/i), ADULT_DOB);
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(
      await screen.findByText(/must agree to the community guidelines/i),
    ).toBeInTheDocument();
  });

  it("posts to /api/applications/me and navigates to /awaiting-approval on valid submission", async () => {
    pushHandler(
      (url, method) => url.includes("/api/applications/me") && method === "POST",
      () => ({
        ok: true,
        status: 201,
        json: async () => ({
          uid: "uid-1",
          email: "user@example.com",
          displayName: "Alice",
          photoURL: null,
          dob: ADULT_DOB,
          age: 35,
          isMinor: false,
          status: "pending",
        }),
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.type(screen.getByLabelText(/date of birth/i), ADULT_DOB);
    await user.click(
      screen.getByRole("checkbox", { name: /community guidelines/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).includes("/api/applications/me") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse((calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ displayName: "Alice", dob: ADULT_DOB });
    });
    expect(mockPush).toHaveBeenCalledWith("/awaiting-approval");
  });

  it("shows error message when the submit-application request fails", async () => {
    pushHandler(
      (url, method) => url.includes("/api/applications/me") && method === "POST",
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
    await user.type(screen.getByLabelText(/date of birth/i), ADULT_DOB);
    await user.click(
      screen.getByRole("checkbox", { name: /community guidelines/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Under-13 path
// ---------------------------------------------------------------------------
describe("Under-13 path", () => {
  it("flips to the under-13 blocking banner once a sub-13 DOB is entered", async () => {
    const user = userEvent.setup();
    render(<ProfileForm uid="uid-1" email="user@example.com" />);

    await user.type(screen.getByLabelText(/date of birth/i), UNDER_13_DOB);

    // The form replaces itself with a blocking banner the moment the
    // computed age falls below 13.
    await waitFor(() => {
      expect(
        screen.getByText(/JACOB requires you to be at least 13/i),
      ).toBeInTheDocument();
    });
  });

  it("calls deleteUser and redirects to /sign-in when Continue is clicked", async () => {
    vi.mocked(fbAuth.deleteUser).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfileForm uid="uid-1" email="user@example.com" />);

    await user.type(screen.getByLabelText(/date of birth/i), UNDER_13_DOB);
    await waitFor(() =>
      screen.getByText(/JACOB requires you to be at least 13/i),
    );

    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/sign-in?reason=age");
    });
  });
});

// ---------------------------------------------------------------------------
// useUser bootstrap (M2 of the data-layer migration)
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

  it("preserves the prior profile on a transport error (does not zero it)", async () => {
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

    let hook: ReturnType<typeof useUser> | undefined;
    function Probe() {
      hook = useUser("uid-1");
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(hook?.profile?.displayName).toBe("Alice"));

    pushHandler(
      (url, method) =>
        url.includes("/api/users/me/bootstrap") && method === "GET",
      () => {
        throw new TypeError("Failed to fetch");
      },
    );

    await hook!.refresh();
    await waitFor(() => expect(hook?.loading).toBe(false));
    expect(hook?.profile?.displayName).toBe("Alice");
  });

  it("zeros the profile on a definitive 200 hasProfile=false response", async () => {
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

    let hook: ReturnType<typeof useUser> | undefined;
    function Probe() {
      hook = useUser("uid-1");
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(hook?.profile?.displayName).toBe("Alice"));

    nextBootstrap = { hasProfile: false, profile: null };
    await hook!.refresh();
    await waitFor(() => expect(hook?.profile).toBeNull());
  });
});
