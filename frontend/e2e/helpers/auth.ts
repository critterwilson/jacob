import { expect, test, type Locator, type Page } from "@playwright/test";

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

/**
 * Next.js App Router renders the form server-side first, then the client
 * component hydrates. Until hydration completes, the submit button has no
 * React onClick / form has no onSubmit handler attached, and clicking it
 * causes the browser's default GET (which leaks the password into the URL —
 * exactly what we observed in the first run). Waiting on the `load` event +
 * `networkidle` is the standard Playwright workaround.
 */
async function waitForHydration(page: Page, formName: RegExp): Promise<Locator> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const form = page.getByRole("form", { name: formName });
  await expect(form).toBeVisible();
  return form;
}

export async function gotoSignIn(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await waitForHydration(page, /sign in/i);
}

export async function gotoSignUp(page: Page): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await waitForHydration(page, /create account/i);
}

export async function gotoForgotPassword(page: Page): Promise<void> {
  await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
  await waitForHydration(page, /forgot password/i);
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
  // The form gates submission on the Terms of Service checkbox; tick
  // it here so each test that goes through the helper doesn't have to
  // know about the gate.
  const accept = page.locator("#acceptTerms");
  if (await accept.isVisible()) {
    await accept.check();
  }
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
 *
 * If the env vars aren't set, we call `test.skip()` rather than throwing
 * so CI is green-with-skips instead of red. The skipped tests are listed
 * in the run report; once secrets land, every skip flips to a real run.
 */
export function sharedAccountCredentials(): { email: string; password: string } {
  const email = process.env.JACOB_E2E_USER_EMAIL;
  const password = process.env.JACOB_E2E_USER_PASSWORD;
  if (!email || !password) {
    test.skip(
      true,
      "Missing JACOB_E2E_USER_EMAIL / JACOB_E2E_USER_PASSWORD — set the " +
        "shared-account secrets in CI / local env to enable this test.",
    );
    // Unreachable; test.skip throws internally. Cast to satisfy the
    // type-checker.
    return { email: "", password: "" };
  }
  return { email, password };
}
