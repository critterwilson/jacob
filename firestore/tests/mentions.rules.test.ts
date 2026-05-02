/**
 * T27 — Firestore security rule tests for the mentions field on messages.
 *
 * Covers:
 *   1. Create message without mentions (backward compat).
 *   2. Create message with valid mentions array (≤10 entries).
 *   3. Create message with mentions array > 10 is rejected.
 *   4. Client cannot update mentions field after creation.
 *   5. Member can read a message that has mentions.
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
    projectId: "demo-jacob-t27",
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

async function seedGroup(gid: string, authorUid: string, memberUid?: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "groups", gid), {
      name: "G",
      createdBy: authorUid,
      createdAt: Timestamp.now(),
      isPrivate: false,
      inviteCode: "abc123",
      memberCount: 1,
      stickerSet: "christian",
      schemaVersion: 1,
      archivedAt: null,
    });
    await setDoc(doc(db, "groups", gid, "members", authorUid), {
      role: "leader",
      joinedAt: Timestamp.now(),
    });
    if (memberUid) {
      await setDoc(doc(db, "groups", gid, "members", memberUid), {
        role: "member",
        joinedAt: Timestamp.now(),
      });
    }
  });
}

const baseMsg = {
  authorUid: "alice",
  body: "Hello",
  stickerIds: [],
  createdAt: serverTimestamp(),
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  threadReplyCount: 0,
  mediaRefs: [],
};

// ── create ────────────────────────────────────────────────────────────────────

describe("mentions create", () => {
  it("member can create message without mentions (backward compat)", async () => {
    await seedGroup("g1", "alice");
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1", "messages", "m1"), baseMsg),
    );
  });

  it("member can create message with valid mentions array (≤10)", async () => {
    await seedGroup("g1a", "alice", "bob");
    await assertSucceeds(
      setDoc(doc(authed("alice"), "groups", "g1a", "messages", "m2"), {
        ...baseMsg,
        authorUid: "alice",
        mentions: ["bob"],
      }),
    );
  });

  it("mentions array > 10 entries is rejected", async () => {
    await seedGroup("g2", "alice");
    const tooMany = Array.from({ length: 11 }, (_, i) => `uid${i}`);
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g2", "messages", "m3"), {
        ...baseMsg,
        mentions: tooMany,
      }),
    );
  });

  it("mentions must be a list — string value rejected", async () => {
    await seedGroup("g3", "alice");
    await assertFails(
      setDoc(doc(authed("alice"), "groups", "g3", "messages", "m4"), {
        ...baseMsg,
        mentions: "bob",
      }),
    );
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe("mentions update", () => {
  it("client cannot update mentions field after creation", async () => {
    await seedGroup("g4", "alice", "bob");
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g4", "messages", "m5"), {
        ...baseMsg,
        createdAt: Timestamp.now(),
        mentions: ["bob"],
      });
    });
    await assertFails(
      updateDoc(doc(authed("alice"), "groups", "g4", "messages", "m5"), {
        mentions: ["bob", "carol"],
      }),
    );
  });
});

// ── read ──────────────────────────────────────────────────────────────────────

describe("mentions read", () => {
  it("member can read a message that has mentions", async () => {
    await seedGroup("g5", "alice", "bob");
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g5", "messages", "m6"), {
        ...baseMsg,
        createdAt: Timestamp.now(),
        mentions: ["bob"],
      });
    });
    await assertSucceeds(
      getDoc(doc(authed("bob"), "groups", "g5", "messages", "m6")),
    );
  });
});
