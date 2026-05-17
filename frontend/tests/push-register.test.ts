/**
 * @vitest-environment jsdom
 *
 * Regression guard: `registerPushToken` must NEVER auto-fire the browser's
 * `Notification.requestPermission()` prompt. firebase/messaging's `getToken`
 * triggers the native prompt when `Notification.permission === "default"`,
 * so the gate has to live in `push.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = "test-vapid-key";

const getTokenMock = vi.fn(async () => "fcm-token-xyz");
const getMessagingMock = vi.fn(() => ({ __mock: "messaging" }));

vi.mock("firebase/messaging", () => ({
  getMessaging: getMessagingMock,
  getToken: getTokenMock,
}));

vi.mock("@/lib/firebase", () => ({
  app: { options: { apiKey: "test" } },
}));

const apiPostMock = vi.fn(async () => ({
  deviceId: "device-abc",
  registeredAt: "2026-05-17T00:00:00Z",
}));
vi.mock("@/lib/api", () => ({
  apiPost: apiPostMock,
  ApiError: class ApiError extends Error {
    code = "x";
    status = 0;
  },
}));

function setNotification(permission: NotificationPermission) {
  const requestPermission = vi.fn(async () => permission);
  Object.defineProperty(window, "Notification", {
    writable: true,
    configurable: true,
    value: { permission, requestPermission },
  });
  return { requestPermission };
}

function stubServiceWorker() {
  const active = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const reg = { active, installing: null, waiting: null } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(async () => reg) },
  });
  return reg;
}

describe("registerPushToken — no auto-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubServiceWorker();
  });

  it("returns null without calling getToken when permission is 'default'", async () => {
    const { requestPermission } = setNotification("default");
    const { registerPushToken } = await import("@/lib/push");

    const result = await registerPushToken("alice");

    expect(result).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(getMessagingMock).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("returns null without calling getToken when permission is 'denied'", async () => {
    const { requestPermission } = setNotification("denied");
    const { registerPushToken } = await import("@/lib/push");

    const result = await registerPushToken("alice");

    expect(result).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("proceeds through getToken + device register when permission is 'granted'", async () => {
    setNotification("granted");
    const { registerPushToken } = await import("@/lib/push");

    const result = await registerPushToken("alice");

    expect(result).toBe("device-abc");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/users/me/devices",
      expect.objectContaining({ fcmToken: "fcm-token-xyz", platform: "web" }),
    );
  });
});
