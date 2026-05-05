import { expect, type Page } from "@playwright/test";

/**
 * UI-level auth helpers. They drive the same forms a real user does so the
 * tests catch CORS / Firebase config regressions in the same flow as the user
 * — not via the Admin SDK or API shortcuts.
 *
 * Every helper waits on a stable post-condition (URL change, banner text)
 * rather than `waitForTimeout` so flake from variable Firebase round-trips
 * stays out of the suite.
 */

export const STRONG_PASSWORD = "JacobE2e!Test#2024";

export async function gotoSignIn(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("form", { name: /sign in/i })).toBeVisible();
}

export async function gotoSignUp(page: Page): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("form", { name: /create account/i })).toBeVisible();
}

export async function fillSignInForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
}

export async function submitSignIn(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

export async function submitSignUp(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^create account$/i }).click();
}

/**
 * Sign in with credentials and wait for the post-auth landing page.
 * Caller can pass `expectRedirectTo` to assert a specific destination
 * (default: any non-`/sign-in` URL is good enough).
 */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  opts: { expectRedirectTo?: RegExp } = {},
): Promise<void> {
  await gotoSignIn(page);
  await fillSignInForm(page, email, password);
  await submitSignIn(page);
  // After submit, either we land somewhere new or an error banner appears.
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await expect(page).toHaveURL(opts.expectRedirectTo ?? /\/(home|groups|onboarding|$)/i, {
    timeout: 20_000,
  });
}

export async function signOut(page: Page): Promise<void> {
  // The sidebar sign-out button is `<button type=button>Sign out</button>`.
  // Mobile drawer needs to be opened first if the viewport is < md.
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (isMobile) {
    await page.getByRole("button", { name: /open navigation menu/i }).click();
  }
  await page.getByRole("button", { name: /^sign out$/i }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
}

/**
 * Credentials for the long-lived shared test account. Tests that don't
 * exercise the signup flow itself reuse this account so we don't hammer
 * the Firebase Auth signup endpoint (per-IP rate limits).
 *
 * Set `JACOB_E2E_USER_EMAIL` / `JACOB_E2E_USER_PASSWORD` in CI / local env.
 * The account must already be:
 *   - registered in the staging Firebase project,
 *   - email-verified,
 *   - onboarded (i.e. has a `users/{uid}` profile doc).
 */
export function sharedAccountCredentials(): { email: string; password: string } {
  const email = process.env.JACOB_E2E_USER_EMAIL;
  const password = process.env.JACOB_E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing JACOB_E2E_USER_EMAIL / JACOB_E2E_USER_PASSWORD. The shared " +
        "verified test account must be configured before running suites that " +
        "need pre-onboarded auth (home, chat, boards, etc.).",
    );
  }
  return { email, password };
}
