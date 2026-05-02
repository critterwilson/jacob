/**
 * T09 — Firestore security rule tests for threading.
 *
 * Acceptance criteria:
 *   1. clients cannot write `threadReplyCount` via update.
 *   2. clients cannot set `participants` on message create.
 *   3. clients cannot update `participants` directly.
 *   4. A member CAN create a reply (parentMessageId set, parentMessageId == existing message).
 *   5. A member cannot create a reply to a non-existent parent message.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
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
    projectId: "demo-jacob-t09",
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

async function seedGroupWithMembers(opts: {
  gid: string;
  leaderUid: string;
  memberUid?: string;
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

async function seedMessage(db: Firestore, gid: string, mid: string, authorUid: string) {
  await setDoc(doc(db, "groups", gid, "messages", mid), {
    authorUid,
    body: "parent message",
    stickerIds: ["check-in"],
    createdAt: Timestamp.now(),
    editedAt: null,
    deletedAt: null,
    parentMessageId: null,
    threadReplyCount: 0,
    mediaRefs: [],
  });
}

function replyFields(authorUid: string, parentMessageId: string) {
  return {
    authorUid,
    body: "a reply",
    stickerIds: ["check-in"],
    createdAt: serverTimestamp(),
    editedAt: null,
    deletedAt: null,
    parentMessageId,
    threadReplyCount: 0,
    mediaRefs: [],
  };
}

// ── threadReplyCount ──────────────────────────────────────────────────────────

describe("threadReplyCount protection", () => {
  it("client cannot update threadReplyCount directly", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await seedMessage(db, "g1", "m1", "alice");
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), {
        threadReplyCount: 1,
      }),
    );
  });

  it("leader cannot update threadReplyCount directly", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice" });
    await seed(async (db) => {
      await seedMessage(db, "g2", "m1", "alice");
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g2", "messages", "m1"), {
        threadReplyCount: 5,
      }),
    );
  });
});

// ── participants protection ───────────────────────────────────────────────────

describe("participants field protection", () => {
  it("client cannot set participants on message create", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", memberUid: "bob" });
    await assertFails(
      setDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
        participants: ["bob"],
      }),
    );
  });

  it("client cannot update participants directly", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await seedMessage(db, "g2", "m1", "alice");
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g2", "messages", "m1"), {
        participants: ["alice"],
      }),
    );
  });
});

// ── reply creation ────────────────────────────────────────────────────────────

describe("reply creation", () => {
  it("member can create a reply to an existing parent message", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await seedMessage(db, "g1", "parent1", "alice");
    });
    await assertSucceeds(
      setDoc(
        doc(authed("bob"), "groups", "g1", "messages", "reply1"),
        replyFields("bob", "parent1"),
      ),
    );
  });

  it("member cannot create a reply to a non-existent parent message", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await assertFails(
      setDoc(
        doc(authed("bob"), "groups", "g2", "messages", "reply1"),
        replyFields("bob", "nonexistent-parent"),
      ),
    );
  });

  it("non-member cannot read a thread reply", async () => {
    await seedGroupWithMembers({ gid: "g3", leaderUid: "alice" });
    await seed(async (db) => {
      await seedMessage(db, "g3", "parent1", "alice");
      await setDoc(doc(db, "groups", "g3", "messages", "reply1"), {
        authorUid: "alice",
        body: "a reply",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: "parent1",
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      getDoc(doc(authed("eve"), "groups", "g3", "messages", "reply1")),
    );
  });
});
