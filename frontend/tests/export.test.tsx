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

// Snapshot to feed the Firestore listener. Keys are doc ids; values
// are doc data shapes that mimic Firestore Timestamps via toDate().
type Job = {
  requestedAt?: { toDate: () => Date };
  startedAt?: { toDate: () => Date } | null;
  completedAt?: { toDate: () => Date } | null;
  failedAt?: { toDate: () => Date } | null;
  expiresAt?: { toDate: () => Date } | null;
  downloadUrl?: string | null;
  byteCount?: number | null;
  failureReason?: string | null;
  schemaVersion?: number;
};

let nextDocs: Record<string, Job> = {};

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>(
    "firebase/firestore",
  );
  return {
    ...actual,
    collection: vi.fn(() => ({})),
    onSnapshot: vi.fn(
      (_ref: unknown, onNext: (snap: unknown) => void) => {
        const docs = Object.entries(nextDocs);
        const snap = {
          empty: docs.length === 0,
          forEach: (fn: (d: { id: string; data: () => Job }) => void) => {
            docs.forEach(([id, data]) =>
              fn({ id, data: () => data }),
            );
          },
        };
        onNext(snap);
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
  nextDocs = {};
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
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<ExportPage />);
    fireEvent.click(screen.getByRole("button", { name: /Request export/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/account/export");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("shows export_in_flight error message on 409", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "export_in_flight" } }),
    });
    render(<ExportPage />);
    fireEvent.click(screen.getByRole("button", { name: /Request export/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/already in progress/),
      ).toBeInTheDocument(),
    );
  });

  it("shows the download button and signed URL when status is ready", async () => {
    nextDocs = {
      jobx: {
        requestedAt: { toDate: () => new Date("2026-05-01T12:00:00Z") },
        startedAt: { toDate: () => new Date("2026-05-01T12:01:00Z") },
        completedAt: { toDate: () => new Date("2026-05-01T12:02:00Z") },
        expiresAt: {
          toDate: () => new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        },
        downloadUrl: "https://example.com/signed-url-abc",
        byteCount: 2048,
        schemaVersion: 1,
      },
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
    nextDocs = {
      jobx: {
        requestedAt: { toDate: () => new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
        startedAt: { toDate: () => new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
        completedAt: { toDate: () => new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
        expiresAt: {
          toDate: () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
        downloadUrl: "https://example.com/signed-old",
        byteCount: 100,
        schemaVersion: 1,
      },
    };
    render(<ExportPage />);
    await waitFor(() =>
      expect(screen.getByText(/link has expired/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Request a new export/ }),
    ).toBeInTheDocument();
    // No live download button when expired.
    expect(
      screen.queryByRole("button", { name: /Download my data/ }),
    ).not.toBeInTheDocument();
  });
});
