/**
 * T26 — Firestore security rule tests for reaction subcollection.
 *
 * Covers:
 *   1. Member can react (create own user doc).
 *   2. Non-member cannot react.
 *   3. Archived group: reaction rejected.
 *   4. Deleted message: reaction rejected.
 *   5. Unknown sticker slug: reaction rejected.
 *   6. Cannot write to another user's reaction doc.
 *   7. Client cannot write reactionCounts directly on the parent message.
 *   8. Member can read reactions list.
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
  getDocs,
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
    projectId: "demo-jacob-t26",
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

async function seedBase(opts: {
  gid: string;
  mid: string;
  leaderUid: string;
  memberUid?: string;
  archived?: boolean;
  messageDeleted?: boolean;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", opts.gid), {
      name: "G",
      createdBy: opts.leaderUid,
      createdAt: Timestamp.now(),
      isPrivate: false,
      inviteCode: null,
      memberCount: 1,
      stickerSet: "christian",
      schemaVersion: 1,
      archivedAt: opts.archived ? Timestamp.now() : null,
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
    await setDoc(doc(db, "groups", opts.gid, "messages", opts.mid), {
      authorUid: opts.leaderUid,
      body: "Hello",
      stickerIds: [],
      createdAt: Timestamp.now(),
      editedAt: null,
      deletedAt: opts.messageDeleted ? Timestamp.now() : null,
      parentMessageId: null,
      threadReplyCount: 0,
      mediaRefs: [],
    });
    await setDoc(doc(db, "stickers", "pray"), {
      slug: "pray",
      name: "Praying Hands",
      audience: "christian",
      order: 1,
      color: "#7c3aed",
    });
  });
}

function reactionRef(db: Firestore, gid: string, mid: string, slug: string, uid: string) {
  return doc(db, "groups", gid, "messages", mid, "reactions", slug, "users", uid);
}

// ── create ────────────────────────────────────────────────────────────────────

describe("reactions create", () => {
  it("member can react", async () => {
    await seedBase({ gid: "g1", mid: "m1", leaderUid: "alice", memberUid: "bob" });
    await assertSucceeds(
      setDoc(reactionRef(authed("bob"), "g1", "m1", "pray", "bob"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });

  it("non-member cannot react", async () => {
    await seedBase({ gid: "g2", mid: "m2", leaderUid: "alice" });
    await assertFails(
      setDoc(reactionRef(authed("eve"), "g2", "m2", "pray", "eve"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });

  it("archived group: reaction rejected", async () => {
    await seedBase({ gid: "g3", mid: "m3", leaderUid: "alice", memberUid: "bob", archived: true });
    await assertFails(
      setDoc(reactionRef(authed("bob"), "g3", "m3", "pray", "bob"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });

  it("deleted message: reaction rejected", async () => {
    await seedBase({
      gid: "g4",
      mid: "m4",
      leaderUid: "alice",
      memberUid: "bob",
      messageDeleted: true,
    });
    await assertFails(
      setDoc(reactionRef(authed("bob"), "g4", "m4", "pray", "bob"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });

  it("unknown sticker slug: reaction rejected", async () => {
    await seedBase({ gid: "g5", mid: "m5", leaderUid: "alice", memberUid: "bob" });
    await assertFails(
      setDoc(reactionRef(authed("bob"), "g5", "m5", "unknown-slug", "bob"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });

  it("cannot write to another user's reaction doc", async () => {
    await seedBase({ gid: "g6", mid: "m6", leaderUid: "alice", memberUid: "bob" });
    await assertFails(
      setDoc(reactionRef(authed("bob"), "g6", "m6", "pray", "alice"), {
        reactedAt: serverTimestamp(),
      }),
    );
  });
});

// ── client cannot write reactionCounts ───────────────────────────────────────

describe("reactionCounts is system-only", () => {
  it("client cannot write reactionCounts directly on the parent message", async () => {
    await seedBase({ gid: "g7", mid: "m7", leaderUid: "alice", memberUid: "bob" });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g7", "messages", "m7"), {
        reactionCounts: { pray: 1 },
      }),
    );
  });
});

// ── read ──────────────────────────────────────────────────────────────────────

describe("reactions read", () => {
  it("member can read reactions", async () => {
    await seedBase({ gid: "g8", mid: "m8", leaderUid: "alice", memberUid: "bob" });
    await seed(async (db) => {
      await setDoc(
        doc(db, "groups", "g8", "messages", "m8", "reactions", "pray", "users", "alice"),
        { reactedAt: Timestamp.now() },
      );
    });
    await assertSucceeds(
      getDocs(
        collection(authed("bob"), "groups", "g8", "messages", "m8", "reactions", "pray", "users"),
      ),
    );
  });
});
