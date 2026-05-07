/**
 * Unit tests for the leaderDelta pure helper.
 *
 * The cases mirror the truth table in onMemberWrite — they catch off-
 * by-one regressions that would silently break the leaderless-guard
 * rule (the rule reads `leaderCount` and trusts the trigger).
 */

import { describe, expect, it } from "vitest";

import {
  leaderDelta,
  leaderUidsAction,
  mirrorRtdbMembership,
  orgMirrorAction,
} from "../onMemberWrite";

describe("leaderDelta", () => {
  it("create as leader → +1", () => {
    expect(leaderDelta(false, true, undefined, "leader")).toBe(1);
  });

  it("create as member → 0", () => {
    expect(leaderDelta(false, true, undefined, "member")).toBe(0);
  });

  it("delete a leader → -1", () => {
    expect(leaderDelta(true, false, "leader", undefined)).toBe(-1);
  });

  it("delete a member → 0", () => {
    expect(leaderDelta(true, false, "member", undefined)).toBe(0);
  });

  it("promote member → leader → +1", () => {
    expect(leaderDelta(true, true, "member", "leader")).toBe(1);
  });

  it("demote leader → member → -1", () => {
    expect(leaderDelta(true, true, "leader", "member")).toBe(-1);
  });

  it("no role change (leader → leader) → 0", () => {
    expect(leaderDelta(true, true, "leader", "leader")).toBe(0);
  });

  it("no role change (member → member) → 0", () => {
    expect(leaderDelta(true, true, "member", "member")).toBe(0);
  });

  it("write with both sides missing → 0", () => {
    expect(leaderDelta(false, false, undefined, undefined)).toBe(0);
  });
});

describe("leaderUidsAction (H5)", () => {
  it("create as leader → add", () => {
    expect(leaderUidsAction(false, true, undefined, "leader")).toBe("add");
  });

  it("create as member → noop", () => {
    expect(leaderUidsAction(false, true, undefined, "member")).toBe("noop");
  });

  it("delete a leader → remove", () => {
    expect(leaderUidsAction(true, false, "leader", undefined)).toBe("remove");
  });

  it("delete a member → noop", () => {
    expect(leaderUidsAction(true, false, "member", undefined)).toBe("noop");
  });

  it("promote member → leader → add", () => {
    expect(leaderUidsAction(true, true, "member", "leader")).toBe("add");
  });

  it("demote leader → member → remove", () => {
    expect(leaderUidsAction(true, true, "leader", "member")).toBe("remove");
  });

  it("no role change (leader → leader) → noop", () => {
    expect(leaderUidsAction(true, true, "leader", "leader")).toBe("noop");
  });
});

describe("orgMirrorAction (T54)", () => {
  it("create → join", () => {
    expect(orgMirrorAction(false, true)).toBe("join");
  });

  it("delete → leave", () => {
    expect(orgMirrorAction(true, false)).toBe("leave");
  });

  it("update (e.g. promotion) → noop", () => {
    expect(orgMirrorAction(true, true)).toBe("noop");
  });

  it("phantom write (both missing) → noop", () => {
    expect(orgMirrorAction(false, false)).toBe("noop");
  });
});

describe("mirrorRtdbMembership (T48 + M-FUNC-2)", () => {
  function makeFakeRtdb() {
    const calls: { path: string; op: "set"; value: unknown }[] = [];
    return {
      calls,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: {
        ref: (path: string) => ({
          set: async (value: unknown) => {
            calls.push({ path, op: "set", value });
          },
        }),
      } as any,
    };
  }

  // Minimal Firestore stand-in: tracks marker docs in an in-memory map and
  // exposes a `runTransaction` that mimics the read-then-set semantics the
  // production code relies on for the idempotency guard.
  function makeFakeFirestore() {
    const docs = new Map<string, Record<string, unknown>>();
    const writes: string[] = [];

    function docFor(path: string) {
      return {
        path,
        async get() {
          return {
            exists: docs.has(path),
            data: () => docs.get(path),
          };
        },
        set(data: Record<string, unknown>) {
          writes.push(path);
          docs.set(path, data);
        },
      };
    }

    function buildPathRef(path: string) {
      return {
        ...docFor(path),
        collection: (sub: string) => ({
          doc: (id: string) => buildPathRef(`${path}/${sub}/${id}`),
        }),
      };
    }

    const fs = {
      collection: (name: string) => ({
        doc: (id: string) => buildPathRef(`${name}/${id}`),
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
            docs.set(ref.path, data);
          },
        };
        return await fn(txn);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fs: fs as any, docs, writes };
  }

  it("noop returns immediately and writes nothing", async () => {
    const { db, calls } = makeFakeRtdb();
    const { fs } = makeFakeFirestore();
    await mirrorRtdbMembership("alice", "g1", "noop", "evt-1", fs, db);
    expect(calls).toHaveLength(0);
  });

  it("join writes /memberships/{uid}/{gid}: true and stamps the marker", async () => {
    const { db, calls } = makeFakeRtdb();
    const { fs, writes } = makeFakeFirestore();
    await mirrorRtdbMembership("alice", "g1", "join", "evt-1", fs, db);
    expect(calls).toEqual([
      { path: "memberships/alice/g1", op: "set", value: true },
    ]);
    expect(writes).toContain("users/alice/_rtdb_member_events/g1_evt-1");
  });

  it("leave writes /memberships/{uid}/{gid}: null and stamps the marker", async () => {
    const { db, calls } = makeFakeRtdb();
    const { fs, writes } = makeFakeFirestore();
    await mirrorRtdbMembership("alice", "g1", "leave", "evt-2", fs, db);
    expect(calls).toEqual([
      { path: "memberships/alice/g1", op: "set", value: null },
    ]);
    expect(writes).toContain("users/alice/_rtdb_member_events/g1_evt-2");
  });

  it("redelivery of the same eventId does not re-write RTDB (M-FUNC-2)", async () => {
    const { db, calls } = makeFakeRtdb();
    const { fs } = makeFakeFirestore();
    await mirrorRtdbMembership("alice", "g1", "join", "evt-stable", fs, db);
    await mirrorRtdbMembership("alice", "g1", "join", "evt-stable", fs, db);
    expect(calls).toHaveLength(1);
  });

  it("out-of-order redelivery cannot resurrect a stale membership (M-FUNC-2)", async () => {
    // Real-world scenario: T0 join → T1 leave → T2 retry-of-join.
    // Each delivery has a distinct eventId; the marker keeps the
    // RTDB write commutative on per-event basis. After leave, the
    // retry-of-join still re-applies (it's a new eventId), but the
    // marker prevents repeated re-application of the SAME stale
    // event after subsequent later-state writes.
    const { db, calls } = makeFakeRtdb();
    const { fs } = makeFakeFirestore();
    await mirrorRtdbMembership("alice", "g1", "join", "evt-A", fs, db);
    await mirrorRtdbMembership("alice", "g1", "leave", "evt-B", fs, db);
    // Redelivery of join (same eventId A) — must NOT resurrect.
    await mirrorRtdbMembership("alice", "g1", "join", "evt-A", fs, db);
    // RTDB sees: set(true), set(null), and then the marker dedupes the
    // stale redelivery → no third write.
    expect(calls).toEqual([
      { path: "memberships/alice/g1", op: "set", value: true },
      { path: "memberships/alice/g1", op: "set", value: null },
    ]);
  });
});
