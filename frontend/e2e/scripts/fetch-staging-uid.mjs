#!/usr/bin/env node
/**
 * Look up the shared Playwright test user's UID in **real** staging Firebase
 * Auth, and emit it as a `key=value` line on stdout (suitable for piping
 * into `$GITHUB_ENV`).
 *
 * Why we need this: the E2E job runs against a local Firebase Auth emulator
 * to dodge real-Firebase rate limits, but the shared test user's profile
 * doc lives in **staging Firestore** keyed by the staging UID. We pre-seed
 * the same UID into the emulator so the staging backend's `users/{uid}` lookup
 * still finds the existing profile when called with an emulator-issued token.
 *
 * `getUserByEmail` is a single non-rate-limited admin call, run once per CI
 * run before the emulator boots — it is NOT what the rate-limit fix is
 * trying to avoid.
 *
 * Required env:
 *   - JACOB_E2E_USER_EMAIL
 *   - JACOB_E2E_FIREBASE_SERVICE_ACCOUNT (base64'd JSON) OR
 *     JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH OR
 *     GOOGLE_APPLICATION_CREDENTIALS / ADC
 *
 * IMPORTANT: this script must run with FIREBASE_AUTH_EMULATOR_HOST UNSET so
 * the Admin SDK contacts real staging.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const STAGING_PROJECT_ID = "jacob-staging-494515";

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    "fetch-staging-uid: FIREBASE_AUTH_EMULATOR_HOST is set; refusing to run " +
      "(this script must hit real staging, not the emulator).",
  );
  process.exit(2);
}

const email = process.env.JACOB_E2E_USER_EMAIL;
if (!email) {
  console.error("fetch-staging-uid: JACOB_E2E_USER_EMAIL is required.");
  process.exit(2);
}

const b64 = process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT;
const path = process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH;

let credential;
if (b64) {
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  credential = cert(json);
} else if (path) {
  credential = cert(JSON.parse(readFileSync(path, "utf8")));
} else {
  credential = applicationDefault();
}

initializeApp({ credential, projectId: STAGING_PROJECT_ID });

try {
  const user = await getAuth().getUserByEmail(email);
  // Print key=value to stdout — caller redirects into $GITHUB_ENV.
  process.stdout.write(`JACOB_E2E_USER_UID=${user.uid}\n`);
} catch (err) {
  console.error(`fetch-staging-uid: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
