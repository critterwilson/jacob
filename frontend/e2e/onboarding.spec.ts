import {
  STRONG_PASSWORD,
  gotoSignUp,
  submitSignUp,
} from "./helpers/auth";
import { verifyEmailViaAdmin } from "./helpers/firebaseAdmin";
import { expect, test } from "./helpers/fixtures";

/**
 * ADR 0011 — signup happy path now ends at /awaiting-approval (admin
 * approval queue) instead of /groups. The legacy assertion that this
 * test landed on /groups would fail post-ADR; the integration value
 * (CORS pre-flight, cookie mirror, middleware routing for non-approved
 * users) is preserved by re-pointing the redirect target.
 */
test.describe("onboarding", () => {
  test("fresh signup → admin verify → onboarding → /awaiting-approval", async ({
    page,
    freshEmail,
  }) => {
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    // ADR 0011 — signup now collects DOB. Use a clearly-adult date so
    // we don't trip the under-13 client-side block before the auth
    // user is created.
    await page.getByLabel(/date of birth/i).fill("1990-04-12");
    await submitSignUp(page);
    await expect(page).toHaveURL(/\/(verify-email|onboarding)/, {
      timeout: 20_000,
    });

    // Verify the email so the application-submit endpoint accepts the
    // request (`email_verified` claim on the ID token).
    await verifyEmailViaAdmin(page, freshEmail.email);

    // Reload onboarding so the auth-context picks up the verified status.
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(
      page.getByRole("form", { name: /complete your profile/i }),
    ).toBeVisible({ timeout: 15_000 });

    const displayName = `Playwright ${freshEmail.localPart.slice(-6)}`;
    await page.getByLabel(/display name/i).fill(displayName);
    // DOB on the onboarding form is authoritative — type it again here
    // (the signup-time stash will pre-fill but type-clear-type forces
    // the form-state-validated value).
    await page.getByLabel(/date of birth/i).fill("1990-04-12");
    await page.locator("#communityGuidelines").check();

    await Promise.all([
      page.waitForURL(/\/awaiting-approval/, { timeout: 30_000 }),
      page.getByRole("button", { name: /submit application/i }).click(),
    ]);

    // Wait screen renders with the "Application submitted" heading.
    await expect(
      page.getByRole("heading", { name: /waiting for approval/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
