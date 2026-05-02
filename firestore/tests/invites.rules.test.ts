/**
 * T25 — Firestore security rule tests for invites subcollection.
 *
 * Covers:
 *   1. Group member can read an invite doc.
 *   2. Group leader can read an invite doc.
 *   3. Non-member cannot read invite docs.
 *   4. Unauthenticated user cannot read invite docs.
 *   5. Client cannot create an invite (write = false).
 *   6. Client cannot update an invite (write = false).
 *   7. Client cannot delete an invite (write = false).
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
    projectId: "demo-jacob-t25",
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

async function seedGroupWithInvite(opts: {
  gid: string;
  leaderUid: string;
  memberUid?: string;
  inviteId?: string;
}) {
  const inviteId = opts.inviteId ?? "inv001";
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.leaderUid,
      createdAt: Timestamp.now(),
      isPrivate: false,
      inviteCode: null,
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
    await setDoc(doc(db, "groups", opts.gid, "invites", inviteId), {
      code: "ABCD1234",
      createdBy: opts.leaderUid,
      createdAt: Timestamp.now(),
      expiresAt: null,
      maxUses: null,
      useCount: 0,
      lastUsedAt: null,
      lastUsedByUid: null,
      revokedAt: null,
      revokedBy: null,
    });
  });
}

// ── read access ───────────────────────────────────────────────────────────────

describe("invites read access", () => {
  it("group leader can read an invite doc", async () => {
    await seedGroupWithInvite({ gid: "g1", leaderUid: "alice", inviteId: "inv1" });
    await assertSucceeds(
      getDoc(doc(authed("alice"), "groups", "g1", "invites", "inv1")),
    );
  });

  it("group member can read an invite doc", async () => {
    await seedGroupWithInvite({
      gid: "g2",
      leaderUid: "alice",
      memberUid: "bob",
      inviteId: "inv2",
    });
    await assertSucceeds(
      getDoc(doc(authed("bob"), "groups", "g2", "invites", "inv2")),
    );
  });

  it("non-member cannot read an invite doc", async () => {
    await seedGroupWithInvite({ gid: "g3", leaderUid: "alice", inviteId: "inv3" });
    await assertFails(
      getDoc(doc(authed("eve"), "groups", "g3", "invites", "inv3")),
    );
  });

  it("unauthenticated user cannot read an invite doc", async () => {
    await seedGroupWithInvite({ gid: "g4", leaderUid: "alice", inviteId: "inv4" });
    await assertFails(
      getDoc(doc(unauthed(), "groups", "g4", "invites", "inv4")),
    );
  });
});

// ── write access (all denied) ─────────────────────────────────────────────────

describe("invites write access (all denied)", () => {
  it("leader cannot create an invite via client SDK", async () => {
    await seedGroupWithInvite({ gid: "g5", leaderUid: "alice" });
    await assertFails(
      addDoc(collection(authed("alice"), "groups", "g5", "invites"), {
        code: "NEWCODE1",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
        lastUsedAt: null,
        lastUsedByUid: null,
        revokedAt: null,
        revokedBy: null,
      }),
    );
  });

  it("leader cannot update an invite via client SDK", async () => {
    await seedGroupWithInvite({ gid: "g6", leaderUid: "alice", inviteId: "inv6" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g6", "invites", "inv6"), {
        revokedAt: Timestamp.now(),
      }),
    );
  });

  it("leader cannot delete an invite via client SDK", async () => {
    await seedGroupWithInvite({ gid: "g7", leaderUid: "alice", inviteId: "inv7" });
    await assertFails(
      deleteDoc(doc(authed("alice"), "groups", "g7", "invites", "inv7")),
    );
  });
});
