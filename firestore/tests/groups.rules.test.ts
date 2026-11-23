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

// ── T23: settings (avatar, archival) ──────────────────────────────────────────

describe("T23 — group settings", () => {
  it("leader can set avatarUrl", async () => {
    await seedGroup({ gid: "ts1", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "ts1"), {
        avatarUrl: "https://storage.googleapis.com/jacob-public/groups/ts1.jpg",
      }),
    );
  });

  it("leader can clear avatarUrl back to null", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "ts2"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE10",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        avatarUrl: "https://storage.googleapis.com/x/y.jpg",
      });
      await setDoc(doc(db, "groups", "ts2", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "ts2"), { avatarUrl: null }),
    );
  });

  it("non-leader cannot set avatarUrl", async () => {
    await seedGroup({
      gid: "ts3",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "ts3"), {
        avatarUrl: "https://storage.googleapis.com/x/y.jpg",
      }),
    );
  });

  it("leader can update description up to 1000 chars", async () => {
    await seedGroup({ gid: "ts4", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "ts4"), {
        description: "x".repeat(1000),
      }),
    );
  });

  it("rejects description over 1000 chars", async () => {
    await seedGroup({ gid: "ts5", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "ts5"), {
        description: "x".repeat(1001),
      }),
    );
  });

  it("rejects name over 80 chars on edit", async () => {
    await seedGroup({ gid: "ts6", createdBy: "alice", leaderUid: "alice" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "ts6"), {
        name: "x".repeat(81),
      }),
    );
  });

  it("leader can archive (null → serverTimestamp)", async () => {
    await seedGroup({ gid: "ts7", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "ts7"), {
        archivedAt: serverTimestamp(),
      }),
    );
  });

  it("rejects archive when already archived", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "ts8"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE11",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", "ts8", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "ts8"), {
        archivedAt: serverTimestamp(),
      }),
    );
  });

  it("leader can unarchive (timestamp → null)", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "ts9"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE12",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", "ts9", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("alice"), "groups", "ts9"), { archivedAt: null }),
    );
  });

  it("non-leader cannot archive", async () => {
    await seedGroup({
      gid: "ts10",
      createdBy: "alice",
      leaderUid: "alice",
      memberUid: "bob",
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "ts10"), {
        archivedAt: serverTimestamp(),
      }),
    );
  });

  it("rejects message create when group is archived", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "ts11"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE13",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", "ts11", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });
    await assertFails(
      addDoc(collection(authed("alice"), "groups", "ts11", "messages"), {
        authorUid: "alice",
        body: "hello",
        stickerIds: ["amen"],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("allows message create on a non-archived group", async () => {
    await seedGroup({ gid: "ts12", createdBy: "alice", leaderUid: "alice" });
    await assertSucceeds(
      addDoc(collection(authed("alice"), "groups", "ts12", "messages"), {
        authorUid: "alice",
        body: "hello",
        stickerIds: ["amen"],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    );
  });

  it("messages on archived groups remain readable", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "ts13"), {
        name: "g",
        description: "",
        createdBy: "alice",
        founderUid: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        inviteCode: "INVITE14",
        memberCount: 1,
        stickerSet: "christian",
        schemaVersion: 1,
        archivedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "groups", "ts13", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "ts13", "messages", "m1"), {
        authorUid: "alice",
        body: "before archive",
        stickerIds: ["amen"],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(
      getDoc(doc(authed("alice"), "groups", "ts13", "messages", "m1")),
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
