/**
 * T31 — Firestore security rule tests for read-only cross-group browsing.
 *
 * Tests:
 *  1. Non-member can read public group's top-level message.
 *  2. Non-member cannot read public group's thread reply.
 *  3. Non-member cannot read private group's message.
 *  4. Non-member cannot read public group's soft-deleted message.
 *  5. Non-member cannot read public group's hidden (auto-moderated) message.
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
    projectId: "demo-jacob-t31",
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

async function seedGroup(gid: string, leaderUid: string, isPrivate: boolean) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid), {
      name: isPrivate ? "Private Group" : "Public Group",
      isPrivate,
      memberCount: 1,
      createdBy: leaderUid,
      founderUid: leaderUid,
      createdAt: Timestamp.now(),
      inviteCode: "TESTCODE",
      schemaVersion: 1,
    });
    await setDoc(doc(db, "groups", gid, "members", leaderUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
      uid: leaderUid,
    });
  });
}

async function seedMessage(
  gid: string,
  mid: string,
  overrides: Record<string, unknown> = {},
) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid, "messages", mid), {
      authorUid: "alice",
      body: "Hello world",
      stickerIds: [],
      mediaRefs: [],
      createdAt: Timestamp.now(),
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      threadReplyCount: 0,
      ...overrides,
    });
  });
}

describe("T31 — read-only cross-group browsing rules", () => {
  it("non-member can read public group's top-level message", async () => {
    await seedGroup("g1", "alice", false);
    await seedMessage("g1", "m1");
    const db = authed("bob"); // bob is not a member
    await assertSucceeds(getDoc(doc(db, "groups", "g1", "messages", "m1")));
  });

  it("non-member cannot read public group's thread reply", async () => {
    await seedGroup("g1", "alice", false);
    await seedMessage("g1", "m2", { parentMessageId: "m1" }); // thread reply
    const db = authed("bob");
    await assertFails(getDoc(doc(db, "groups", "g1", "messages", "m2")));
  });

  it("non-member cannot read private group's message", async () => {
    await seedGroup("g2", "alice", true);
    await seedMessage("g2", "m1");
    const db = authed("bob");
    await assertFails(getDoc(doc(db, "groups", "g2", "messages", "m1")));
  });

  it("non-member cannot read public group's soft-deleted message", async () => {
    await seedGroup("g1", "alice", false);
    await seedMessage("g1", "m3", { deletedAt: Timestamp.now() });
    const db = authed("bob");
    await assertFails(getDoc(doc(db, "groups", "g1", "messages", "m3")));
  });

  it("non-member cannot read public group's hidden (auto-moderated) message", async () => {
    await seedGroup("g1", "alice", false);
    await seedMessage("g1", "m4", {
      moderation: { state: "hidden", flaggedAt: Timestamp.now() },
    });
    const db = authed("bob");
    await assertFails(getDoc(doc(db, "groups", "g1", "messages", "m4")));
  });
});
