/**
 * @vitest-environment jsdom
 *
 * T38 — frontend tests for the self-serve data export page.
 *
 * Mocks the Firestore listener (the `users/{uid}/exports` snapshot) and
 * fetch so the page can be exercised offline.
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

import ExportPage from "@/app/(authed)/settings/export/page";

const mockUser = {
  uid: "alice",
  email: "alice@example.com",
  getIdToken: vi.fn().mockResolvedValue("fake-token"),
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/export",
}));

// After M2 the export page reads `useExportStatus` which polls
// `/api/account/export/status` instead of subscribing to Firestore.
// Tests configure `nextStatus` to control what the GET returns.
type ExportStatusResponse = {
  jobId: string;
  status: "none" | "queued" | "processing" | "ready" | "failed" | "expired";
  requestedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  byteCount: number | null;
  schemaVersion: number;
  downloadUrl: string | null;
};

let nextStatus: ExportStatusResponse = {
  jobId: "",
  status: "none",
  requestedAt: null,
  completedAt: null,
  expiresAt: null,
  failureReason: null,
  byteCount: null,
  schemaVersion: 1,
  downloadUrl: null,
};

vi.mock("@/lib/firebase", () => ({
  firestore: {},
  app: {},
  auth: { currentUser: null },
  storage: {},
}));

const fetchMock: Mock = vi.fn();

type Handler = () => {
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
      if (match(url, method)) return reply();
    }
    if (url.includes("/api/v1/account/export/status") && method === "GET") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => nextStatus,
      };
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
  nextStatus = {
    jobId: "",
    status: "none",
    requestedAt: null,
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    byteCount: null,
    schemaVersion: 1,
    downloadUrl: null,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExportPage", () => {
  it("shows the request button when no export exists", () => {
    render(<ExportPage />);
    expect(screen.getByText(/Export your data/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Request export/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/haven't requested an export/)).toBeInTheDocument();
  });

  it("posts /api/account/export when the user clicks Request", async () => {
    pushHandler(
      (url, method) =>
        url.includes("/api/v1/account/export") &&
        !url.includes("/status") &&
        method === "POST",
      () => ({ ok: true, status: 200, json: async () => ({}) }),
    );
    render(<ExportPage />);
    fireEvent.click(screen.getByRole("button", { name: /Request export/ }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).includes("/api/v1/account/export") &&
          !String(c[0]).includes("/status") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it("shows export_in_flight error message on 409", async () => {
    pushHandler(
      (url, method) =>
        url.includes("/api/v1/account/export") &&
        !url.includes("/status") &&
        method === "POST",
      () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ error: { code: "export_in_flight" } }),
      }),
    );
    render(<ExportPage />);
    fireEvent.click(screen.getByRole("button", { name: /Request export/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/already in progress/),
      ).toBeInTheDocument(),
    );
  });

  it("shows the download button and signed URL when status is ready", async () => {
    nextStatus = {
      jobId: "jobx",
      status: "ready",
      requestedAt: "2026-05-01T12:00:00Z",
      completedAt: "2026-05-01T12:02:00Z",
      expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      failureReason: null,
      byteCount: 2048,
      schemaVersion: 1,
      downloadUrl: "https://example.com/signed-url-abc",
    };
    render(<ExportPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Download my data/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Ready to download/)).toBeInTheDocument();
    expect(
      screen.getByText("https://example.com/signed-url-abc"),
    ).toBeInTheDocument();
  });

  it("marks expired jobs and lets the user request a new one", async () => {
    nextStatus = {
      jobId: "jobx",
      status: "expired",
      requestedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      failureReason: null,
      byteCount: 100,
      schemaVersion: 1,
      downloadUrl: "https://example.com/signed-old",
    };
    render(<ExportPage />);
    await waitFor(() =>
      expect(screen.getByText(/link has expired/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Request a new export/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Download my data/ }),
    ).not.toBeInTheDocument();
  });
});
