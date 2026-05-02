/**
 * T10 — Firestore security-rule tests for the `uploads/` collection.
 *
 * The pipeline state lives at `uploads/{uploadId}` and is owned by the
 * backend Admin SDK. Clients never need to read or write it — they get
 * the public URL back as the response body of `/api/uploads/{id}/finalize`.
 * This test pins both directions explicitly so a future rules edit can't
 * silently expose the queue or let a client tamper with status.
 */

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
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
    projectId: "demo-jacob-t10",
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

async function seedUpload(uploadId: string, uploaderUid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "uploads", uploadId), {
      uploadId,
      uploaderUid,
      purpose: "message",
      groupId: "g1",
      mimeType: "image/jpeg",
      byteCount: 12345,
      objectName: `uploads/${uploaderUid}/${uploadId}.jpg`,
      status: "pending",
      createdAt: Timestamp.now(),
    });
  });
}

describe("uploads/ collection (backend-only)", () => {
  it("denies the uploader from reading their own pipeline state", async () => {
    await seedUpload("u1", "alice");
    await assertFails(getDoc(doc(authed("alice"), "uploads", "u1")));
  });

  it("denies a different signed-in user from reading", async () => {
    await seedUpload("u2", "alice");
    await assertFails(getDoc(doc(authed("eve"), "uploads", "u2")));
  });

  it("denies any client write (create)", async () => {
    await assertFails(
      setDoc(doc(authed("alice"), "uploads", "u3"), {
        uploadId: "u3",
        uploaderUid: "alice",
        status: "approved",
      }),
    );
  });

  it("denies the uploader from tampering with status", async () => {
    await seedUpload("u4", "alice");
    await assertFails(
      setDoc(
        doc(authed("alice"), "uploads", "u4"),
        { status: "approved" },
        { merge: true },
      ),
    );
  });
});
