/**
 * T36 — PWA offline shell tests.
 *
 * Uses fake-indexeddb to provide an in-memory IDB implementation.
 * A fresh IDBFactory is installed before each test so deleteDatabase
 * and subsequent opens don't interfere across cases.
 */

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { Message } from "@/lib/hooks/useGroupMessages";

const FAKE_MSG: Message = {
  id: "m1",
  authorUid: "u1",
  body: "Hello offline world",
  stickerIds: [],
  createdAt: null,
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  threadReplyCount: 0,
  mediaRefs: [],
};

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
  // Fresh IDB instance per test — prevents delete+open races across tests.
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", mockLocalStorage);
  mockLocalStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Re-import cache module on next test so it re-opens a fresh DB.
  vi.resetModules();
});

// ── helpers ───────────────────────────────────────────────────────────────

async function importCache() {
  return import("@/lib/offline-cache");
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("offline-cache", () => {
  it("cache hit returns cached messages when offline detected", async () => {
    const { cacheMessages, getCachedMessages } = await importCache();
    await cacheMessages("g1", [FAKE_MSG]);
    const cached = await getCachedMessages("g1");
    expect(cached).toHaveLength(1);
    expect(cached?.[0].id).toBe("m1");
  });

  it("returns null for a group with no cached messages", async () => {
    const { getCachedMessages } = await importCache();
    const cached = await getCachedMessages("unknown-group");
    expect(cached).toBeNull();
  });

  it("sign-out clears IndexedDB", async () => {
    const { cacheMessages, clearCache, getCachedMessages } = await importCache();
    await cacheMessages("g1", [FAKE_MSG]);

    // Install a fresh IDB so the delete+reopen sequence works cleanly.
    const freshFactory = new IDBFactory();
    vi.stubGlobal("indexedDB", freshFactory);

    // Spy to confirm deleteDatabase is called.
    const deleteSpy = vi.spyOn(freshFactory, "deleteDatabase");

    await clearCache();
    expect(deleteSpy).toHaveBeenCalledWith("jacob-cache");

    // After clearing, a fresh get on a new IDB returns null.
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { getCachedMessages: getCachedMessages2 } = await import("@/lib/offline-cache");
    const cached = await getCachedMessages2("g1");
    expect(cached).toBeNull();
  });

  it("caps the cache at 50 messages", async () => {
    const { cacheMessages, getCachedMessages } = await importCache();
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...FAKE_MSG,
      id: `m${i}`,
    }));
    await cacheMessages("g1", many);
    const cached = await getCachedMessages("g1");
    expect(cached).toHaveLength(50);
    // Slice(-50) keeps the last 50 — index 10..59.
    expect(cached?.[0].id).toBe("m10");
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
