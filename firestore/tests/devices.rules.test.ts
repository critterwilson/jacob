/**
 * T34 — Firestore security rule tests for devices and notificationPrefs.
 *
 * Verifies:
 * 1. Owner can read/write their own devices.
 * 2. Non-owner cannot read or write another user's devices.
 * 3. Device write rejected with extra keys.
 * 4. Owner can read/write notificationPrefs/main.
 * 5. notificationPrefs write rejected with extra keys.
 * 6. notificationPrefs write rejected for docId != "main".
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
    projectId: "demo-jacob-t34",
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

const VALID_DEVICE = {
  fcmToken: "tok_" + "a".repeat(60),
  platform: "web",
  createdAt: new Date(),
  lastSeenAt: new Date(),
  userAgent: "Mozilla/5.0 Test",
  appVersion: null,
};

const VALID_PREFS = {
  mentions: true,
  replies: true,
  announcements: true,
  digest: true,
  schemaVersion: 1,
};

describe("devices rules", () => {
  it("owner can read own device", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/alice/devices/d1"), VALID_DEVICE);
    });
    const alice = testEnv.authenticatedContext("alice");
    await assertSucceeds(getDoc(doc(alice.firestore(), "users/alice/devices/d1")));
  });

  it("owner can write own device", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertSucceeds(
      setDoc(doc(alice.firestore(), "users/alice/devices/d1"), VALID_DEVICE),
    );
  });

  it("non-owner cannot read others' devices", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/alice/devices/d1"), VALID_DEVICE);
    });
    const bob = testEnv.authenticatedContext("bob");
    await assertFails(getDoc(doc(bob.firestore(), "users/alice/devices/d1")));
  });

  it("non-owner cannot write others' devices", async () => {
    const bob = testEnv.authenticatedContext("bob");
    await assertFails(
      setDoc(doc(bob.firestore(), "users/alice/devices/d1"), VALID_DEVICE),
    );
  });

  it("device write rejected with extra keys", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(
      setDoc(doc(alice.firestore(), "users/alice/devices/d1"), {
        ...VALID_DEVICE,
        maliciousField: "bad",
      }),
    );
  });
});

describe("notificationPrefs rules", () => {
  it("owner can read own prefs", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/alice/notificationPrefs/main"), VALID_PREFS);
    });
    const alice = testEnv.authenticatedContext("alice");
    await assertSucceeds(
      getDoc(doc(alice.firestore(), "users/alice/notificationPrefs/main")),
    );
  });

  it("owner can write prefs with docId=main", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertSucceeds(
      setDoc(doc(alice.firestore(), "users/alice/notificationPrefs/main"), VALID_PREFS),
    );
  });

  it("notificationPrefs write rejected with extra keys", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(
      setDoc(doc(alice.firestore(), "users/alice/notificationPrefs/main"), {
        ...VALID_PREFS,
        extraField: "bad",
      }),
    );
  });

  it("notificationPrefs write rejected for docId != main", async () => {
    const alice = testEnv.authenticatedContext("alice");
    await assertFails(
      setDoc(doc(alice.firestore(), "users/alice/notificationPrefs/other"), VALID_PREFS),
    );
  });

  it("non-owner cannot read others' prefs", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "users/alice/notificationPrefs/main"),
        VALID_PREFS,
      );
    });
    const bob = testEnv.authenticatedContext("bob");
    await assertFails(
      getDoc(doc(bob.firestore(), "users/alice/notificationPrefs/main")),
    );
  });
});
