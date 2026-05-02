/**
 * @vitest-environment jsdom
 *
 * T14 — frontend tests for the delete-account flow.
 *
 * Mocks Firestore listeners and fetch so the page logic can be exercised
 * without the emulator. Covers the confirm form, the cancellation banner
 * surface, and the cancel button on the pending-state view.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import DeleteAccountPage from "@/app/(authed)/settings/delete-account/page";
import { DeletionBanner } from "@/components/account/DeletionBanner";

const mockUser = {
  uid: "alice",
  email: "alice@example.com",
  getIdToken: vi.fn().mockResolvedValue("fake-token"),
  getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
};

const signOut = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut }),
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/settings/delete-account",
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
      [k: string]: unknown;
    }) => React.createElement("a", { href, ...rest }, children),
  };
});

// Configurable Firestore snapshot — set before each test.
type SnapData = Record<string, unknown> | null;
let nextSnapshot: SnapData = null;

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>(
    "firebase/firestore",
  );
  return {
    ...actual,
    doc: vi.fn(() => ({})),
    onSnapshot: vi.fn(
      (_ref: unknown, onNext: (snap: unknown) => void) => {
        const data = nextSnapshot;
        onNext({
          exists: () => data !== null,
          data: () => data ?? {},
        });
        return () => undefined;
      },
    ),
  };
});

vi.mock("@/lib/firebase", () => ({
  firestore: {},
  app: {},
  auth: {},
  storage: {},
}));

const fetchMock: Mock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  signOut.mockClear();
  replace.mockClear();
  nextSnapshot = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Confirm flow ──────────────────────────────────────────────────────────────

describe("DeleteAccountPage — confirm flow", () => {
  it("shows the confirmation form when no deletion is pending", () => {
    render(<DeleteAccountPage />);
    expect(screen.getByText(/Delete your account/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Schedule account deletion/ }),
    ).toBeInTheDocument();
  });

  it("submits POST /api/account/delete with keepBody=true and signs out", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        deletionRequestedAt: "2026-05-01T00:00:00+00:00",
        finalizeAt: "2026-05-15T00:00:00+00:00",
        keepBody: true,
      }),
    });
    render(<DeleteAccountPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Schedule account deletion/ }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/account/delete");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      keepBody: true,
    });
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/");
  });
});

// ── Pending-state view ────────────────────────────────────────────────────────

describe("DeleteAccountPage — pending state", () => {
  it("shows the cancel button when deletion is already pending", async () => {
    nextSnapshot = {
      deletionRequestedAt: { toDate: () => new Date("2026-04-25T00:00:00Z") },
      deletionKeepBody: true,
    };
    render(<DeleteAccountPage />);
    await waitFor(() =>
      expect(screen.getByText(/Account deletion pending/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Cancel deletion/ }),
    ).toBeInTheDocument();
  });

  it("calls cancel API and routes home on success", async () => {
    nextSnapshot = {
      deletionRequestedAt: { toDate: () => new Date("2026-04-25T00:00:00Z") },
      deletionKeepBody: true,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<DeleteAccountPage />);
    const cancelBtn = await screen.findByRole("button", {
      name: /Cancel deletion/,
    });
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/account/delete/cancel",
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
  });
});

// ── DeletionBanner ────────────────────────────────────────────────────────────

describe("DeletionBanner", () => {
  it("renders nothing when no deletion is pending", () => {
    nextSnapshot = null;
    const { container } = render(<DeletionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders banner with finalize date when deletion is pending", async () => {
    nextSnapshot = {
      deletionRequestedAt: { toDate: () => new Date("2026-04-25T00:00:00Z") },
      deletionKeepBody: true,
    };
    render(<DeletionBanner />);
    await waitFor(() =>
      expect(
        screen.getByText(/Your account is scheduled for deletion/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /Cancel/ })).toHaveAttribute(
      "href",
      "/settings/delete-account",
    );
  });
});
