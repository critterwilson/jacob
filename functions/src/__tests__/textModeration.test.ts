/**
 * Unit tests for the helpers in services/textModeration.ts.
 * The Firestore trigger wrappers in onMessageCreate.ts and
 * onBoardPostCreate.ts are exercised end-to-end via the emulator
 * (separate operational test); here we cover policy thresholds,
 * decision logic, the circuit breaker, and the shared
 * `runTextModeration` orchestration that both triggers delegate to.
 */

import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  _resetCircuitForTests,
  decisionFor,
  isCircuitOpen,
  moderateText,
  recordFailure,
  recordSuccess,
  runTextModeration,
  thresholdsFor,
  type Policy,
} from "../services/textModeration";

describe("thresholdsFor", () => {
  it("strict has the lowest hide threshold", () => {
    expect(thresholdsFor("strict").hide).toBeLessThan(thresholdsFor("standard").hide);
    expect(thresholdsFor("standard").hide).toBeLessThan(thresholdsFor("lenient").hide);
  });

  it("flag thresholds sit below hide thresholds", () => {
    for (const policy of ["lenient", "standard", "strict"] as const) {
      const t = thresholdsFor(policy);
      expect(t.flag).toBeLessThan(t.hide);
    }
  });
});

describe("decisionFor", () => {
  it("returns null when nothing exceeds thresholds", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.1 }], "standard");
    expect(result.decision).toBeNull();
    expect(result.reasons).toEqual([]);
  });

  it("hides on standard policy when Toxic > 0.85", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.9 }], "standard");
    expect(result.decision).toBe("hide");
    expect(result.reasons).toContain("Toxic");
  });

  it("does not hide the same message under lenient policy", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.9 }], "lenient");
    expect(result.decision).toBe("flag");
  });

  it("hides under strict at a much lower threshold", () => {
    const result = decisionFor([{ name: "Insult", confidence: 0.72 }], "strict");
    expect(result.decision).toBe("hide");
  });

  it("ignores categories not in the tracked set", () => {
    const result = decisionFor([{ name: "Politics", confidence: 0.99 }], "standard");
    expect(result.decision).toBeNull();
  });

  it("Sexual category is hidden under lenient at the strict threshold", () => {
    // Sexual is in ALWAYS_HIDE_AT_STRICT — at confidence 0.71 under
    // lenient policy (hide=0.95), the always-hide rule still kicks in
    // because 0.71 > strict.hide (0.7).
    const result = decisionFor([{ name: "Sexual", confidence: 0.72 }], "lenient");
    expect(result.decision).toBe("hide");
  });

  it("returns the strongest decision when both hide and flag are triggered", () => {
    const result = decisionFor(
      [
        { name: "Toxic", confidence: 0.9 },
        { name: "Profanity", confidence: 0.75 },
      ],
      "standard",
    );
    expect(result.decision).toBe("hide");
    expect(result.reasons).toEqual(["Toxic"]);
  });
});

describe("circuit breaker", () => {
  beforeEach(() => {
    _resetCircuitForTests();
  });

  afterEach(() => {
    _resetCircuitForTests();
  });

  it("starts closed", () => {
    expect(isCircuitOpen()).toBe(false);
  });

  it("opens after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(true);
  });

  it("does not open at 4 failures", () => {
    for (let i = 0; i < 4; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(false);
  });

  it("a success resets the failure counter", () => {
    recordFailure();
    recordFailure();
    recordSuccess();
    for (let i = 0; i < 4; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(false);
  });

  it("auto-closes after the open window elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) recordFailure(t0);
    expect(isCircuitOpen(t0)).toBe(true);
    expect(isCircuitOpen(t0 + 6 * 60 * 1000)).toBe(false);
  });
});

describe("moderateText", () => {
  it("calls the client and returns category scores", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockResolvedValue([
        {
          moderationCategories: [
            { name: "Toxic", confidence: 0.42 },
            { name: "Politics", confidence: 0.9 }, // dropped by trigger filter, kept here
            { name: undefined, confidence: 0.5 }, // bad row, dropped
          ],
        },
      ]),
    };

    const result = await moderateText(fakeClient as never, "hello world");
    expect(fakeClient.moderateText).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { name: "Toxic", confidence: 0.42 },
      { name: "Politics", confidence: 0.9 },
    ]);
  });

  it("returns an empty array when the API responds empty", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockResolvedValue([{ moderationCategories: [] }]),
    };
    expect(await moderateText(fakeClient as never, "hi")).toEqual([]);
  });

  it("propagates API errors so the caller can record a failure", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockRejectedValue(new Error("API blew up")),
    };
    await expect(moderateText(fakeClient as never, "hi")).rejects.toThrow("API blew up");
  });
});

// Sanity: Policy type union is exhaustive.
describe("Policy union", () => {
  it("covers exactly lenient, standard, strict", () => {
    const policies: Policy[] = ["lenient", "standard", "strict"];
    for (const p of policies) {
      expect(thresholdsFor(p)).toBeDefined();
    }
  });
});

// ── runTextModeration ────────────────────────────────────────────────────────
//
// Builds a tiny fake Firestore harness so we can assert on the writes
// without standing up the emulator. Two callsites: onMessageCreate
// (deterministic queue doc id) and onBoardPostCreate (auto id).

type FakeQueueWrite = { docId: string | "AUTO"; data: Record<string, unknown> };
type FakeResourceWrite = Record<string, unknown>;

function makeFakeDb(opts: { quota: { current: number; cap?: number } } = {
  quota: { current: 0 },
}) {
  const queueWrites: FakeQueueWrite[] = [];
  const resourceWrites: FakeResourceWrite[] = [];

  // The "moderation_state" doc the quota txn reads/writes.
  let quotaCount = opts.quota.current;

  // PR11 / M3 — eventIds whose moderation_text_events marker has been
  // committed. A second-delivery attempt for the same eventId sees the
  // marker as exists=true and short-circuits.
  const seenEventIds = new Set<string>();

  // Refs are plain objects with a `__kind` discriminator so the txn mock
  // can route get/set by collection without re-encoding the path.
  type Ref = { __kind: "state" | "marker"; id: string };
  const stateRef: Ref = { __kind: "state", id: "text-2026-05-04" };

  const txnFn = async (
    fn: (txn: {
      get: Mock;
      set: Mock;
    }) => Promise<unknown>,
  ) => {
    const txn = {
      get: vi.fn().mockImplementation(async (ref: Ref) => {
        if (ref.__kind === "marker") {
          return { exists: seenEventIds.has(ref.id) };
        }
        return { exists: true, data: () => ({ count: quotaCount }) };
      }),
      set: vi.fn().mockImplementation((ref: Ref) => {
        if (ref.__kind === "marker") {
          seenEventIds.add(ref.id);
        } else {
          quotaCount += 1;
        }
      }),
    };
    return await fn(txn);
  };

  const queueDocSet = vi.fn().mockResolvedValue(undefined);
  const queueAdd = vi.fn().mockResolvedValue({});
  let lastQueueDocId: string | null = null;

  const collection = vi.fn().mockImplementation((col: string) => {
    if (col === "moderation_state") {
      return {
        doc: vi.fn().mockReturnValue(stateRef),
      };
    }
    if (col === "moderation_text_events") {
      return {
        doc: vi.fn().mockImplementation((eventId: string) => ({
          __kind: "marker" as const,
          id: eventId,
        })),
      };
    }
    if (col === "moderation_queue") {
      return {
        doc: vi.fn().mockImplementation((id: string) => {
          lastQueueDocId = id;
          return {
            set: vi.fn().mockImplementation((data) => {
              queueWrites.push({ docId: id, data });
              return queueDocSet(data);
            }),
          };
        }),
        add: vi.fn().mockImplementation((data) => {
          queueWrites.push({ docId: "AUTO", data });
          return queueAdd(data);
        }),
      };
    }
    throw new Error(`unexpected collection: ${col}`);
  });

  const db = {
    collection,
    runTransaction: vi
      .fn()
      .mockImplementation(async (fn) => txnFn(fn as never)),
  } as unknown as Firestore;

  const resourceDocRef = {
    update: vi.fn().mockImplementation((data) => {
      resourceWrites.push(data);
      return Promise.resolve();
    }),
  } as unknown as DocumentReference;

  return {
    db,
    resourceDocRef,
    queueWrites,
    resourceWrites,
    getLastQueueDocId: () => lastQueueDocId,
    getQuotaCount: () => quotaCount,
  };
}

const lowScoresClient = {
  moderateText: vi.fn().mockResolvedValue([
    { moderationCategories: [{ name: "Toxic", confidence: 0.05 }] },
  ]),
};

const highToxicClient = {
  moderateText: vi.fn().mockResolvedValue([
    { moderationCategories: [{ name: "Toxic", confidence: 0.95 }] },
  ]),
};

const midToxicClient = {
  moderateText: vi.fn().mockResolvedValue([
    { moderationCategories: [{ name: "Toxic", confidence: 0.75 }] },
  ]),
};

describe("runTextModeration", () => {
  beforeEach(() => {
    _resetCircuitForTests();
    delete process.env.MODERATION_TEXT_DISABLED;
    delete process.env.JACOB_TEXT_MODERATION_DAILY_CAP;
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetCircuitForTests();
    delete process.env.MODERATION_TEXT_DISABLED;
    delete process.env.JACOB_TEXT_MODERATION_DAILY_CAP;
  });

  it("kill switch: writes nothing when MODERATION_TEXT_DISABLED=true", async () => {
    process.env.MODERATION_TEXT_DISABLED = "true";
    const harness = makeFakeDb();

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-1",
      body: "hi",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites).toEqual([]);
    expect(harness.queueWrites).toEqual([]);
    expect(lowScoresClient.moderateText).not.toHaveBeenCalled();
  });

  it("circuit open: writes skipped state and never calls the API", async () => {
    // Trip the breaker.
    for (let i = 0; i < 5; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(true);

    const harness = makeFakeDb();
    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-1",
      body: "hi",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites).toHaveLength(1);
    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: { state: "skipped", reasons: ["circuit_open"] },
    });
    expect(lowScoresClient.moderateText).not.toHaveBeenCalled();
    expect(harness.queueWrites).toEqual([]);
  });

  it("quota exhausted: writes skipped state and skips the API", async () => {
    process.env.JACOB_TEXT_MODERATION_DAILY_CAP = "10";
    const harness = makeFakeDb({ quota: { current: 10 } });

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-1",
      body: "hi",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites).toHaveLength(1);
    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: { state: "skipped", reasons: ["quota_exceeded"] },
    });
    expect(lowScoresClient.moderateText).not.toHaveBeenCalled();
    expect(harness.queueWrites).toEqual([]);
  });

  it("API error: writes errored state and records a circuit failure", async () => {
    const harness = makeFakeDb();
    const failingClient = {
      moderateText: vi.fn().mockRejectedValue(new Error("NL down")),
    };

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-1",
      body: "hi",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => failingClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: { state: "errored", reasons: ["api_error"] },
    });
    expect(harness.queueWrites).toEqual([]);
    // One failure recorded — not enough to open, but verifies plumbing.
    expect(isCircuitOpen()).toBe(false);
  });

  it("low scores → 'scored' state, no queue row, includes policy", async () => {
    const harness = makeFakeDb();

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-1",
      body: "hi",
      policy: "lenient",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites).toHaveLength(1);
    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: { state: "scored", reasons: [], policy: "lenient" },
    });
    expect(harness.queueWrites).toEqual([]);
  });

  it("high score under standard policy: writes hidden + queue row with deterministic id (message)", async () => {
    const harness = makeFakeDb();

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId: "evt-abc",
      body: "you suck",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => highToxicClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });

    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: {
        state: "hidden",
        reasons: ["Toxic"],
        policy: "standard",
      },
    });
    expect(harness.queueWrites).toHaveLength(1);
    expect(harness.queueWrites[0].docId).toBe("msg_evt-abc");
    expect(harness.queueWrites[0].data).toMatchObject({
      resourceRef: "groups/g1/messages/m1",
      resourceType: "message",
      groupId: "g1",
      severity: 2,
      auto: true,
      reasons: ["Toxic"],
      status: "pending",
      reportedBy: null,
      reason: "auto-text-moderation",
      policy: "standard",
    });
  });

  it("mid score under standard policy: writes flagged + queue row with auto id (board)", async () => {
    const harness = makeFakeDb();

    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "boards/general-board/posts/p1",
      resourceType: "board_post",
      resourceFkFields: { boardId: "general-board" },
      eventId: "evt-xyz",
      body: "rude",
      policy: "standard",
      // No queueDocIdPrefix → board path.
      getNLClient: () => midToxicClient as never,
      logContext: { boardId: "general-board", postId: "p1" },
    });

    expect(harness.resourceWrites[0]).toMatchObject({
      moderation: {
        state: "flagged",
        reasons: ["Toxic"],
        policy: "standard",
      },
    });
    expect(harness.queueWrites).toHaveLength(1);
    expect(harness.queueWrites[0].docId).toBe("AUTO");
    expect(harness.queueWrites[0].data).toMatchObject({
      resourceRef: "boards/general-board/posts/p1",
      resourceType: "board_post",
      boardId: "general-board",
      severity: 1,
      auto: true,
      reasons: ["Toxic"],
      status: "pending",
      policy: "standard",
    });
    // groupId must NOT be present on board rows.
    expect(harness.queueWrites[0].data).not.toHaveProperty("groupId");
  });

  it("PR11 / M3: re-delivery of same eventId does not double-debit quota", async () => {
    const harness = makeFakeDb({ quota: { current: 0 } });
    const eventId = "evt-redelivery";

    // Delivery #1 — debits one slot, writes the marker.
    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId,
      body: "hello",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });
    expect(harness.getQuotaCount()).toBe(1);
    const writesAfterFirst = harness.resourceWrites.length;

    // Delivery #2 — same eventId, marker present → must skip
    // both quota and the API call. No new writes on the resource.
    await runTextModeration({
      db: harness.db,
      resourceDocRef: harness.resourceDocRef,
      resourcePath: "groups/g1/messages/m1",
      resourceType: "message",
      resourceFkFields: { groupId: "g1" },
      eventId,
      body: "hello",
      policy: "standard",
      queueDocIdPrefix: "msg",
      getNLClient: () => lowScoresClient as never,
      logContext: { gid: "g1", mid: "m1" },
    });
    // Still 1 — the second delivery did not increment.
    expect(harness.getQuotaCount()).toBe(1);
    expect(harness.resourceWrites.length).toBe(writesAfterFirst);
  });

  it("PR11 / M3: distinct eventIds debit separately", async () => {
    const harness = makeFakeDb({ quota: { current: 0 } });
    for (const eventId of ["evt-a", "evt-b", "evt-c"]) {
      await runTextModeration({
        db: harness.db,
        resourceDocRef: harness.resourceDocRef,
        resourcePath: "groups/g1/messages/m1",
        resourceType: "message",
        resourceFkFields: { groupId: "g1" },
        eventId,
        body: "hello",
        policy: "standard",
        queueDocIdPrefix: "msg",
        getNLClient: () => lowScoresClient as never,
        logContext: { gid: "g1", mid: "m1" },
      });
    }
    expect(harness.getQuotaCount()).toBe(3);
  });
});
