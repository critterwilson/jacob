/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory localStorage substitute.
const _store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => Object.keys(_store).forEach((k) => delete _store[k]),
};
vi.stubGlobal("localStorage", mockLocalStorage);

const SNOOZE_KEY = "pwa-install-snoozed-until";
const PERMANENT_KEY = "pwa-install-dismissed";

function setDisplayMode(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

import { usePWAInstall } from "@/lib/hooks/usePWAInstall";
import { InstallPrompt } from "@/components/nav/InstallPrompt";

// ---------------------------------------------------------------------------
// Hook tests — cover the business logic directly, including iOS path
// ---------------------------------------------------------------------------

describe("usePWAInstall", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
  });

  it("fresh browser — dismissed is false", () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.dismissed).toBe(false);
  });

  it("snoozed localStorage — dismissed is true on mount", () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 1_000_000));
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.dismissed).toBe(true);
  });

  it("permanent localStorage — dismissed is true on mount", () => {
    localStorage.setItem(PERMANENT_KEY, "1");
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.dismissed).toBe(true);
  });

  it("dismiss() writes snooze key and sets dismissed", () => {
    const { result } = renderHook(() => usePWAInstall());
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);
    const snoozedUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    expect(snoozedUntil).toBeGreaterThan(Date.now());
  });

  it("permanentDismiss() writes permanent key and sets dismissed", () => {
    const { result } = renderHook(() => usePWAInstall());
    act(() => result.current.permanentDismiss());
    expect(result.current.dismissed).toBe(true);
    expect(localStorage.getItem(PERMANENT_KEY)).toBe("1");
  });

  it("standalone display-mode — isStandalone is true", () => {
    setDisplayMode(true);
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isStandalone).toBe(true);
  });

  it("non-standalone display-mode — isStandalone is false", () => {
    setDisplayMode(false);
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isStandalone).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component tests (non-iOS — jsdom UA never matches /iphone|ipad|ipod/)
// ---------------------------------------------------------------------------

describe("InstallPrompt (non-iOS)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
  });

  it("hides when snoozed via localStorage", () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 1_000_000));
    render(<InstallPrompt />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("hides when permanently dismissed via localStorage", () => {
    localStorage.setItem(PERMANENT_KEY, "1");
    render(<InstallPrompt />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("hides when running in standalone mode", () => {
    setDisplayMode(true);
    render(<InstallPrompt />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("hidden by default (no beforeinstallprompt fired yet)", () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("shows once beforeinstallprompt fires", async () => {
    render(<InstallPrompt />);
    const fakeEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    act(() => { window.dispatchEvent(fakeEvent); });
    expect(await screen.findByRole("banner")).toBeInTheDocument();
  });

  it("Not now click writes snooze key and hides the banner", async () => {
    render(<InstallPrompt />);
    const fakeEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    act(() => { window.dispatchEvent(fakeEvent); });
    await screen.findByRole("banner");

    await userEvent.click(screen.getByText("Not now"));

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    const snoozedUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    expect(snoozedUntil).toBeGreaterThan(Date.now());
  });
});
