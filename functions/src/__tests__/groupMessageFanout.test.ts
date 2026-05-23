/**
 * Unit tests for the group_message fan-out helper (ADR 0014).
 *
 * Mocks Firestore with a single in-memory store keyed by full doc path
 * so the helper exercises its real read + batch-write paths. The
 * production trigger is exercised end-to-end via the emulator (M9
 * follow-up); the cases below cover the exclusion + idempotency logic
 * the helper owns.
 */

import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { fanOutGroupMessage } from "../services/groupMessageFanout";

type Store = Map<string, Record<string, unknown>>;
type BatchOp = { path: string; data: Record<string, unknown> };

function makeDb(args: {
  members: string[];
  blockers?: string[]; // uids whose users/{uid}/blocks/{authorUid} doc exists
  mutedFor?: string[]; // uids whose users/{uid}/mutedGroups/{gid} doc exists
  gid: string;
  authorUid: string;
}): { db: Firestore; batchOps: BatchOp[] } {
  const { members, blockers = [], mutedFor = [], gid, authorUid } = args;
  const store: Store = new Map();
  for (const uid of members) {
    store.set(`groups/${gid}/members/${uid}`, { uid });
  }
  for (const uid of blockers) {
    store.set(`users/${uid}/blocks/${authorUid}`, { blockedAt: 1 });
  }
  for (const uid of mutedFor) {
    store.set(`users/${uid}/mutedGroups/${gid}`, { groupId: gid, mutedAt: 1 });
  }

  const batchOps: BatchOp[] = [];

  // The DB exposes the small slice of the Admin SDK surface our helper
  // uses: collection().doc().collection().doc().get(), the same chain
  // terminating in .get() at the subcollection level, and db.batch().
  const docRef = (path: string) => ({
    path,
    get: vi.fn().mockResolvedValue({ exists: store.has(path) }),
  });

  function subCol(parent: string) {
    return {
      doc: (id: string) => docFromPath(`${parent}/${id}`),
      // members.get() — return a snapshot with `.docs`
      get: vi.fn().mockResolvedValue({
        empty: members.length === 0,
        size: members.length,
        docs: members.map((uid) => ({ id: uid })),
      }),
    };
  }

  function docFromPath(path: string) {
    return {
      path,
      get: vi.fn().mockResolvedValue({ exists: store.has(path) }),
      collection: (sub: string) => subCol(`${path}/${sub}`),
    };
  }

  const db = {
    collection: (root: string) => ({
      doc: (id: string) => docFromPath(`${root}/${id}`),
    }),
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        batchOps.push({ path: ref.path, data });
      },
      commit: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Firestore;

  // Suppress the unused docRef warning — it documents the shape we
  // return from collection().doc(), useful for readers grepping for
  // ".get()" mocks.
  void docRef;

  return { db, batchOps };
}

describe("fanOutGroupMessage", () => {
  it("writes one notification per eligible member, skipping the author", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol"],
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hello group",
      alreadyNotifiedUids: [],
      eventId: "evt1",
    });
    expect(written).toBe(2);
    const paths = batchOps.map((o) => o.path).sort();
    expect(paths).toEqual([
      "users/bob/notifications/group_message_evt1_bob",
      "users/carol/notifications/group_message_evt1_carol",
    ]);
    // Payload shape: kind, groupId, messageRef, fromUid, body, readAt
    expect(batchOps[0].data).toMatchObject({
      kind: "group_message",
      groupId: "g1",
      messageRef: "groups/g1/messages/m1",
      fromUid: "alice",
      body: "Hello group",
      readAt: null,
    });
  });

  it("skips recipients already getting a mention notification for the same message", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol", "dave"],
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hey @bob",
      alreadyNotifiedUids: ["bob"],
      eventId: "evt1",
    });
    expect(written).toBe(2);
    expect(batchOps.map((o) => o.path).sort()).toEqual([
      "users/carol/notifications/group_message_evt1_carol",
      "users/dave/notifications/group_message_evt1_dave",
    ]);
  });

  it("skips recipients who blocked the author", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol"],
      blockers: ["bob"], // bob has users/bob/blocks/alice
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hello",
      alreadyNotifiedUids: [],
      eventId: "evt1",
    });
    expect(written).toBe(1);
    expect(batchOps[0].path).toBe(
      "users/carol/notifications/group_message_evt1_carol",
    );
  });

  it("skips recipients who muted the group", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol"],
      mutedFor: ["carol"],
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hello",
      alreadyNotifiedUids: [],
      eventId: "evt1",
    });
    expect(written).toBe(1);
    expect(batchOps[0].path).toBe(
      "users/bob/notifications/group_message_evt1_bob",
    );
  });

  it("returns 0 for an empty group (no members)", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: [],
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hello",
      alreadyNotifiedUids: [],
      eventId: "evt1",
    });
    expect(written).toBe(0);
    expect(batchOps).toHaveLength(0);
  });

  it("returns 0 when the only member is the author", async () => {
    const { db, batchOps } = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice"],
    });
    const written = await fanOutGroupMessage(db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hello",
      alreadyNotifiedUids: [],
      eventId: "evt1",
    });
    expect(written).toBe(0);
    expect(batchOps).toHaveLength(0);
  });

  it("at-least-once redelivery with the same eventId reuses the same doc IDs", async () => {
    // Mirrors the mention-fanout idempotency test: each redelivery writes
    // the SAME notification doc per recipient, so production Firestore
    // collapses on the deterministic id.
    const a = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol"],
    });
    await fanOutGroupMessage(a.db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hi",
      alreadyNotifiedUids: [],
      eventId: "evt-redeliver",
    });
    const b = makeDb({
      gid: "g1",
      authorUid: "alice",
      members: ["alice", "bob", "carol"],
    });
    await fanOutGroupMessage(b.db, {
      gid: "g1",
      mid: "m1",
      authorUid: "alice",
      body: "Hi",
      alreadyNotifiedUids: [],
      eventId: "evt-redeliver",
    });

    const docIds = [...a.batchOps, ...b.batchOps].map((o) => o.path);
    const unique = new Set(docIds);
    expect(unique.size).toBe(2);
    expect([...unique].sort()).toEqual([
      "users/bob/notifications/group_message_evt-redeliver_bob",
      "users/carol/notifications/group_message_evt-redeliver_carol",
    ]);
  });
});
