/**
 * M9 — Frontend integration tests against the Firestore emulator.
 *
 * These complement the rules tests in `firestore/tests/` by exercising
 * the SAME client SDK paths that the production app uses, against a
 * live emulator. Per-test isolation: each test uses a fresh authed
 * context and `clearFirestore` between tests.
 *
 * Run via:
 *   firebase emulators:exec --only auth,firestore --project demo-jacob \
 *     "pnpm --filter jacob-frontend test --run tests/integration"
 *
 * The default `pnpm test` does NOT pick these up (the suffix is
 * `.emulator.test.ts` and the standard `pnpm test` config below filters
 * them out). CI runs them in a dedicated emulator-test job.
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-jacob-frontend",
    firestore: {
      rules: readFileSync(
        resolve(__dirname, "../../../firestore/firestore.rules"),
        "utf8",
      ),
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

// rules-unit-testing returns a different Firestore symbol than the modular
// firebase SDK at the type level (it's the same wire protocol). Cast at the
// boundary so the test bodies use the modular SDK types our app uses.
const authed = (uid: string): Firestore =>
  testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

describe("M9 — message read/write via the client SDK", () => {
  it("a member can write and read a message in their group", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g1"), {
        name: "g1",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g1", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });

    const aliceDb = authed("alice");
    await setDoc(doc(aliceDb, "groups", "g1", "messages", "m1"), {
      authorUid: "alice",
      body: "hello",
      stickerIds: [],
      createdAt: serverTimestamp(),
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      threadReplyCount: 0,
      mediaRefs: [],
    });

    const snap = await getDoc(doc(aliceDb, "groups", "g1", "messages", "m1"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.body).toBe("hello");
  });

  it("a non-member cannot read messages from a private group via the client", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g2"), {
        name: "g2",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: true,
        memberCount: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g2", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
      await setDoc(doc(db, "groups", "g2", "messages", "m1"), {
        authorUid: "alice",
        body: "secret",
        stickerIds: [],
        createdAt: Timestamp.now(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
    });

    const eveDb = authed("eve");
    await expect(
      getDoc(doc(eveDb, "groups", "g2", "messages", "m1")),
    ).rejects.toThrow();
  });

  it("a non-member cannot write a message into someone else's group", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "groups", "g3"), {
        name: "g3",
        createdBy: "alice",
        createdAt: Timestamp.now(),
        isPrivate: false,
        memberCount: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(db, "groups", "g3", "members", "alice"), {
        role: "leader",
        joinedAt: Timestamp.now(),
        uid: "alice",
      });
    });

    const eveDb = authed("eve");
    await expect(
      setDoc(doc(eveDb, "groups", "g3", "messages", "m-evil"), {
        authorUid: "eve",
        body: "intruder",
        stickerIds: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      }),
    ).rejects.toThrow();
  });
});

// Suppress unused import for collection (kept for future expansion).
void collection;
