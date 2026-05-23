/**
 * @vitest-environment jsdom
 *
 * Focused test for `/awaiting-approval` honoring `?next=` post-approval.
 * The page polls `useMyApplication`; on `status === "approved"` it
 * redirects to `safeNext(next) ?? "/home"`.
 */
import { render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockReplace = vi.fn();
const awaitingSearchParamsGet = vi.fn<(key: string) => string | null>(
  () => null,
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => ({ get: awaitingSearchParamsGet }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", email: "alice@example.com", emailVerified: true });
    return () => {};
  },
  signOut: vi.fn(),
}));

// Stub the two hooks the page depends on.
const applicationState: {
  current: {
    loading: boolean;
    application: { status: "pending" | "approved" | "rejected" } | null;
    error: null;
    refresh: () => Promise<void>;
  };
} = {
  current: {
    loading: false,
    application: { status: "approved" },
    error: null,
    refresh: async () => undefined,
  },
};
vi.mock("@/lib/hooks/useMyApplication", () => ({
  useMyApplication: () => applicationState.current,
}));
vi.mock("@/lib/hooks/useUser", () => ({
  useUser: () => ({ profile: null, loading: false, error: null }),
}));

import AwaitingApprovalPage from "@/app/awaiting-approval/page";
import { AuthProvider } from "@/lib/auth-context";

beforeEach(() => {
  mockReplace.mockClear();
  awaitingSearchParamsGet.mockReset();
  awaitingSearchParamsGet.mockReturnValue(null);
  applicationState.current = {
    loading: false,
    application: { status: "approved" },
    error: null,
    refresh: async () => undefined,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AwaitingApprovalPage", () => {
  it("redirects approved users to /home when no `next` is set", async () => {
    render(
      <AuthProvider>
        <AwaitingApprovalPage />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("honors `?next=` for an approved user (invite landing)", async () => {
    awaitingSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "/join?code=ABCD1234" : null,
    );
    render(
      <AuthProvider>
        <AwaitingApprovalPage />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/join?code=ABCD1234");
    });
  });

  it("ignores an unsafe `next` and falls back to /home", async () => {
    awaitingSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "https://evil.example" : null,
    );
    render(
      <AuthProvider>
        <AwaitingApprovalPage />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });
});
