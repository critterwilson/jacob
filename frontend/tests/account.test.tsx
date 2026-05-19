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

// Configurable status response for `useDeletionStatus`. After M2 of the
// data-layer migration the hook polls `/api/account/delete/status`
// instead of subscribing to Firestore, so the tests configure the
// mocked fetch reply rather than a snapshot.
type DeletionStatus =
  | { status: "none" }
  | {
      status: "pending";
      deletionRequestedAt: string;
      finalizeAt: string;
      keepBody: boolean;
    };
let nextStatus: DeletionStatus = { status: "none" };

vi.mock("@/lib/firebase", () => ({
  firestore: {},
  app: {},
  auth: { currentUser: null },
  storage: {},
}));

const fetchMock: Mock = vi.fn();

// Lookup of handlers keyed by URL substring + HTTP method. The module's
// `apiGet`/`apiPost` calls land here via the global `fetch` stub. Tests
// register handlers per case; a default GET /status handler responds
// from `nextStatus` so the polling hook never blocks the test.
type Handler = (init: RequestInit | undefined) => {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};
const handlers: Array<{ match: (url: string, method: string) => boolean; reply: Handler }> = [];

function pushHandler(match: (url: string, method: string) => boolean, reply: Handler): void {
  handlers.push({ match, reply });
}

function matchesUrl(substring: string, method?: string) {
  return (url: string, m: string) => url.includes(substring) && (!method || m === method);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  handlers.length = 0;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input);
    const method = (init?.method || "GET").toUpperCase();
    for (const { match, reply } of handlers) {
      if (match(url, method)) return reply(init);
    }
    if (url.includes("/api/v1/account/delete/status") && method === "GET") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => nextStatus,
      };
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
  signOut.mockClear();
  replace.mockClear();
  nextStatus = { status: "none" };
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
    pushHandler(matchesUrl("/api/v1/account/delete", "POST"), () => ({
      ok: true,
      status: 200,
      json: async () => ({
        deletionRequestedAt: "2026-05-01T00:00:00+00:00",
        finalizeAt: "2026-05-15T00:00:00+00:00",
        keepBody: true,
      }),
    }));
    render(<DeleteAccountPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Schedule account deletion/ }),
    );

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes("/api/v1/account/delete") && !String(c[0]).includes("/status"),
      );
      expect(calls.length).toBeGreaterThan(0);
    });
    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/v1/account/delete") && !String(c[0]).includes("/status"),
    )!;
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({
      keepBody: true,
    });
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/");
  });
});

// ── Pending-state view ────────────────────────────────────────────────────────

describe("DeleteAccountPage — pending state", () => {
  const pendingStatus: DeletionStatus = {
    status: "pending",
    deletionRequestedAt: "2026-04-25T00:00:00Z",
    finalizeAt: "2026-05-09T00:00:00Z",
    keepBody: true,
  };

  it("shows the cancel button when deletion is already pending", async () => {
    nextStatus = pendingStatus;
    render(<DeleteAccountPage />);
    await waitFor(() =>
      expect(screen.getByText(/Account deletion pending/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Cancel deletion/ }),
    ).toBeInTheDocument();
  });

  it("calls cancel API and routes home on success", async () => {
    nextStatus = pendingStatus;
    pushHandler(matchesUrl("/api/v1/account/delete/cancel", "POST"), () => ({
      ok: true,
      status: 200,
      json: async () => ({ cancelled: true }),
    }));
    render(<DeleteAccountPage />);
    const cancelBtn = await screen.findByRole("button", {
      name: /Cancel deletion/,
    });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      const cancelCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/api/v1/account/delete/cancel"),
      );
      expect(cancelCalls.length).toBeGreaterThan(0);
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
  });
});

// ── DeletionBanner ────────────────────────────────────────────────────────────

describe("DeletionBanner", () => {
  it("renders nothing when no deletion is pending", () => {
    nextStatus = { status: "none" };
    const { container } = render(<DeletionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders banner with finalize date when deletion is pending", async () => {
    nextStatus = {
      status: "pending",
      deletionRequestedAt: "2026-04-25T00:00:00Z",
      finalizeAt: "2026-05-09T00:00:00Z",
      keepBody: true,
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
