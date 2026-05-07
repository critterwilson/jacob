import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildIndexedMessage,
  classifyIndexAction,
  debitIndexQuota,
  peekIndexQuota,
  shouldReindex,
  type MessageDoc,
} from "../onMessageIndex";
import { _resetCircuitForTests } from "../services/typesense";

beforeEach(() => {
  _resetCircuitForTests();
});

afterEach(() => {
  delete process.env.TYPESENSE_DISABLED;
});

// ── shouldReindex (pure) ─────────────────────────────────────────────────────

describe("shouldReindex", () => {
  const msg = (over: Partial<MessageDoc> = {}): MessageDoc => ({
    authorUid: "alice",
    body: "hello",
    stickerIds: [],
    parentMessageId: null,
    deletedAt: null,
    moderation: { state: "scored" },
    createdAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  });

  it("returns true on create", () => {
    expect(shouldReindex(undefined, msg())).toBe(true);
  });

  it("returns true on hard-delete", () => {
    expect(shouldReindex(msg(), undefined)).toBe(true);
  });

  it("returns true when body changes", () => {
    expect(shouldReindex(msg({ body: "old" }), msg({ body: "new" }))).toBe(true);
  });

  it("returns true when deletedAt is set (soft-delete)", () => {
    expect(
      shouldReindex(msg(), msg({ deletedAt: { toMillis: () => 1 } })),
    ).toBe(true);
  });

  it("returns true when moderation.state changes", () => {
    expect(
      shouldReindex(
        msg({ moderation: { state: "scored" } }),
        msg({ moderation: { state: "hidden" } }),
      ),
    ).toBe(true);
  });

  it("returns false when only reactionCounts changes", () => {
    expect(
      shouldReindex(
        msg({ reactionCounts: { pray: 1 } } as MessageDoc),
        msg({ reactionCounts: { pray: 2 } } as MessageDoc),
      ),
    ).toBe(false);
  });

  it("returns false when only threadReplyCount changes", () => {
    expect(
      shouldReindex(
        msg({ threadReplyCount: 0 } as MessageDoc),
        msg({ threadReplyCount: 1 } as MessageDoc),
      ),
    ).toBe(false);
  });
});

// ── classifyIndexAction (pure) ───────────────────────────────────────────────

describe("classifyIndexAction", () => {
  it("hard-delete -> delete", () => {
    expect(classifyIndexAction(true, false, null)).toBe("delete");
  });

  it("soft-delete -> delete", () => {
    expect(classifyIndexAction(true, true, { _t: "ts" })).toBe("delete");
  });

  it("create -> upsert", () => {
    expect(classifyIndexAction(false, true, null)).toBe("upsert");
  });

  it("update -> upsert", () => {
    expect(classifyIndexAction(true, true, null)).toBe("upsert");
  });
});

// ── buildIndexedMessage (pure) ───────────────────────────────────────────────

describe("buildIndexedMessage", () => {
  it("normalises Firestore message data into the index document shape", () => {
    const doc = buildIndexedMessage(
      "m1",
      "g1",
      {
        authorUid: "alice",
        body: "hello",
        stickerIds: ["pray"],
        parentMessageId: null,
        moderation: { state: "scored" },
        createdAt: { toMillis: () => 1_700_000_000_000 },
      },
      "Alice Cooper",
    );
    expect(doc).toEqual({
      id: "m1",
      groupId: "g1",
      authorUid: "alice",
      authorDisplayName: "Alice Cooper",
      body: "hello",
      stickerIds: ["pray"],
      createdAtUnix: 1_700_000_000,
      parentMessageId: null,
      moderationState: "scored",
    });
  });

  it("handles missing optional fields gracefully", () => {
    const doc = buildIndexedMessage("m1", "g1", { authorUid: "alice" }, null);
    expect(doc.body).toBe("");
    expect(doc.stickerIds).toBeUndefined();
    expect(doc.createdAtUnix).toBe(0);
    expect(doc.moderationState).toBeNull();
  });
});

// ── peekIndexQuota / debitIndexQuota (M-FUNC-3) ──────────────────────────────

// Minimal Firestore stand-in. We don't need to resolve FieldValue.increment
// sentinels — debitIndexQuota's return value is `current + 1` computed from
// the read snap, so we just track which paths were `set` to verify the
// write-on-success ordering.
function makeFakeFirestore(initial: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(initial));
  const writes: string[] = [];

  function buildPath(path: string) {
    return {
      path,
      async get() {
        return {
          exists: docs.has(path),
          data: () => docs.get(path),
        };
      },
    };
  }

  return {
    collection: (name: string) => ({
      doc: (id: string) => buildPath(`${name}/${id}`),
    }),
    runTransaction: async <T,>(
      fn: (txn: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          opts?: { merge?: boolean },
        ) => void;
      }) => Promise<T>,
    ) => {
      const txn = {
        async get(ref: { path: string }) {
          return {
            exists: docs.has(ref.path),
            data: () => docs.get(ref.path),
          };
        },
        set(ref: { path: string }, data: Record<string, unknown>) {
          writes.push(ref.path);
          // Stash whatever was passed; tests don't read it back as a number.
          docs.set(ref.path, data);
        },
      };
      return await fn(txn);
    },
    docs,
    writes,
  };
}

describe("peekIndexQuota / debitIndexQuota (M-FUNC-3)", () => {
  it("peek returns 0 when no doc exists for the day", async () => {
    const fs = makeFakeFirestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await peekIndexQuota(fs as any, "2026-05-06")).toBe(0);
  });

  it("peek returns the stored count without mutating it", async () => {
    const fs = makeFakeFirestore({
      "search_state/index-2026-05-06": { count: 7, day: "2026-05-06" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await peekIndexQuota(fs as any, "2026-05-06")).toBe(7);
    expect(fs.docs.get("search_state/index-2026-05-06")?.count).toBe(7);
    expect(fs.writes).toHaveLength(0);
  });

  it("peek does not create the day's quota doc (M-FUNC-3 — no debit on peek)", async () => {
    const fs = makeFakeFirestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await peekIndexQuota(fs as any, "2026-05-06");
    expect(fs.docs.has("search_state/index-2026-05-06")).toBe(false);
    expect(fs.writes).toHaveLength(0);
  });

  it("debit returns current+1 for an empty day (starts from 0)", async () => {
    const fs = makeFakeFirestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await debitIndexQuota(fs as any, "2026-05-06")).toBe(1);
    // The set was issued — only at the right path.
    expect(fs.writes).toEqual(["search_state/index-2026-05-06"]);
  });

  it("debit returns current+1 when an existing count is present", async () => {
    const fs = makeFakeFirestore({
      "search_state/index-2026-05-06": { count: 41, day: "2026-05-06" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await debitIndexQuota(fs as any, "2026-05-06")).toBe(42);
  });
});
