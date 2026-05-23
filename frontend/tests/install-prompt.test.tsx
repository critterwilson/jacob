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

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    get: () => ua,
    configurable: true,
  });
}

const UA_IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const UA_IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.169 Mobile/15E148 Safari/604.1";

const UA_ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36";

function fireFakeInstallPrompt() {
  const fakeEvent = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: "dismissed" as const }),
  });
  act(() => { window.dispatchEvent(fakeEvent); });
  return fakeEvent;
}

import { usePWAInstall } from "@/lib/hooks/usePWAInstall";
import { InstallPrompt } from "@/components/nav/InstallPrompt";

// ---------------------------------------------------------------------------
// Hook tests
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
// Component tests — desktop (jsdom UA, beforeinstallprompt path)
// ---------------------------------------------------------------------------

describe("InstallPrompt (desktop / Chromium)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
    // jsdom UA is linux-based, so detectPlatform() → "desktop"
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
    fireFakeInstallPrompt();
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
  });

  it("Not now click writes snooze key and hides the banner", async () => {
    render(<InstallPrompt />);
    fireFakeInstallPrompt();
    await screen.findByRole("banner");

    await userEvent.click(screen.getByText("Not now"));

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    const snoozedUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    expect(snoozedUntil).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// Component tests — iOS Safari
// ---------------------------------------------------------------------------

describe("InstallPrompt (iOS Safari)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
    setUserAgent(UA_IOS_SAFARI);
  });

  it("shows tutorial steps without any install prompt event", async () => {
    render(<InstallPrompt />);
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it("renders all three steps", async () => {
    render(<InstallPrompt />);
    const banner = await screen.findByRole("banner");
    const text = banner.textContent ?? "";
    expect(text).toContain("Share");
    expect(text).toContain("Add to Home Screen");
    expect(text).toContain("top-right corner");
  });

  it("Not now snoozes", async () => {
    render(<InstallPrompt />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByText("Not now"));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10)).toBeGreaterThan(Date.now());
  });

  it("Already installed permanently dismisses", async () => {
    render(<InstallPrompt />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByText("Already installed"));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(localStorage.getItem(PERMANENT_KEY)).toBe("1");
  });

  it("hidden when snoozed", () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 1_000_000));
    render(<InstallPrompt />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Component tests — iOS Chrome (must redirect to Safari)
// ---------------------------------------------------------------------------

describe("InstallPrompt (iOS Chrome / non-Safari)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
    setUserAgent(UA_IOS_CHROME);
  });

  it("shows redirect-to-Safari instruction", async () => {
    render(<InstallPrompt />);
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByText(/only be added.*from Safari/i)).toBeInTheDocument();
    expect(screen.getByText("Open in Safari")).toBeInTheDocument();
  });

  it("Not now snoozes", async () => {
    render(<InstallPrompt />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByText("Not now"));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Component tests — Android Chrome with native prompt
// ---------------------------------------------------------------------------

describe("InstallPrompt (Android + beforeinstallprompt)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
    setUserAgent(UA_ANDROID_CHROME);
  });

  it("shows Install button once prompt fires", async () => {
    render(<InstallPrompt />);
    fireFakeInstallPrompt();
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
  });

  it("Not now snoozes the banner", async () => {
    render(<InstallPrompt />);
    fireFakeInstallPrompt();
    await screen.findByRole("banner");
    await userEvent.click(screen.getByText("Not now"));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Component tests — Android without native prompt (manual fallback)
// ---------------------------------------------------------------------------

describe("InstallPrompt (Android — no beforeinstallprompt)", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    setDisplayMode(false);
    setUserAgent(UA_ANDROID_CHROME);
  });

  it("shows manual menu instructions when no prompt fires", async () => {
    render(<InstallPrompt />);
    // Don't fire beforeinstallprompt — component should fall back to manual steps.
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByText(/menu button/i)).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it("Got it snoozes the manual banner", async () => {
    render(<InstallPrompt />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByText("Got it"));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("switches from manual to Install button once prompt fires", async () => {
    render(<InstallPrompt />);
    // Manual steps appear first
    await screen.findByText(/menu button/i);
    // Then the prompt fires
    fireFakeInstallPrompt();
    expect(await screen.findByText("Install")).toBeInTheDocument();
    expect(screen.queryByText(/menu button/i)).not.toBeInTheDocument();
  });
});
