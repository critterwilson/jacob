/**
 * Sign-out cache cleanup + PWA install prompt tests.
 *
 * The per-group message cache that lived here pre-M3 was retired in PR7
 * along with its read-side helpers; only `clearCache` is still wired in
 * (called from `auth-context` on sign-out).
 */

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// ── localStorage shim (jsdom doesn't wire it up properly) ─────────────────

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", mockLocalStorage);
  mockLocalStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("offline-cache", () => {
  it("clearCache deletes the legacy jacob-cache database", async () => {
    const freshFactory = new IDBFactory();
    vi.stubGlobal("indexedDB", freshFactory);
    const deleteSpy = vi.spyOn(freshFactory, "deleteDatabase");

    const { clearCache } = await import("@/lib/offline-cache");
    await clearCache();

    expect(deleteSpy).toHaveBeenCalledWith("jacob-cache");
  });
});

describe("usePWAInstall", () => {
  it("install prompt does not reappear after dismissal", async () => {
    const { usePWAInstall } = await import("@/lib/hooks/usePWAInstall");

    const { result } = renderHook(() => usePWAInstall());

    // Initially no prompt event — canInstall is false.
    expect(result.current.canInstall).toBe(false);

    // Simulate dismissal.
    act(() => result.current.dismiss());

    // The snoozed-until key should be set in localStorage.
    const snoozedUntil = mockLocalStorage.getItem("pwa-install-snoozed-until");
    expect(snoozedUntil).not.toBeNull();
    expect(Number(snoozedUntil)).toBeGreaterThan(Date.now());
  });
});
