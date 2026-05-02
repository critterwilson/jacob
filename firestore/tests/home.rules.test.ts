/**
 * T11 — Firestore security rule tests for the "Recent in your groups" feed.
 *
 * Acceptance criteria:
 *   1. A member of a group CAN read messages from that group.
 *   2. A non-member CANNOT read any message from a group they have not joined.
 *   3. An unauthenticated user CANNOT read any message.
 *   4. A member of group A cannot read messages from group B they are not a member of.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
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
    projectId: "demo-jacob-t11",
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

const unauthed = (): Firestore => testEnv.unauthenticatedContext().firestore();

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

async function seedGroupWithMessage(opts: {
  gid: string;
  memberUid: string;
  messageId: string;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      createdBy: opts.memberUid,
      createdAt: Timestamp.now(),
      memberCount: 1,
      isPrivate: false,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "groups", opts.gid, "members", opts.memberUid), {
      role: "member",
      joinedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "groups", opts.gid, "messages", opts.messageId), {
      authorUid: opts.memberUid,
      body: "Hello",
      stickerIds: [],
      createdAt: Timestamp.now(),
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      threadReplyCount: 0,
      mediaRefs: [],
    });
  });
}

describe("T11 — recent-messages rule enforcement", () => {
  it("member can read a message from their group", async () => {
    await seedGroupWithMessage({ gid: "g1", memberUid: "alice", messageId: "m1" });
    await assertSucceeds(getDoc(doc(authed("alice"), "groups/g1/messages/m1")));
  });

  it("non-member cannot read a message from a group they did not join", async () => {
    await seedGroupWithMessage({ gid: "g1", memberUid: "alice", messageId: "m1" });
    // bob is not a member of g1
    await assertFails(getDoc(doc(authed("bob"), "groups/g1/messages/m1")));
  });

  it("unauthenticated user cannot read any message", async () => {
    await seedGroupWithMessage({ gid: "g1", memberUid: "alice", messageId: "m1" });
    await assertFails(getDoc(doc(unauthed(), "groups/g1/messages/m1")));
  });

  it("member of group A cannot list messages from group B", async () => {
    await seedGroupWithMessage({ gid: "groupA", memberUid: "alice", messageId: "m1" });
    await seedGroupWithMessage({ gid: "groupB", memberUid: "carol", messageId: "m2" });

    // alice is a member of groupA, not groupB
    const q = query(
      collection(authed("alice"), "groups/groupB/messages"),
      orderBy("createdAt", "desc"),
      limit(10),
    );
    await assertFails(getDocs(q));
  });

  it("member can list messages from their own group (recent activity query)", async () => {
    await seedGroupWithMessage({ gid: "groupA", memberUid: "alice", messageId: "m1" });

    const q = query(
      collection(authed("alice"), "groups/groupA/messages"),
      orderBy("createdAt", "desc"),
      limit(10),
    );
    await assertSucceeds(getDocs(q));
  });
});
