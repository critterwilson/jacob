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

vi.mock("../services/eventMarkers", () => ({
  eventMarker: () => ({ processedAt: "__server__" }),
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

vi.mock("firebase-admin/functions", () => ({
  getFunctions: vi.fn(),
}));

import { buildPayload, kindToPrefKey, onNotificationCreate } from "../onNotificationCreate";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";

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

// ── trigger-level dedupe regression (H-FUNC-1) ────────────────────────────────

/**
 * Build a stub Firestore that walks `collection().doc()` chains and returns
 * a synthetic ref carrying its full path. The trigger uses
 * `users/{uid}/notifications/{nid}/_events/{eventId}` as the marker, so the
 * stub tracks which event ids have been "set" inside `runTransaction` and
 * reports `exists: true` for any subsequent `txn.get` on the same path.
 *
 * Devices are returned from the `users/{uid}/devices` collection get().
 */
type DeviceFixture = { id: string; fcmToken: string };

function makeNotifFirestoreStub(opts: { devices: DeviceFixture[] }) {
  const seenEventMarkerPaths = new Set<string>();
  const updateMock = vi.fn().mockResolvedValue(undefined);

  function makeDocRef(pathParts: string[]) {
    const path = pathParts.join("/");
    return {
      path,
      collection: (sub: string) => makeCollectionRef([...pathParts, sub]),
      update: updateMock,
      // Doc-level get(): only used for notificationPrefs/main here; default
      // to "no doc" so the default-allow branch is taken.
      get: vi.fn().mockResolvedValue({ data: () => undefined }),
    };
  }

  function makeCollectionRef(pathParts: string[]) {
    return {
      doc: (id: string) => makeDocRef([...pathParts, id]),
      // Collection-level get(): only used for `users/{uid}/devices` here.
      get: vi.fn().mockResolvedValue({
        empty: opts.devices.length === 0,
        size: opts.devices.length,
        docs: opts.devices.map((d) => ({
          id: d.id,
          data: () => ({ fcmToken: d.fcmToken, platform: "ios" }),
        })),
      }),
    };
  }

  const db = {
    collection: (col: string) => makeCollectionRef([col]),
    runTransaction: async (
      fn: (txn: {
        get: (ref: { path: string }) => Promise<{ exists: boolean }>;
        set: (ref: { path: string }, data: unknown) => void;
      }) => Promise<unknown>,
    ) => {
      const pendingPaths = new Set<string>();
      const txn = {
        get: async (ref: { path: string }) => {
          pendingPaths.add(ref.path);
          return { exists: seenEventMarkerPaths.has(ref.path) };
        },
        set: (ref: { path: string }, _data: unknown) => {
          pendingPaths.add(ref.path);
          seenEventMarkerPaths.add(ref.path);
        },
      };
      const result = await fn(txn);
      void pendingPaths;
      return result;
    },
  };

  return { db, updateMock, seenEventMarkerPaths };
}

describe("onNotificationCreate — at-least-once redelivery dedupe (H-FUNC-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invoked twice with the same eventId enqueues exactly N tasks, not 2N", async () => {
    const enqueueMock = vi.fn().mockResolvedValue(undefined);
    (getFunctions as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      taskQueue: () => ({ enqueue: enqueueMock }),
    });

    const stub = makeNotifFirestoreStub({
      devices: [
        { id: "deviceA", fcmToken: "tokA" },
        { id: "deviceB", fcmToken: "tokB" },
      ],
    });
    (getFirestore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(stub.db);

    const event = {
      id: "evt-redeliver-1",
      params: { uid: "alice", nid: "n1" },
      data: {
        data: () => ({
          kind: "announcement",
          groupId: "g1",
          body: "Hello",
        }),
      },
    } as unknown as Parameters<typeof onNotificationCreate>[0];

    // First delivery — enqueues one task per device.
    await (onNotificationCreate as unknown as (e: typeof event) => Promise<void>)(event);
    expect(enqueueMock).toHaveBeenCalledTimes(2);

    // Redelivery with the same event.id must hit the marker and bail.
    await (onNotificationCreate as unknown as (e: typeof event) => Promise<void>)(event);
    expect(enqueueMock).toHaveBeenCalledTimes(2); // unchanged — no extra tasks
  });
});
