/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  firestore: { __mock: "firestore" },
  auth: { __mock: "auth" },
  app: { options: { apiKey: "test" } },
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  serverTimestamp: vi.fn(() => "__serverTime__"),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", displayName: "Alice" },
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/usePushSetup", () => ({
  usePushSetup: vi.fn(),
}));

const { mockRegisterPushToken } = vi.hoisted(() => ({
  mockRegisterPushToken: vi.fn(async () => "device-abc123"),
}));
vi.mock("@/lib/push", () => ({
  registerPushToken: mockRegisterPushToken,
  touchDeviceLastSeen: vi.fn(async () => {}),
}));

import { PushPrompt } from "@/components/nav/PushPrompt";
import NotificationsPage from "@/app/(authed)/settings/notifications/page";

const SNOOZE_KEY = "jacob_push_prompt_snoozed_until";

// In-memory localStorage substitute.
const _store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => Object.keys(_store).forEach((k) => delete _store[k]),
};
vi.stubGlobal("localStorage", mockLocalStorage);

function setNotification(
  permission: NotificationPermission,
  requestPermissionResult: NotificationPermission = "granted",
) {
  const requestPermission = vi.fn(async () => requestPermissionResult);
  Object.defineProperty(window, "Notification", {
    writable: true,
    configurable: true,
    value: { permission, requestPermission },
  });
  return { requestPermission };
}

describe("PushPrompt", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mockRegisterPushToken.mockClear();
    setNotification("default");
  });

  it("shows prompt on first authed visit", () => {
    render(<PushPrompt uid="alice" />);
    expect(
      screen.getByRole("banner", { name: /enable push notifications/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stay in the loop/i)).toBeInTheDocument();
  });

  it("prompt skip writes localStorage flag", async () => {
    render(<PushPrompt uid="alice" />);
    await userEvent.click(screen.getByText(/not now/i));
    const snoozeUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    expect(snoozeUntil).toBeGreaterThan(Date.now());
  });

  it("does not show prompt when snoozed", () => {
    const future = Date.now() + 1000 * 60 * 60 * 24 * 3;
    localStorage.setItem(SNOOZE_KEY, String(future));
    render(<PushPrompt uid="alice" />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("hides when permission already granted", () => {
    setNotification("granted");
    render(<PushPrompt uid="alice" />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("shows re-enable hint when permission denied", () => {
    setNotification("denied");
    render(<PushPrompt uid="alice" />);
    const banner = screen.getByRole("banner", {
      name: /push notifications are blocked/i,
    });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/re-enable them in your browser settings/i);
  });

  it("clicking Enable calls requestPermission then registerPushToken", async () => {
    const { requestPermission } = setNotification("default", "granted");
    render(<PushPrompt uid="alice" />);
    await userEvent.click(screen.getByRole("button", { name: /^enable$/i }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mockRegisterPushToken).toHaveBeenCalledWith("alice");
    // requestPermission was called before registerPushToken
    const reqOrder = requestPermission.mock.invocationCallOrder[0];
    const regOrder = mockRegisterPushToken.mock.invocationCallOrder[0];
    expect(reqOrder).toBeLessThan(regOrder);
  });

  it("clicking Enable then user denies — registerPushToken is not called", async () => {
    setNotification("default", "denied");
    render(<PushPrompt uid="alice" />);
    await userEvent.click(screen.getByRole("button", { name: /^enable$/i }));
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    // Switches into the denied-state banner
    expect(
      await screen.findByRole("banner", {
        name: /push notifications are blocked/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("NotificationsPage", () => {
  it("renders six toggles (mentions, replies, announcements, digest, ministry feed, group messages)", async () => {
    render(<NotificationsPage />);
    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(6);
  });

  it("toggles are labelled correctly", async () => {
    render(<NotificationsPage />);
    await screen.findAllByRole("switch");
    expect(screen.getByLabelText("Mentions")).toBeInTheDocument();
    expect(screen.getByLabelText("Replies")).toBeInTheDocument();
    expect(screen.getByLabelText("Announcements")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Weekly activity summary"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Posts from your organization"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Group messages")).toBeInTheDocument();
  });
});
