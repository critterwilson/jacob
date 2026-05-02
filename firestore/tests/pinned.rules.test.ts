/**
 * T24 — Firestore security rule tests for pinned messages and notifications.
 *
 * Covers:
 *   1. Leader can set pinnedMessageIds (≤ 5 entries).
 *   2. Leader cannot set pinnedMessageIds with 6 entries.
 *   3. Non-leader cannot update pinnedMessageIds.
 *   4. notifications/{nid} create is denied to client.
 *   5. Owner can mark notification read (readAt = serverTimestamp).
 *   6. Owner cannot delete notification.
 *   7. Non-owner cannot read others' notifications.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-jacob-t24",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

const authed = (uid: string): Firestore =>
  testEnv.authenticatedContext(uid).firestore();

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

async function seedGroupWithLeaderAndMember(opts: {
  gid: string;
  leaderUid: string;
  memberUid?: string;
  pinnedMessageIds?: string[];
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.leaderUid,
      createdAt: Timestamp.now(),
      isPrivate: false,
      inviteCode: "TESTCODE",
      memberCount: opts.memberUid ? 2 : 1,
      stickerSet: "christian",
      schemaVersion: 1,
      pinnedMessageIds: opts.pinnedMessageIds ?? [],
    });
    await setDoc(doc(db, "groups", opts.gid, "members", opts.leaderUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
    });
    if (opts.memberUid) {
      await setDoc(doc(db, "groups", opts.gid, "members", opts.memberUid), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
    }
  });
}

// ── pinnedMessageIds ──────────────────────────────────────────────────────────

describe("pinnedMessageIds", () => {
  it("leader can set pinnedMessageIds with ≤ 5 entries", async () => {
    await seedGroupWithLeaderAndMember({ gid: "p1", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "p1"), {
        pinnedMessageIds: ["m1", "m2", "m3"],
        name: "Test Group",
        description: "",
        inviteCode: "TESTCODE",
      }),
    );
  });

  it("leader cannot set pinnedMessageIds with 6 entries", async () => {
    await seedGroupWithLeaderAndMember({ gid: "p2", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "p2"), {
        pinnedMessageIds: ["m1", "m2", "m3", "m4", "m5", "m6"],
        name: "Test Group",
        description: "",
        inviteCode: "TESTCODE",
      }),
    );
  });

  it("non-leader member cannot update pinnedMessageIds", async () => {
    await seedGroupWithLeaderAndMember({
      gid: "p3",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "p3"), {
        pinnedMessageIds: ["m1"],
        name: "Test Group",
        description: "",
        inviteCode: "TESTCODE",
      }),
    );
  });

  it("leader can clear pinnedMessageIds to empty list", async () => {
    await seedGroupWithLeaderAndMember({
      gid: "p4",
      leaderUid: "alice",
      pinnedMessageIds: ["m1", "m2"],
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "p4"), {
        pinnedMessageIds: [],
        name: "Test Group",
        description: "",
        inviteCode: "TESTCODE",
      }),
    );
  });
});

// ── notifications ─────────────────────────────────────────────────────────────

describe("notifications", () => {
  async function seedNotification(opts: {
    ownerUid: string;
    nid: string;
    readAt?: unknown;
  }) {
    await seed(async (db) => {
      await setDoc(
        doc(db, "users", opts.ownerUid, "notifications", opts.nid),
        {
          kind: "announcement",
          groupId: "g1",
          messageRef: "groups/g1/messages/m1",
          fromUid: "alice",
          body: "Test announcement",
          createdAt: Timestamp.now(),
          readAt: opts.readAt ?? null,
          deliveredAt: null,
          failedAt: null,
        },
      );
    });
  }

  it("notifications/{nid} create is denied to client", async () => {
    await assertFails(
      addDoc(collection(authed("bob"), "users", "bob", "notifications"), {
        kind: "announcement",
        groupId: "g1",
        createdAt: serverTimestamp(),
        readAt: null,
      }),
    );
  });

  it("owner can read their own notification", async () => {
    await seedNotification({ ownerUid: "bob", nid: "n1" });
    await assertSucceeds(
      getDoc(doc(authed("bob"), "users", "bob", "notifications", "n1")),
    );
  });

  it("non-owner cannot read others' notifications", async () => {
    await seedNotification({ ownerUid: "bob", nid: "n2" });
    await assertFails(
      getDoc(doc(authed("eve"), "users", "bob", "notifications", "n2")),
    );
  });

  it("owner can mark notification as read (readAt = serverTimestamp)", async () => {
    await seedNotification({ ownerUid: "bob", nid: "n3" });
    await assertSucceeds(
      updateDoc(doc(authed("bob"), "users", "bob", "notifications", "n3"), {
        readAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot mark already-read notification as read again", async () => {
    await seedNotification({
      ownerUid: "bob",
      nid: "n4",
      readAt: Timestamp.now(),
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "users", "bob", "notifications", "n4"), {
        readAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot delete notification", async () => {
    await seedNotification({ ownerUid: "bob", nid: "n5" });
    await assertFails(
      deleteDoc(doc(authed("bob"), "users", "bob", "notifications", "n5")),
    );
  });

  it("owner cannot update fields other than readAt", async () => {
    await seedNotification({ ownerUid: "bob", nid: "n6" });
    await assertFails(
      updateDoc(doc(authed("bob"), "users", "bob", "notifications", "n6"), {
        body: "hacked",
      }),
    );
  });
});
