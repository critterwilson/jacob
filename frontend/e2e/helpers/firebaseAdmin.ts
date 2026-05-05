import { readFileSync } from "node:fs";

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { test, type Page } from "@playwright/test";

/**
 * Firebase Admin SDK helper for the Playwright suite.
 *
 * Replaces the Mailinator scrape that was unreachable from CI runner IPs.
 * Instead of waiting for Firebase to deliver an email and reading it back,
 * we ask the Admin SDK directly for the same email-action link Firebase
 * would have sent (`generateEmailVerificationLink`, `generatePasswordResetLink`)
 * and have Playwright navigate it. The link still hits Firebase's hosted
 * action handler, so we exercise the real verify / reset code path — we
 * just skip the email round-trip.
 *
 * Credentials precedence (any one is enough):
 *   1. JACOB_E2E_FIREBASE_SERVICE_ACCOUNT — base64'd JSON service-account key.
 *      Preferred for CI; opaque to logs and storable as a single GitHub secret.
 *   2. JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH — absolute path to a JSON key.
 *      Convenient for local development.
 *   3. GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
 *      Convenient for local dev when you already have ADC set up; uses the
 *      `firebase-admin` SDK's standard ADC fallback.
 *
 * Hard-pinned to the staging project — never run against prod, even if the
 * caller's ADC happens to point elsewhere.
 */

const STAGING_PROJECT_ID = "jacob-staging-494515";

let cachedApp: App | undefined;

/** Returns true iff at least one credential source is configured. */
export function adminAvailable(): boolean {
  return Boolean(
    process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT ||
      process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

/**
 * Skips the current test (rather than failing) when no Admin SDK credentials
 * are configured. CI without the secret stays green-with-skips; local devs
 * who haven't set up a service account see the skip reason in the report.
 */
export function ensureAdminOrSkip(): void {
  if (!adminAvailable()) {
    test.skip(
      true,
      "Missing Firebase Admin SDK credentials. Set " +
        "JACOB_E2E_FIREBASE_SERVICE_ACCOUNT (base64'd JSON) or " +
        "JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON), or run " +
        "`gcloud auth application-default login`. See frontend/e2e/README.md.",
    );
  }
}

function getApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0]!;
    return cachedApp;
  }

  const b64 = process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT;
  const path = process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH;

  let credential;
  if (b64) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch (err) {
      throw new Error(
        "JACOB_E2E_FIREBASE_SERVICE_ACCOUNT is not valid base64-encoded JSON: " +
          (err as Error).message,
      );
    }
    credential = cert(json as Parameters<typeof cert>[0]);
  } else if (path) {
    const json = JSON.parse(readFileSync(path, "utf8"));
    credential = cert(json);
  } else {
    credential = applicationDefault();
  }

  cachedApp = initializeApp({ credential, projectId: STAGING_PROJECT_ID });
  return cachedApp;
}

/**
 * Generate the same `mode=verifyEmail` link Firebase would have emailed.
 * The link points at `<project>.firebaseapp.com/__/auth/action` (Firebase's
 * hosted handler). User must already exist in Firebase Auth.
 */
export async function generateVerifyLink(email: string): Promise<string> {
  return getAuth(getApp()).generateEmailVerificationLink(email);
}

/**
 * Generate the same `mode=resetPassword` link Firebase would have emailed.
 */
export async function generateResetLink(email: string): Promise<string> {
  return getAuth(getApp()).generatePasswordResetLink(email);
}

/**
 * Open the verify link in a fresh page so cookies / sessions don't intermix
 * with the app under test, then close it. Firebase's hosted handler renders
 * its own "Email verified" interstitial — we don't assert on that markup
 * (Firebase owns it), we just give the page time to call `applyActionCode`.
 */
export async function verifyEmailViaAdmin(
  page: Page,
  email: string,
): Promise<void> {
  const link = await generateVerifyLink(email);
  const verifyPage = await page.context().newPage();
  try {
    await verifyPage.goto(link, { waitUntil: "domcontentloaded" });
    await verifyPage.waitForTimeout(3_000);
  } finally {
    await verifyPage.close();
  }
}

/**
 * Look up a user by email and return whether they exist + whether their
 * email is verified. Used by tests that need to assert on Firebase-side
 * state without driving the UI (e.g., the "unverified gate" test).
 */
export async function getUserStateByEmail(
  email: string,
): Promise<{ exists: false } | { exists: true; emailVerified: boolean; uid: string }> {
  try {
    const user = await getAuth(getApp()).getUserByEmail(email);
    return { exists: true, emailVerified: user.emailVerified, uid: user.uid };
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") {
      return { exists: false };
    }
    throw err;
  }
}

/**
 * Best-effort cleanup: delete the test user from Firebase Auth so we don't
 * accumulate hundreds of `jacob-e2e-*@…` accounts on the staging project.
 * Swallows `auth/user-not-found` (test failed before signup, or already
 * cleaned) and logs anything else without re-throwing — cleanup must not
 * mask the underlying test result.
 */
export async function cleanupTestUser(email: string): Promise<void> {
  if (!adminAvailable()) return;
  try {
    const auth = getAuth(getApp());
    const user = await auth.getUserByEmail(email);
    await auth.deleteUser(user.uid);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/user-not-found") return;
    // eslint-disable-next-line no-console
    console.warn(`[e2e cleanup] could not delete user ${email}:`, err);
  }
}
