/**
 * T33 — Firestore security rule tests for daily_verse collection.
 *
 * Verifies:
 * 1. Signed-in user can read a daily_verse doc.
 * 2. Unauthenticated client cannot read.
 * 3. Signed-in client cannot create a daily_verse doc.
 * 4. Signed-in client cannot update a daily_verse doc.
 * 5. Signed-in client cannot delete a daily_verse doc.
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
} from "firebase/firestore";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-jacob-t33",
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

const TODAY = "2026-04-05";
const VERSE_DATA = {
  reference: "John 3:16",
  translation: "WEB",
  text: "For God so loved the world.",
  source: "bible-api.com",
};

async function seedVerse() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "daily_verse", TODAY), VERSE_DATA);
  });
}

describe("daily_verse rules", () => {
  it("signed-in user can read daily verse", async () => {
    await seedVerse();
    const alice = testEnv.authenticatedContext("alice");
    await assertSucceeds(getDoc(doc(alice.firestore(), "daily_verse", TODAY)));
  });

  it("unauthenticated client cannot read daily verse", async () => {
    await seedVerse();
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), "daily_verse", TODAY)));
  });

  it("signed-in client cannot create a daily verse doc", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(
      setDoc(doc(alice.firestore(), "daily_verse", TODAY), VERSE_DATA),
    );
  });

  it("signed-in client cannot update a daily verse doc", async () => {
    await seedVerse();
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(
      updateDoc(doc(alice.firestore(), "daily_verse", TODAY), { reference: "John 1:1" }),
    );
  });

  it("signed-in client cannot delete a daily verse doc", async () => {
    await seedVerse();
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(deleteDoc(doc(alice.firestore(), "daily_verse", TODAY)));
  });
});
