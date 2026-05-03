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

vi.mock("@/lib/push", () => ({
  registerPushToken: vi.fn(async () => "device-abc123"),
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

describe("PushPrompt", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // Simulate notification API in default state
    Object.defineProperty(window, "Notification", {
      writable: true,
      configurable: true,
      value: { permission: "default", requestPermission: vi.fn(async () => "granted") },
    });
  });

  it("shows prompt on first authed visit", () => {
    render(<PushPrompt uid="alice" />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText(/enable/i)).toBeInTheDocument();
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
});

describe("NotificationsPage", () => {
  it("renders four toggles", async () => {
    render(<NotificationsPage />);
    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(4);
  });

  it("toggles are labelled correctly", async () => {
    render(<NotificationsPage />);
    await screen.findAllByRole("switch");
    expect(screen.getByLabelText("Mentions")).toBeInTheDocument();
    expect(screen.getByLabelText("Replies")).toBeInTheDocument();
    expect(screen.getByLabelText("Announcements")).toBeInTheDocument();
    expect(screen.getByLabelText("Weekly digest email")).toBeInTheDocument();
  });
});
