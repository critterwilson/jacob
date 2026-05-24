/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePushSetupMock = vi.fn();
vi.mock("@/lib/hooks/usePushSetup", () => ({
  usePushSetup: (uid: string | null) => usePushSetupMock(uid),
}));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

import { AppRegistrations } from "@/components/AppRegistrations";

const registerMock = vi.fn(() => Promise.resolve(undefined));
const getRegistrationsMock = vi.fn(() => Promise.resolve([]));
// Loose typing on the impl so individual tests can return either
// `undefined` (no stale legacy /sw.js) or a fake registration object
// without fighting vitest's stricter generic inference.
const getRegistrationMock = vi.fn(
  (_scope?: string): Promise<ServiceWorkerRegistration | undefined> =>
    Promise.resolve(undefined),
);

beforeEach(() => {
  usePushSetupMock.mockReset();
  useAuthMock.mockReset();
  registerMock.mockClear();
  getRegistrationsMock.mockClear();
  getRegistrationMock.mockReset();
  getRegistrationMock.mockImplementation(() => Promise.resolve(undefined));

  // Stub the service worker container.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: registerMock,
      getRegistrations: getRegistrationsMock,
      getRegistration: getRegistrationMock,
    },
  });
  delete process.env.NEXT_PUBLIC_DISABLE_SW;
});

afterEach(() => {
  // Best-effort cleanup of the stub.
  // @ts-expect-error - removing test-only property
  delete navigator.serviceWorker;
});

describe("AppRegistrations", () => {
  it("registers the merged firebase-messaging-sw.js exactly once on mount", () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<AppRegistrations />);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith("/firebase-messaging-sw.js", {
      scope: "/",
    });
    // Belt-and-suspenders: do NOT also register the legacy /sw.js — the
    // race between two SWs at the same scope is exactly the bug this PR
    // is fixing.
    expect(registerMock).not.toHaveBeenCalledWith(
      "/sw.js",
      expect.anything(),
    );
  });

  it("unregisters a stale legacy /sw.js registration when one is present", async () => {
    const unregister = vi.fn(() => Promise.resolve(true));
    getRegistrationMock.mockImplementation((scope?: string) => {
      if (scope === "/sw.js") {
        return Promise.resolve({
          active: { scriptURL: "https://app.example.com/sw.js" },
          unregister,
        } as unknown as ServiceWorkerRegistration);
      }
      return Promise.resolve(undefined);
    });

    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<AppRegistrations />);
    // Let the chained .then microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(getRegistrationMock).toHaveBeenCalledWith("/sw.js");
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("calls usePushSetup with the authed user's uid", () => {
    useAuthMock.mockReturnValue({
      user: { uid: "alice", email: "a@x", emailVerified: true },
      loading: false,
    });
    render(<AppRegistrations />);
    expect(usePushSetupMock).toHaveBeenCalledWith("alice");
  });

  it("calls usePushSetup with null when not signed in (still safe to mount)", () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<AppRegistrations />);
    expect(usePushSetupMock).toHaveBeenCalledWith(null);
  });

  it("skips SW registration when NEXT_PUBLIC_DISABLE_SW=true", () => {
    process.env.NEXT_PUBLIC_DISABLE_SW = "true";
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<AppRegistrations />);
    expect(registerMock).not.toHaveBeenCalled();
  });
});
