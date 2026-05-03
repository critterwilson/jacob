/**
 * T38 — Firestore security rule tests for self-serve data exports.
 *
 * The export job-doc lives at users/{uid}/exports/{jobId}. It carries a
 * signed download URL after completion — that URL is a credential, so:
 *
 *   1. Owner can read their own job docs (status UI polls them).
 *   2. Other users cannot read someone else's job doc.
 *   3. Clients cannot create export jobs (server-only via the backend).
 *   4. Clients cannot update export jobs (the URL must not be writable).
 *   5. Clients cannot delete export jobs.
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
  deleteDoc,
  serverTimestamp,
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
    projectId: "demo-jacob-t38",
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

async function seedExport(opts: {
  uid: string;
  jobId: string;
  completed?: boolean;
}) {
  await seed(async (db) => {
    await setDoc(doc(db, "users", opts.uid, "exports", opts.jobId), {
      requestedAt: serverTimestamp(),
      startedAt: opts.completed ? serverTimestamp() : null,
      completedAt: opts.completed ? serverTimestamp() : null,
      failedAt: null,
      failureReason: null,
      downloadUrl: opts.completed
        ? "https://storage.googleapis.com/jacob-exports/x/y.json.gz?signature=abc"
        : null,
      expiresAt: null,
      byteCount: opts.completed ? 1234 : null,
      schemaVersion: 1,
    });
  });
}

describe("exports — owner reads", () => {
  it("owner can read their own export job", async () => {
    await seedExport({ uid: "alice", jobId: "j1", completed: true });
    await assertSucceeds(
      getDoc(doc(authed("alice"), "users", "alice", "exports", "j1")),
    );
  });

  it("non-owner cannot read someone else's export job", async () => {
    await seedExport({ uid: "alice", jobId: "j1" });
    await assertFails(
      getDoc(doc(authed("bob"), "users", "alice", "exports", "j1")),
    );
  });

  it("unauthenticated reader cannot read an export job", async () => {
    await seedExport({ uid: "alice", jobId: "j1" });
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "users", "alice", "exports", "j1")));
  });
});

describe("exports — writes are server-only", () => {
  it("owner cannot create an export job from the client", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "users", "alice", "exports", "j1"), {
        requestedAt: serverTimestamp(),
        startedAt: null,
        completedAt: null,
        failedAt: null,
        failureReason: null,
        downloadUrl: null,
        expiresAt: null,
        byteCount: null,
        schemaVersion: 1,
      }),
    );
  });

  it("owner cannot update their export job (downloadUrl is a credential)", async () => {
    await seedExport({ uid: "alice", jobId: "j1", completed: true });
    await assertFails(
      updateDoc(doc(authed("alice"), "users", "alice", "exports", "j1"), {
        downloadUrl: "https://attacker.example.com/leak",
      }),
    );
  });

  it("owner cannot delete an export job", async () => {
    await seedExport({ uid: "alice", jobId: "j1", completed: true });
    await assertFails(
      deleteDoc(doc(authed("alice"), "users", "alice", "exports", "j1")),
    );
  });
});
