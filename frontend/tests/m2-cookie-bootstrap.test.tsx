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
