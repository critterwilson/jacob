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

beforeEach(() => {
  usePushSetupMock.mockReset();
  useAuthMock.mockReset();
  registerMock.mockClear();
  getRegistrationsMock.mockClear();

  // Stub the service worker container.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: registerMock,
      getRegistrations: getRegistrationsMock,
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
  it("registers /sw.js exactly once on mount, regardless of route", () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<AppRegistrations />);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith("/sw.js", { scope: "/" });
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
