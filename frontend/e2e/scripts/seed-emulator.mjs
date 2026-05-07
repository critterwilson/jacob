#!/usr/bin/env node
/**
 * Pre-seed the shared Playwright test user into the running Firebase Auth
 * emulator. Idempotent: re-creates the user if it already exists.
 *
 * The user is created with the **same UID** as on staging Firebase Auth so
 * the staging backend's `users/{uid}` Firestore lookup hits the existing
 * profile when called with the emulator-issued ID token. UID is read from
 * `JACOB_E2E_USER_UID` (populated by `fetch-staging-uid.mjs` earlier in CI).
 *
 * Required env:
 *   - FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
 *   - JACOB_E2E_USER_EMAIL
 *   - JACOB_E2E_USER_PASSWORD
 *   - JACOB_E2E_USER_UID
 *   - JACOB_E2E_FIREBASE_PROJECT_ID (e.g. "jacob-staging-494515")
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("seed-emulator: FIREBASE_AUTH_EMULATOR_HOST is required.");
  process.exit(2);
}

const email = process.env.JACOB_E2E_USER_EMAIL;
const password = process.env.JACOB_E2E_USER_PASSWORD;
const uid = process.env.JACOB_E2E_USER_UID;
const projectId = process.env.JACOB_E2E_FIREBASE_PROJECT_ID;

for (const [name, value] of Object.entries({
  JACOB_E2E_USER_EMAIL: email,
  JACOB_E2E_USER_PASSWORD: password,
  JACOB_E2E_USER_UID: uid,
  JACOB_E2E_FIREBASE_PROJECT_ID: projectId,
})) {
  if (!value) {
    console.error(`seed-emulator: ${name} is required.`);
    process.exit(2);
  }
}

// No credential needed against the emulator — projectId is enough for the
// SDK to know which emulator project to talk to.
initializeApp({ projectId });

const auth = getAuth();

try {
  const existing = await auth.getUser(uid).catch(() => null);
  if (existing) {
    await auth.updateUser(uid, { email, password, emailVerified: true });
    console.log(`seed-emulator: refreshed user ${uid} (${email}).`);
  } else {
    await auth.createUser({ uid, email, password, emailVerified: true });
    console.log(`seed-emulator: created user ${uid} (${email}).`);
  }
} catch (err) {
  console.error(`seed-emulator: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
