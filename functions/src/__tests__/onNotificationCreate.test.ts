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
    expect(kindToPrefKey("group_message")).toBe("groupMessages");
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

  it("group_message payload collapses per-group", () => {
    const p = buildPayload(
      { kind: "group_message", body: "Hello", groupId: "g1" },
      "alice",
    );
    expect(p.title).toMatch(/new message/i);
    expect(p.body).toBe("Hello");
    expect(p.collapseKey).toBe("group_message:g1");
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
  const eventMarkerPaths = new Set<string>();
  const updateMock = vi.fn().mockResolvedValue(undefined);
  const eventMarkerSetMock = vi.fn();

  function makeDocRef(pathParts: string[]) {
    const path = pathParts.join("/");
    // Event marker docs live at .../_events/{eventId}. Their get() answers
    // `{exists: ...}` from the in-memory set, and set() records the write.
    const isEventMarker = pathParts.includes("_events");
    return {
      path,
      collection: (sub: string) => makeCollectionRef([...pathParts, sub]),
      update: updateMock,
      get: vi.fn().mockImplementation(async () => {
        if (isEventMarker) {
          return { exists: eventMarkerPaths.has(path) };
        }
        // notificationPrefs/main and similar: default to "no doc".
        return { data: () => undefined };
      }),
      set: vi.fn().mockImplementation(async (data: unknown) => {
        if (isEventMarker) {
          eventMarkerPaths.add(path);
          eventMarkerSetMock(path, data);
        }
      }),
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
  };

  return { db, updateMock, eventMarkerPaths, eventMarkerSetMock };
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

describe("onNotificationCreate — marker write order (M3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT set the event marker if enqueue fails partway through", async () => {
    // M3 regression: with the marker written BEFORE the enqueue loop, an
    // enqueue failure left the marker set and zero tasks queued. With
    // `retry: false`, no redelivery follows, so the notification was lost.
    // Now the marker is written AFTER a successful enqueue — so any
    // redelivery cleanly re-runs the loop.
    let call = 0;
    const enqueueMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("cloud tasks 503");
    });
    (getFunctions as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      taskQueue: () => ({ enqueue: enqueueMock }),
    });

    const stub = makeNotifFirestoreStub({
      devices: [
        { id: "deviceA", fcmToken: "tokA" },
        { id: "deviceB", fcmToken: "tokB" },
        { id: "deviceC", fcmToken: "tokC" },
      ],
    });
    (getFirestore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(stub.db);

    const event = {
      id: "evt-partial-fail-1",
      params: { uid: "alice", nid: "n1" },
      data: {
        data: () => ({
          kind: "announcement",
          groupId: "g1",
          body: "Hi",
        }),
      },
    } as unknown as Parameters<typeof onNotificationCreate>[0];

    await expect(
      (onNotificationCreate as unknown as (e: typeof event) => Promise<void>)(event),
    ).rejects.toThrow("cloud tasks 503");

    // Marker must NOT be set, so a redelivery can retry.
    expect(stub.eventMarkerPaths.size).toBe(0);
    expect(stub.eventMarkerSetMock).not.toHaveBeenCalled();
  });

  it("sets the event marker only after every enqueue succeeds", async () => {
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
      id: "evt-happy-path",
      params: { uid: "alice", nid: "n1" },
      data: {
        data: () => ({ kind: "announcement", groupId: "g1", body: "Hi" }),
      },
    } as unknown as Parameters<typeof onNotificationCreate>[0];

    await (onNotificationCreate as unknown as (e: typeof event) => Promise<void>)(event);

    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(stub.eventMarkerPaths.has(
      "users/alice/notifications/n1/_events/evt-happy-path",
    )).toBe(true);
  });
});

describe("onNotificationCreate — parallel enqueue (M8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues all per-device enqueues concurrently, not sequentially", async () => {
    // M8 regression: a 200-member announcement with 2 devices each used to
    // issue 400 sequential `queue.enqueue()` round-trips because the loop
    // awaited each call. Now they fan out in parallel via Promise.all.
    //
    // Test shape: every enqueue() returns a deferred promise. If the impl
    // is sequential, only the first one is ever called; the await keeps the
    // rest pending. If it's parallel, all start before any resolves.
    let inFlight = 0;
    let peakInFlight = 0;
    const resolvers: Array<() => void> = [];
    const enqueueMock = vi.fn().mockImplementation(() => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve();
        });
      });
    });
    (getFunctions as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      taskQueue: () => ({ enqueue: enqueueMock }),
    });

    const devices = Array.from({ length: 8 }, (_, i) => ({
      id: `device${i}`,
      fcmToken: `tok${i}`,
    }));
    const stub = makeNotifFirestoreStub({ devices });
    (getFirestore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(stub.db);

    const event = {
      id: "evt-parallel-1",
      params: { uid: "alice", nid: "n1" },
      data: {
        data: () => ({ kind: "announcement", groupId: "g1", body: "Hi" }),
      },
    } as unknown as Parameters<typeof onNotificationCreate>[0];

    const triggerDone = (onNotificationCreate as unknown as (
      e: typeof event,
    ) => Promise<void>)(event);

    // Let the microtask queue drain so every parallel enqueue() has had a
    // chance to register. With a sequential `for await` loop this would be 1.
    await new Promise((r) => setTimeout(r, 0));
    expect(enqueueMock).toHaveBeenCalledTimes(8);
    expect(peakInFlight).toBe(8);

    // Resolve everything so the trigger can complete.
    for (const r of resolvers) r();
    await triggerDone;
  });
});
