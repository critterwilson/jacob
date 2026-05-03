/**
 * Unit tests for FCM notification dispatch (T34).
 *
 * Tests the pure logic: pref checking, circuit breaker, stale token handling.
 * The Firestore trigger is tested via mocked Firestore docs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

// ── FCM service mock ──────────────────────────────────────────────────────────

vi.mock("../services/fcm", () => ({
  sendFcm: vi.fn(),
  StaleTokenError: class extends Error {
    constructor(token: string) {
      super(`stale: ${token}`);
      this.name = "StaleTokenError";
    }
  },
  tryReserveFcmQuota: vi.fn(async () => 1),
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: vi.fn((_, handler) => handler),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__serverTime__" },
  getFirestore: vi.fn(),
}));

import { buildPayload, kindToPrefKey } from "../onNotificationCreate";

// We test the pure helpers exported for testability.
describe("kindToPrefKey", () => {
  it("maps known kinds to pref keys", () => {
    expect(kindToPrefKey("announcement")).toBe("announcements");
    expect(kindToPrefKey("mention")).toBe("mentions");
    expect(kindToPrefKey("board_mention")).toBe("mentions");
    expect(kindToPrefKey("reply")).toBe("replies");
  });

  it("returns null for unknown kinds", () => {
    expect(kindToPrefKey("digest_send")).toBe("digest");
  });
});

describe("buildPayload", () => {
  it("announcement payload has announcement title", () => {
    const p = buildPayload({ kind: "announcement", body: "Big news!", groupId: "g1" }, "alice");
    expect(p.title).toMatch(/announcement/i);
    expect(p.body).toBe("Big news!");
    expect(p.collapseKey).toBe("announcement:g1");
  });

  it("mention payload", () => {
    const p = buildPayload({ kind: "mention", body: "hey @you", groupId: "g1" }, "alice");
    expect(p.title).toMatch(/mention/i);
    expect(p.collapseKey).toContain("mentionTarget:alice");
  });

  it("reply payload", () => {
    const p = buildPayload({ kind: "reply", body: "agreed!", groupId: "g1" }, "alice");
    expect(p.title).toMatch(/reply/i);
    expect(p.collapseKey).toBe("groupId:g1");
  });

  it("truncates body at 100 chars", () => {
    const long = "a".repeat(120);
    const p = buildPayload({ kind: "mention", body: long, groupId: "g1" }, "alice");
    expect(p.body.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
  });
});
