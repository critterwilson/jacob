import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildIndexedMessage,
  classifyIndexAction,
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
