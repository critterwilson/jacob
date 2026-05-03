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
  isPrivate?: boolean;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.createdBy,
      createdAt: Timestamp.now(),
      isPrivate: opts.isPrivate ?? false,
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
    await seedGroup({ gid: "g1", createdBy: "alice", leaderUid: "alice", isPrivate: true });
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
        // Bootstrap rule pins joinedAt to request.time, so the client must
        // use serverTimestamp() here (not new Date()).
        joinedAt: serverTimestamp(),
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
        joinedAt: serverTimestamp(),
      }),
    );
  });
});

// ── T23: archive / archival message-write denial ─────────────────────────────

describe("T23 archival rules", () => {
  async function seedGroupWithArchive(opts: {
    gid: string;
    leaderUid: string;
    archivedAt?: unknown;
  }) {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", opts.gid), {
        name: "Test Group",
        description: "",
        createdBy: opts.leaderUid,
        founderUid: opts.leaderUid,
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "TESTCODE",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: opts.archivedAt ?? null,
        archivedBy: opts.archivedAt ? opts.leaderUid : null,
      });
      await setDoc(doc(db, "groups", opts.gid, "members", opts.leaderUid), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: opts.leaderUid,
      });
    });
  }

  it("missing archivedAt field treated as null (messages allowed)", async () => {
    // Group seeded WITHOUT archivedAt field — simulates pre-T23 groups.
    // absent archivedAt must be treated as null so members can still write.
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "a0"), {
        name: "Legacy Group",
        description: "",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "LEGACYCO",
        memberCount: 2,
        stickerSet: "christian",
        schemaVersion: 1,
        // intentionally omit archivedAt
      });
      await setDoc(doc(db, "groups", "a0", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "a0", "members", "bob"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "bob",
      });
    });
    await assertSucceeds(
      addDoc(collection(authed("bob"), "groups", "a0", "messages"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("leader can archive (set archivedAt to serverTimestamp)", async () => {
    await seedGroupWithArchive({ gid: "a1", leaderUid: "alice", archivedAt: null });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "a1"), {
        archivedAt: serverTimestamp(),
        archivedBy: "alice",
        archiveReason: "",
      }),
    );
  });

  it("non-leader cannot archive", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "a2"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "TESTCO01",
        memberCount: 2,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: null,
        archivedBy: null,
      });
      await setDoc(doc(db, "groups", "a2", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "a2", "members", "bob"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "bob",
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "a2"), {
        archivedAt: serverTimestamp(),
        archivedBy: "bob",
        archiveReason: "",
      }),
    );
  });

  it("archived group: client message write denied", async () => {
    await seedGroupWithArchive({
      gid: "a3",
      leaderUid: "alice",
      archivedAt: Timestamp.now(),
    });
    // Add a member to test message denial
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "a3", "members", "bob"), {
        role: "member",
        joinedAt: Timestamp.now(),
        uid: "bob",
      });
    });
    await assertFails(
      addDoc(collection(authed("bob"), "groups", "a3", "messages"), {
        authorUid: "bob",
        body: "hello",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("archived group: messages still readable", async () => {
    await seedGroupWithArchive({
      gid: "a4",
      leaderUid: "alice",
      archivedAt: Timestamp.now(),
    });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "a4", "messages", "m1"), {
        authorUid: "alice",
        body: "old message",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(
      getDoc(doc(authed("alice"), "groups", "a4", "messages", "m1")),
    );
  });

  it("archived group: name edit still allowed for leader", async () => {
    await seedGroupWithArchive({
      gid: "a5",
      leaderUid: "alice",
      archivedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "a5"), { name: "New Name", description: "", inviteCode: "TESTCODE" }),
    );
  });

  it("unarchive: rule allows clearing archivedAt", async () => {
    await seedGroupWithArchive({
      gid: "a6",
      leaderUid: "alice",
      archivedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "a6"), {
        archivedAt: null,
        archivedBy: null,
      }),
    );
  });

  it("cannot set backdated archivedAt", async () => {
    await seedGroupWithArchive({ gid: "a7", leaderUid: "alice", archivedAt: null });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "a7"), {
        archivedAt: Timestamp.fromDate(new Date("2020-01-01")),
        archivedBy: "alice",
        archiveReason: "",
      }),
    );
  });
});

// ── M2: banned user can still leave a group ───────────────────────────────────

describe("banned user group leave (M2)", () => {
  async function seedGroupWithBannedMember(opts: {
    gid: string;
    leaderUid: string;
    bannedUid: string;
  }) {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", opts.gid), {
        name: "Test Group",
        createdBy: opts.leaderUid,
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE01",
        memberCount: 2,
        stickerSet: "christian",
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", opts.gid, "members", opts.leaderUid), {
        role: "leader",
        joinedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", opts.gid, "members", opts.bannedUid), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
      // Active ban: far-future expiry
      await setDoc(doc(db, "bans", opts.bannedUid), {
        reason: "test",
        bannedBy: opts.leaderUid,
        expiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
      });
    });
  }

  it("allows a banned user to delete their own member doc (leave the group)", async () => {
    await seedGroupWithBannedMember({
      gid: "gb1",
      leaderUid: "alice",
      bannedUid: "banned-bob",
    });
    await assertSucceeds(
      deleteDoc(doc(authed("banned-bob"), "groups", "gb1", "members", "banned-bob")),
    );
  });

  it("denies a banned leader from removing another member", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "gb2"), {
        name: "g",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE02",
        memberCount: 2,
        stickerSet: "christian",
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "gb2", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", "gb2", "members", "bob"), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
      // Alice is banned
      await setDoc(doc(db, "bans", "alice"), {
        reason: "test",
        bannedBy: "system",
        expiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
      });
    });
    // Banned leader cannot kick another member (leader path requires !banned)
    await assertFails(
      deleteDoc(doc(authed("alice"), "groups", "gb2", "members", "bob")),
    );
  });
});
