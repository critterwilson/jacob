/**
 * T24 — Firestore security rule tests for pinned messages and notifications.
 *
 * Covers:
 *   - Leader can set pinnedMessageIds with ≤ 5 entries
 *   - Leader cannot set pinnedMessageIds with 6 entries (denied)
 *   - Non-leader cannot update pinnedMessageIds
 *   - notifications/{nid} create is denied to client
 *   - Owner can read their own notification
 *   - Non-owner cannot read another user's notification
 *   - Owner can mark notification read (readAt = serverTimestamp)
 *   - Owner cannot delete notification
 *   - Leader can set announcedAt on a message (null → request.time)
 *   - Non-leader cannot set announcedAt
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
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
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
} from "vitest";

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

// ── helpers ──────────────────────────────────────────────────────────────────

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

const authed = (uid: string): Firestore =>
  testEnv.authenticatedContext(uid).firestore();

async function seedGroup(
  gid: string,
  leaderUid: string,
  opts: { pinnedMessageIds?: string[]; extraMember?: string } = {},
) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid), {
      name: "Test Group",
      description: "",
      isPrivate: false,
      createdBy: leaderUid,
      founderUid: leaderUid,
      createdAt: Timestamp.now(),
      inviteCode: "ABCD1234",
      memberCount: 1,
      stickerSet: "christian",
      schemaVersion: 1,
      avatarUrl: null,
      archivedAt: null,
      pinnedMessageIds: opts.pinnedMessageIds ?? [],
    });
    await setDoc(doc(db, "groups", gid, "members", leaderUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
      uid: leaderUid,
    });
    if (opts.extraMember) {
      await setDoc(doc(db, "groups", gid, "members", opts.extraMember), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: opts.extraMember,
      });
    }
  });
}

async function seedMessage(gid: string, mid: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid, "messages", mid), {
      authorUid: "bob",
      body: "Hello",
      stickerIds: [],
      createdAt: Timestamp.now(),
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      threadReplyCount: 0,
      mediaRefs: [],
      announcedAt: null,
      announcedBy: null,
    });
  });
}

async function seedNotification(uid: string, nid: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "users", uid, "notifications", nid), {
      kind: "announcement",
      groupId: "g1",
      messageRef: "groups/g1/messages/m1",
      fromUid: "alice",
      body: "Hello",
      createdAt: Timestamp.now(),
      readAt: null,
      deliveredAt: null,
      failedAt: null,
    });
  });
}

// ── pinnedMessageIds on group update ─────────────────────────────────────────

describe("pinnedMessageIds group update", () => {
  it("leader can set pinnedMessageIds with ≤ 5 entries", async () => {
    await seedGroup("g1", "alice");
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "g1"), {
        pinnedMessageIds: ["m1", "m2", "m3"],
      }),
    );
  });

  it("leader cannot set pinnedMessageIds with 6 entries", async () => {
    await seedGroup("g1", "alice");
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1"), {
        pinnedMessageIds: ["m1", "m2", "m3", "m4", "m5", "m6"],
      }),
    );
  });

  it("non-leader cannot update pinnedMessageIds", async () => {
    await seedGroup("g1", "alice", { extraMember: "bob" });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1"), {
        pinnedMessageIds: ["m1"],
      }),
    );
  });
});

// ── message announcedAt ───────────────────────────────────────────────────────

describe("message announcedAt announce rule", () => {
  it("leader can set announcedAt on a message (null → now)", async () => {
    await seedGroup("g1", "alice");
    await seedMessage("g1", "m1");

    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), {
        announcedAt: serverTimestamp(),
        announcedBy: "alice",
      }),
    );
  });

  it("non-leader cannot set announcedAt", async () => {
    await seedGroup("g1", "alice", { extraMember: "bob" });
    await seedMessage("g1", "m1");

    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        announcedAt: serverTimestamp(),
        announcedBy: "bob",
      }),
    );
  });

  it("leader cannot set announcedBy to a different uid", async () => {
    await seedGroup("g1", "alice");
    await seedMessage("g1", "m1");

    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), {
        announcedAt: serverTimestamp(),
        announcedBy: "someoneelse",
      }),
    );
  });
});

// ── notifications/{nid} ───────────────────────────────────────────────────────

describe("notifications/{nid}", () => {
  it("owner can read their own notification", async () => {
    await seedNotification("bob", "n1");
    await assertSucceeds(
      getDoc(doc(authed("bob"), "users", "bob", "notifications", "n1")),
    );
  });

  it("non-owner cannot read another user's notification", async () => {
    await seedNotification("bob", "n1");
    await assertFails(
      getDoc(doc(authed("alice"), "users", "bob", "notifications", "n1")),
    );
  });

  it("client cannot create a notification (create denied)", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "notifications", "n-new"), {
        kind: "announcement",
        groupId: "g1",
        messageRef: "groups/g1/messages/m1",
        fromUid: "alice",
        body: "Hello",
        createdAt: serverTimestamp(),
        readAt: null,
        deliveredAt: null,
        failedAt: null,
      }),
    );
  });

  it("owner can mark notification as read (readAt = now)", async () => {
    await seedNotification("bob", "n1");
    await assertSucceeds(
      updateDoc(doc(authed("bob"), "users", "bob", "notifications", "n1"), {
        readAt: serverTimestamp(),
      }),
    );
  });

  it("owner cannot delete a notification", async () => {
    await seedNotification("bob", "n1");
    await assertFails(
      deleteDoc(doc(authed("bob"), "users", "bob", "notifications", "n1")),
    );
  });
});
