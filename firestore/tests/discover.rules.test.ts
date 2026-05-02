/**
 * T30 — Firestore security rule tests for group discovery and join requests.
 *
 * Tests:
 *  1. Signed-in user can read public group doc.
 *  2. Signed-in user cannot read private group doc (without membership).
 *  3. Owner can read their own join-request.
 *  4. Non-owner cannot read another user's join-request.
 *  5. Leader can read all join-requests in their group.
 *  6. Leader can flip pending → approved.
 *  7. Leader cannot flip an already-resolved request.
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
    projectId: "demo-jacob-t30",
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

async function seedPublicGroup(gid: string, leaderUid: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid), {
      name: "Public Group",
      isPrivate: false,
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

async function seedPrivateGroup(gid: string, leaderUid: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid), {
      name: "Private Group",
      isPrivate: true,
      memberCount: 1,
      createdBy: leaderUid,
      founderUid: leaderUid,
      createdAt: Timestamp.now(),
      inviteCode: "PRIVCODE",
      schemaVersion: 1,
    });
    await setDoc(doc(db, "groups", gid, "members", leaderUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
      uid: leaderUid,
    });
  });
}

async function seedJoinRequest(gid: string, uid: string, status = "pending") {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid, "joinRequests", uid), {
      message: "Let me in",
      requestedAt: Timestamp.now(),
      status,
    });
  });
}

describe("T30 — group discovery rules", () => {
  it("signed-in user can read public group doc", async () => {
    await seedPublicGroup("g1", "alice");
    const db = authed("bob"); // bob is not a member
    await assertSucceeds(getDoc(doc(db, "groups", "g1")));
  });

  it("signed-in user cannot read private group doc without membership", async () => {
    await seedPrivateGroup("g2", "alice");
    const db = authed("bob");
    await assertFails(getDoc(doc(db, "groups", "g2")));
  });
});

describe("T30 — join request rules", () => {
  it("owner can read their own join-request", async () => {
    await seedPublicGroup("g1", "alice");
    await seedJoinRequest("g1", "bob");
    const db = authed("bob");
    await assertSucceeds(getDoc(doc(db, "groups", "g1", "joinRequests", "bob")));
  });

  it("non-owner cannot read another user's join-request", async () => {
    await seedPublicGroup("g1", "alice");
    await seedJoinRequest("g1", "bob");
    const db = authed("charlie"); // neither owner nor leader
    await assertFails(getDoc(doc(db, "groups", "g1", "joinRequests", "bob")));
  });

  it("leader can read all join-requests in their group", async () => {
    await seedPublicGroup("g1", "alice");
    await seedJoinRequest("g1", "bob");
    const db = authed("alice"); // alice is leader
    await assertSucceeds(getDoc(doc(db, "groups", "g1", "joinRequests", "bob")));
  });

  it("leader can flip status from pending to approved", async () => {
    await seedPublicGroup("g1", "alice");
    await seedJoinRequest("g1", "bob", "pending");
    const db = authed("alice");
    await assertSucceeds(
      updateDoc(doc(db, "groups", "g1", "joinRequests", "bob"), {
        status: "approved",
        reviewedAt: Timestamp.now(),
        reviewedBy: "alice",
      }),
    );
  });

  it("leader cannot flip status of already-resolved request", async () => {
    await seedPublicGroup("g1", "alice");
    await seedJoinRequest("g1", "bob", "approved"); // already resolved
    const db = authed("alice");
    await assertFails(
      updateDoc(doc(db, "groups", "g1", "joinRequests", "bob"), {
        status: "rejected",
        reviewedAt: Timestamp.now(),
        reviewedBy: "alice",
      }),
    );
  });
});
