/**
 * T07 — Firestore security rule tests for group creation, join, and invite rotation.
 *
 * Focuses on the scenarios introduced by T07:
 *   1. Non-member cannot read a group.
 *   2. After being added as a member (simulating the backend join write), user can read.
 *   3. Non-leader member cannot update inviteCode on the group doc.
 *   4. Leader can update inviteCode.
 *
 * The general group / member rule coverage lives in rules.test.ts; these tests
 * are scoped to T07 acceptance criteria only.
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
    projectId: "demo-jacob-t07",
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

async function seedGroup(opts: {
  gid: string;
  createdBy: string;
  leaderUid: string;
  memberUid?: string;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.createdBy,
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

// ── non-member access ─────────────────────────────────────────────────────────

describe("group read access", () => {
  it("denies non-member reading group doc", async () => {
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice" });
    await assertFails(getDoc(doc(authed("eve"), "groups", "g1")));
  });

  it("allows member to read group doc after being added", async () => {
    // Simulates what the backend join endpoint writes (rules disabled = Admin SDK)
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g2"), {
        name: "Test",
        description: "",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "ABCD1234",
        memberCount: 2,
        stickerSet: "christian",
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g2", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
      });
      // Bob is now a member (written by backend join)
      await setDoc(doc(db, "groups", "g2", "members", "bob"), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(getDoc(doc(authed("bob"), "groups", "g2")));
  });
});

// ── invite code update ────────────────────────────────────────────────────────

describe("inviteCode updates", () => {
  it("allows leader to update inviteCode (client-side rotate)", async () => {
    await seedGroup({ gid: "g3", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "g3"), {
        inviteCode: "NEWCODE1",
      }),
    );
  });

  it("denies non-leader member from updating inviteCode", async () => {
    await seedGroup({
      gid: "g4",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g4"), {
        inviteCode: "HACKED12",
      }),
    );
  });

  it("denies non-member from updating inviteCode", async () => {
    await seedGroup({ gid: "g5", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("eve"), "groups", "g5"), {
        inviteCode: "HACKED12",
      }),
    );
  });
});

// ── member self-join (bootstrap path) ─────────────────────────────────────────

describe("member bootstrap path", () => {
  it("creator self-adds as leader after group is created", async () => {
    // Group doc seeded with no members (as if backend just wrote it without
    // the member doc — testing the bootstrap rule path).
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g6"), {
        name: "New Group",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "BOOTSTRAP",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
      });
    });
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g6", "members", "alice"), {
        role: "leader",
        joinedAt: new Date(),  // serverTimestamp() equivalent in tests
      }),
    );
  });

  it("denies a different user from bootstrap-adding themselves as leader", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g7"), {
        name: "g",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
    });
    await assertFails(
      setDoc(doc(authed("eve"), "groups", "g7", "members", "eve"), {
        role: "leader",
        joinedAt: new Date(),
      }),
    );
  });
});
