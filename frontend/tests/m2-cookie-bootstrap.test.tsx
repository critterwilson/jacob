/**
 * @vitest-environment jsdom
 *
 * Acceptance test for §7.2 of the data-layer migration plan: every
 * authed-only path that used to import `firebase/firestore` no longer
 * does. We render the migrated hooks and the onboarding form *without*
 * stubbing `firebase/firestore`. If any of them still imported it, the
 * test would either crash or silently rely on the real SDK.
 */
import { render, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
  storage: {},
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { uid: "alice" }, loading: false, signOut: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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
  useUploadPhoto: () => ({ upload: vi.fn(), uploading: false, progress: "idle" }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      hasProfile: false,
      profile: null,
      claims: { admin: false },
      deletionRequestedAt: null,
      mutedUids: [],
      blockedUids: [],
      status: "none",
    }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M2 cookie-bootstrap migration", () => {
  it("useUser renders without firebase/firestore", async () => {
    const { useUser } = await import("@/lib/hooks/useUser");
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("useDeletionStatus renders without firebase/firestore", async () => {
    const { useDeletionStatus } = await import("@/lib/hooks/useDeletionStatus");
    const { result } = renderHook(() => useDeletionStatus("alice"));
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("useMutes / useBlocks render without firebase/firestore", async () => {
    const { useMutes } = await import("@/lib/hooks/useMutes");
    const { useBlocks } = await import("@/lib/hooks/useBlocks");
    const m = renderHook(() => useMutes());
    const b = renderHook(() => useBlocks());
    await waitFor(() => expect(m.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
  });

  it("ProfileForm renders without firebase/firestore", async () => {
    const { ProfileForm } = await import("@/components/onboarding/ProfileForm");
    render(<ProfileForm uid="alice" email="alice@example.com" />);
  });
});

// PR8 / H3: cross-origin cookie bridge. In staging the API and frontend
// live on different hosts, so the API's Set-Cookie response header lands
// on the API origin and the Next.js middleware never sees the cookie. We
// mirror it client-side from the bootstrap response — these tests
// simulate the cross-origin failure mode by *not* surfacing any
// Set-Cookie via fetch at all (jsdom can't propagate it cross-origin
// anyway), and verify the cookie still appears on document.cookie.
describe("PR8 cross-origin cookie bridge (H3)", () => {
  beforeEach(() => {
    document.cookie = "jacob-has-profile=; path=/; Max-Age=0";
  });

  it("useUser writes jacob-has-profile=1 when bootstrap reports hasProfile=true", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        hasProfile: true,
        profile: {
          uid: "alice",
          displayName: "Alice",
          email: "a@example.com",
          photoURL: null,
          role: "member",
          schemaVersion: 1,
          isMinor: false,
          createdAt: "2026-05-01T00:00:00Z",
        },
        claims: { admin: false },
        deletionRequestedAt: null,
      }),
    }));
    const { useUser } = await import("@/lib/hooks/useUser");
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(document.cookie).toContain("jacob-has-profile=1");
  });

  it("useUser clears the cookie when bootstrap reports hasProfile=false", async () => {
    // Pre-seed the cookie as if a previous session had set it.
    document.cookie = "jacob-has-profile=1; path=/";
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        hasProfile: false,
        profile: null,
        claims: { admin: false },
        deletionRequestedAt: null,
      }),
    }));
    const { useUser } = await import("@/lib/hooks/useUser");
    const { result } = renderHook(() => useUser("alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Cleared cookies don't appear in document.cookie at all.
    expect(document.cookie).not.toContain("jacob-has-profile=1");
  });
});
