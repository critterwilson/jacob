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
 * Firebase Admin SDK helper for the Playwright suite. Two execution modes:
 *
 *   - **Emulator mode** (default in CI now): `FIREBASE_AUTH_EMULATOR_HOST`
 *     is set, the suite runs against a local Firebase Auth emulator. The
 *     Admin SDK auto-redirects every call to the emulator and no real
 *     credential is needed — `initializeApp({ projectId })` is enough.
 *     Email-verification + password-reset don't require navigating a real
 *     hosted action URL: we flip `emailVerified` directly via `updateUser`,
 *     and surface the emulator's reset link unchanged (the emulator hosts
 *     its own reset UI). This sidesteps the real-Firebase rate limits
 *     (TOO_MANY_ATTEMPTS_TRY_LATER) that were blocking every PR.
 *
 *   - **Staging mode** (legacy): no emulator host set. The SDK contacts
 *     real Firebase. Service-account credentials are read from
 *     `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT` (base64'd JSON), or the path
 *     variant, or ADC. `generateEmailVerificationLink` /
 *     `generatePasswordResetLink` return Firebase-hosted action URLs that
 *     Playwright then navigates. This mode is kept for local opt-in
 *     (`unset FIREBASE_AUTH_EMULATOR_HOST` and provide creds) but is no
 *     longer the CI default.
 *
 * Hard-pinned to the staging project — never run against prod, even if the
 * caller's ADC happens to point elsewhere. The same project ID is used by
 * both the emulator (so emulator-issued tokens carry `aud: jacob-staging-494515`)
 * and the staging Cloud Run backend's emulator-token verifier — they must
 * agree, otherwise the backend rejects every request.
 */

const STAGING_PROJECT_ID = "jacob-staging-494515";

let cachedApp: App | undefined;

export function isEmulatorMode(): boolean {
  return !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

/** Returns true iff the helper can perform admin operations.
 *
 * In emulator mode this is always true — no real credential is required.
 * In staging mode, we need at least one credential source.
 */
export function adminAvailable(): boolean {
  if (isEmulatorMode()) return true;
  return Boolean(
    process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT ||
      process.env.JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

export function ensureAdminOrSkip(): void {
  if (!adminAvailable()) {
    test.skip(
      true,
      "Missing Firebase Admin SDK credentials. Either set " +
        "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 (emulator mode, no creds) " +
        "or provide JACOB_E2E_FIREBASE_SERVICE_ACCOUNT / " +
        "JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH / ADC. " +
        "See frontend/e2e/README.md.",
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

  if (isEmulatorMode()) {
    // No credential needed — the Admin SDK detects the emulator host env
    // var and routes all auth calls there, where no auth is enforced.
    cachedApp = initializeApp({ projectId: STAGING_PROJECT_ID });
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

export async function generateVerifyLink(email: string): Promise<string> {
  return getAuth(getApp()).generateEmailVerificationLink(email);
}

/**
 * Stamp the `admin: true` custom claim on the given user.
 *
 * ADR 0012 / admin-approval flow tests need an admin actor to drive
 * the /admin/applications UI. We mint or look up the user, set the
 * custom claim, and revoke their refresh tokens so the next ID token
 * mint reflects the new claim. Emulator-only path uses the same Admin
 * SDK calls — the emulator honours custom claims for token-verification.
 */
export async function grantAdminClaim(email: string): Promise<{ uid: string }> {
  const auth = getAuth(getApp());
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });
  await auth.revokeRefreshTokens(user.uid);
  return { uid: user.uid };
}

export async function generateResetLink(email: string): Promise<string> {
  return getAuth(getApp()).generatePasswordResetLink(email);
}

/**
 * Reset the user's password.
 *
 * In emulator mode we bypass the action-link UI entirely (the emulator
 * renders its own reset page whose markup is not part of any stable
 * contract — Firebase owns it and may change it between releases) and
 * use `updateUser({ password })` directly. In staging mode we still
 * navigate Firebase's hosted action page so we exercise the full reset
 * flow a real user takes.
 *
 * Returns once the new password is in effect — caller can immediately
 * sign in with it.
 */
export async function resetPasswordViaAdmin(
  page: Page,
  email: string,
  newPassword: string,
): Promise<void> {
  if (isEmulatorMode()) {
    const auth = getAuth(getApp());
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password: newPassword });
    return;
  }

  const link = await generateResetLink(email);
  const resetPage = await page.context().newPage();
  try {
    await resetPage.goto(link, { waitUntil: "domcontentloaded" });
    const passwordField = resetPage
      .locator(
        'input[name="password"], input[type="password"]:not([name="newPassword2"])',
      )
      .first();
    await passwordField.waitFor({ state: "visible", timeout: 15_000 });
    await passwordField.fill(newPassword);
    await resetPage
      .getByRole("button", { name: /save|reset|confirm/i })
      .first()
      .click();
    await resetPage
      .getByText(/password.*(updated|changed|reset)/i)
      .waitFor({ timeout: 15_000 });
  } finally {
    await resetPage.close();
  }
}

/**
 * Mark the given user as email-verified.
 *
 * In emulator mode we flip the flag directly via `updateUser` — there's no
 * point round-tripping through the emulator's hosted action UI, and doing
 * so adds flake. In staging mode we still navigate the real Firebase action
 * URL so the path matches a production user clicking the email link.
 */
export async function verifyEmailViaAdmin(
  page: Page,
  email: string,
): Promise<void> {
  if (isEmulatorMode()) {
    const auth = getAuth(getApp());
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) {
      await auth.updateUser(user.uid, { emailVerified: true });
    }
    return;
  }

  const link = await generateVerifyLink(email);
  const verifyPage = await page.context().newPage();
  try {
    await verifyPage.goto(link, { waitUntil: "domcontentloaded" });
    await verifyPage.waitForTimeout(3_000);
  } finally {
    await verifyPage.close();
  }
}

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
 * Best-effort cleanup: delete the test user so we don't accumulate hundreds
 * of `jacob-e2e-*@…` accounts. In emulator mode the emulator is wiped at
 * the end of the run anyway — this still helps when running locally with
 * `firebase emulators:start` left up between invocations.
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
