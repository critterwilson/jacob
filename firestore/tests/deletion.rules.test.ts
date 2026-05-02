/**
 * T14 — Firestore security-rule tests for the deletion fields.
 *
 * `deletionRequestedAt` and `deletionKeepBody` are written exclusively by
 * the backend (`POST /api/account/delete`). Clients must never set them
 * directly — neither on their own user doc (would let a malicious client
 * skip the audit log + token revocation) nor on someone else's (would
 * schedule another user's account for deletion).
 */

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  Timestamp,
  updateDoc,
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
    projectId: "demo-jacob-t14",
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

async function seedUser(uid: string) {
  await seed(async (db) => {
    await setDoc(doc(db, "users", uid), {
      displayName: uid,
      schemaVersion: 1,
      createdAt: Timestamp.now(),
    });
  });
}

describe("users/{uid} deletion fields (T14)", () => {
  it("denies the owner setting deletionRequestedAt directly", async () => {
    await seedUser("alice");
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        deletionRequestedAt: Timestamp.now(),
      }),
    );
  });

  it("denies the owner setting deletionKeepBody directly", async () => {
    await seedUser("alice");
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice"), {
        deletionKeepBody: false,
      }),
    );
  });

  it("denies another user writing deletionRequestedAt on someone else's doc", async () => {
    await seedUser("alice");
    await assertFails(
      updateDoc(doc(authed("eve"), "users", "alice"), {
        deletionRequestedAt: Timestamp.now(),
      }),
    );
  });

  it("denies another user clearing deletionRequestedAt on someone else's doc", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice"), {
        displayName: "Alice",
        schemaVersion: 1,
        createdAt: Timestamp.now(),
        deletionRequestedAt: Timestamp.now(),
        deletionKeepBody: true,
      });
    });
    await assertFails(
      updateDoc(doc(authed("eve"), "users", "alice"), {
        deletionRequestedAt: null,
      }),
    );
  });
});
