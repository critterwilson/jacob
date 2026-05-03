/**
 * T08 — Firestore security rule tests for top-level chat messages.
 *
 * Covers T08 acceptance criteria:
 *   1. Non-member cannot read messages.
 *   2. Non-member cannot create messages.
 *   3. Member can create a message.
 *   4. Author can soft-edit body within 15 minutes.
 *   5. Author cannot edit after 15 minutes (createdAt seeded in the past).
 *   6. Author can soft-delete at any time.
 *   7. Leader can soft-delete another member's message.
 *   8. Non-author non-leader cannot soft-delete.
 *   9. No client can hard-delete a message.
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
    projectId: "demo-jacob-t08",
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
  isPrivate?: boolean;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "Test Group",
      description: "",
      createdBy: opts.leaderUid,
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

function freshMessageFields(authorUid: string) {
  return {
    authorUid,
    body: "hello world",
    stickerIds: ["check-in"],
    createdAt: serverTimestamp(),
    editedAt: null,
    deletedAt: null,
    parentMessageId: null,
    threadReplyCount: 0,
    mediaRefs: [],
  };
}

// ── read access ───────────────────────────────────────────────────────────────

describe("message read access", () => {
  it("non-member cannot read messages", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", isPrivate: true });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "alice",
        body: "private",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(getDoc(doc(authed("eve"), "groups", "g1", "messages", "m1")));
  });

  it("member can read messages", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g2", "messages", "m1"), {
        authorUid: "alice",
        body: "hi",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(getDoc(doc(authed("bob"), "groups", "g2", "messages", "m1")));
  });
});

// ── create access ─────────────────────────────────────────────────────────────

describe("message create access", () => {
  it("non-member cannot create a message", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice" });
    await assertFails(
      setDoc(
        doc(authed("eve"), "groups", "g1", "messages", "m1"),
        freshMessageFields("eve"),
      ),
    );
  });

  it("member can create a top-level message", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await assertSucceeds(
      setDoc(
        doc(authed("bob"), "groups", "g2", "messages", "m1"),
        freshMessageFields("bob"),
      ),
    );
  });
});

// ── soft-edit (author within 15 min) ─────────────────────────────────────────

describe("message soft-edit", () => {
  it("author can edit body within 15 minutes", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "original",
        stickerIds: ["check-in"],
        createdAt: Timestamp.now(), // just created — within 15-min window
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertSucceeds(
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        body: "edited",
        editedAt: serverTimestamp(),
      }),
    );
  });

  it("author cannot edit body after 15 minutes", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g2", "messages", "m1"), {
        authorUid: "bob",
        body: "original",
        stickerIds: ["check-in"],
        // 16 minutes in the past — outside the edit window
        createdAt: Timestamp.fromMillis(Date.now() - 16 * 60 * 1000),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g2", "messages", "m1"), {
        body: "too late",
        editedAt: serverTimestamp(),
      }),
    );
  });

  it("non-author cannot edit another member's message", async () => {
    await seedGroupWithMembers({ gid: "g3", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g3", "messages", "m1"), {
        authorUid: "bob",
        body: "original",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g3", "messages", "m1"), {
        body: "tampered",
        editedAt: serverTimestamp(),
      }),
    );
  });
});

// ── soft-delete ──────────────────────────────────��────────────────────────────

describe("message soft-delete", () => {
  it("author can soft-delete their own message", async () => {
    await seedGroupWithMembers({ gid: "g1", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1", "messages", "m1"), {
        authorUid: "bob",
        body: "to be deleted",
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
      updateDoc(doc(authed("bob"), "groups", "g1", "messages", "m1"), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("group leader can soft-delete another member's message", async () => {
    await seedGroupWithMembers({ gid: "g2", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g2", "messages", "m1"), {
        authorUid: "bob",
        body: "flagged content",
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
      updateDoc(doc(authed("alice"), "groups", "g2", "messages", "m1"), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("non-author non-leader cannot soft-delete", async () => {
    await seedGroupWithMembers({
      gid: "g3",
      leaderUid: "alice",
      memberUid: "bob",
    });
    // eve is not a member at all
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g3", "messages", "m1"), {
        authorUid: "alice",
        body: "alice's message",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(
      updateDoc(doc(authed("bob"), "groups", "g3", "messages", "m1"), {
        deletedAt: serverTimestamp(),
      }),
    );
  });

  it("no client can hard-delete a message", async () => {
    await seedGroupWithMembers({ gid: "g4", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g4", "messages", "m1"), {
        authorUid: "bob",
        body: "x",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });
    await assertFails(deleteDoc(doc(authed("bob"), "groups", "g4", "messages", "m1")));
    await assertFails(deleteDoc(doc(authed("alice"), "groups", "g4", "messages", "m1")));
  });
});
