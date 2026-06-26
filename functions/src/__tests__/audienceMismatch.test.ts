/**
 * T56 — sticker-audience guard in onMessageCreate.
 *
 * The picker filters by group audience client-side, but a determined
 * caller could POST any sticker slug. The trigger flags mismatches
 * (no auto-hide) and writes a moderation_queue row.
 *
 * This test stubs the Firestore Admin SDK directly. The real trigger
 * wrapper is exercised by the emulator suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flagAudienceMismatch } from "../onMessageCreate";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "<serverTimestamp>" },
  getFirestore: vi.fn(),
}));

type DocSnap = {
  exists: boolean;
  data: () => Record<string, unknown>;
};

function makeFakeDb(opts: {
  groupAudience: string;
  stickers: Record<string, string>; // slug -> audience
}) {
  const writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];

  function docFor(path: string): {
    get: () => Promise<DocSnap>;
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  } {
    if (path.startsWith("groups/") && path.endsWith("/messages/m1")) {
      return {
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (data, opts) => {
          writes.push({ path, data, merge: opts?.merge ?? false });
        },
      };
    }
    if (path.startsWith("groups/")) {
      return {
        get: async () => ({
          exists: true,
          data: () => ({ audience: opts.groupAudience }),
        }),
        set: async () => {
          /* noop */
        },
      };
    }
    if (path.startsWith("stickers/")) {
      const slug = path.split("/")[1];
      const audience = opts.stickers[slug];
      return {
        get: async () => ({
          exists: audience !== undefined,
          data: () => ({ audience }),
        }),
        set: async () => {
          /* noop */
        },
      };
    }
    if (path.startsWith("moderation_queue/")) {
      return {
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (data, opts) => {
          writes.push({ path, data, merge: opts?.merge ?? false });
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  }

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const root = `${name}/${id}`;
        return {
          ...docFor(root),
          collection: (sub: string) => ({
            doc: (subId: string) => docFor(`${root}/${sub}/${subId}`),
          }),
        };
      },
    }),
  };
  return { db, writes };
}

describe("flagAudienceMismatch (T56)", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-op when every sticker matches the group audience", async () => {
    const { db, writes } = makeFakeDb({
      groupAudience: "christian",
      stickers: { "prayer-request": "christian", encouragement: "general" },
    });
    await flagAudienceMismatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "g1",
      "m1",
      ["prayer-request", "encouragement"],
      "evt-1",
    );
    expect(writes).toHaveLength(0);
  });

  it("flags + queues a row when a sticker's audience doesn't match", async () => {
    // A christian-only sticker posted into a general-audience group.
    const { db, writes } = makeFakeDb({
      groupAudience: "general",
      stickers: { "prayer-request": "christian" },
    });
    await flagAudienceMismatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "g1",
      "m1",
      ["prayer-request"],
      "evt-2",
    );
    const messageWrite = writes.find((w) =>
      w.path.endsWith("messages/m1"),
    );
    expect(messageWrite).toBeDefined();
    const moderation = messageWrite?.data.moderation as Record<string, unknown>;
    expect(moderation.state).toBe("flagged");
    expect(moderation.reason).toBe("audience_mismatch");
    const queueWrite = writes.find((w) => w.path.startsWith("moderation_queue/"));
    expect(queueWrite).toBeDefined();
    expect(queueWrite?.data.reason).toBe("audience_mismatch");
    expect(queueWrite?.data.status).toBe("pending");
    // The message is NOT auto-hidden — only flagged.
    expect(moderation.hiddenAt).toBeUndefined();
  });

  it("treats `general` stickers as universally allowed", async () => {
    const { db, writes } = makeFakeDb({
      groupAudience: "christian",
      stickers: { praise: "general" },
    });
    await flagAudienceMismatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "g1",
      "m1",
      ["praise"],
      "evt-3",
    );
    expect(writes).toHaveLength(0);
  });

  it("ignores unknown sticker slugs (no flag, no throw)", async () => {
    const { db, writes } = makeFakeDb({
      groupAudience: "christian",
      stickers: {},
    });
    await flagAudienceMismatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "g1",
      "m1",
      ["totally-unknown"],
      "evt-4",
    );
    expect(writes).toHaveLength(0);
  });

  it("uses the event id in the queue doc id (idempotent on retry)", async () => {
    const { db, writes } = makeFakeDb({
      groupAudience: "general",
      stickers: { "prayer-request": "christian" },
    });
    await flagAudienceMismatch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "g1",
      "m1",
      ["prayer-request"],
      "evt-fixed",
    );
    const queueWrite = writes.find((w) => w.path.startsWith("moderation_queue/"));
    expect(queueWrite?.path).toBe("moderation_queue/audience_g1_m1_evt-fixed");
  });
});
