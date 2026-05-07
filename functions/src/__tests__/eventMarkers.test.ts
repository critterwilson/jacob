/**
 * Unit tests for the shared trigger-claim helper used by the top-level
 * idempotency guard in onMessageCreate and onBoardPostCreate (M-FUNC-1).
 *
 * These tests use a minimal Firestore stand-in. The real trigger
 * wrappers are exercised by the emulator suite.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "<serverTimestamp>" },
  Timestamp: { fromMillis: (ms: number) => ({ _ms: ms }) },
}));

import { claimEventOnce } from "../services/eventMarkers";

type DocLike = { path: string };

function makeFakeFirestore(initial: string[] = []) {
  const docs = new Set<string>(initial);
  const writes: { path: string; data: Record<string, unknown> }[] = [];

  return {
    docs,
    writes,
    runTransaction: async <T,>(
      fn: (txn: {
        get: (ref: DocLike) => Promise<{ exists: boolean }>;
        set: (ref: DocLike, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) => {
      const txn = {
        async get(ref: DocLike) {
          return { exists: docs.has(ref.path) };
        },
        set(ref: DocLike, data: Record<string, unknown>) {
          writes.push({ path: ref.path, data });
          docs.add(ref.path);
        },
      };
      return await fn(txn);
    },
  };
}

describe("claimEventOnce (M-FUNC-1)", () => {
  it("returns true and writes the marker when the event is fresh", async () => {
    const fs = makeFakeFirestore();
    const ref = { path: "groups/g1/messages/m1/_events/evt-1" } as DocLike;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = await claimEventOnce(fs as any, ref as any, { trigger: "x" });
    expect(fresh).toBe(true);
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0].path).toBe(ref.path);
    expect(fs.writes[0].data.trigger).toBe("x");
  });

  it("returns false and does NOT write when the marker already exists", async () => {
    const fs = makeFakeFirestore([
      "groups/g1/messages/m1/_events/evt-1",
    ]);
    const ref = { path: "groups/g1/messages/m1/_events/evt-1" } as DocLike;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = await claimEventOnce(fs as any, ref as any);
    expect(fresh).toBe(false);
    expect(fs.writes).toHaveLength(0);
  });

  it("two back-to-back calls — first true, second false (redelivery)", async () => {
    const fs = makeFakeFirestore();
    const ref = { path: "boards/b1/posts/p1/_events/evt-A" } as DocLike;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await claimEventOnce(fs as any, ref as any)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await claimEventOnce(fs as any, ref as any)).toBe(false);
    expect(fs.writes).toHaveLength(1);
  });
});
