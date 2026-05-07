import {
  STRONG_PASSWORD,
  gotoSignUp,
  submitSignUp,
} from "./helpers/auth";
import { verifyEmailViaAdmin } from "./helpers/firebaseAdmin";
import { expect, test } from "./helpers/fixtures";

/**
 * Onboarding is exactly the place today's CORS regression hit:
 *   POST https://jacob-backend.../api/users/me
 *
 * If the staging backend's CORS allowlist drops the frontend origin, this
 * test fails on the profile-submission step with a `cors_blocked` error
 * before the redirect fires. Verifying redirect → /groups proves the
 * preflight succeeded AND the cookie was mirrored AND middleware let the
 * follow-up navigation through. That's the integration test we needed.
 */
test.describe("onboarding", () => {
  test("fresh signup → admin verify → onboarding → /groups", async ({
    page,
    freshEmail,
  }) => {
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    // Email/password signup lands on /verify-email until the link is
    // clicked. The admin call below mints+navigates that link, then the
    // page.goto("/onboarding") that follows replaces the polling redirect.
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 });

    // Verify the email so the onboarding endpoint accepts the request.
    await verifyEmailViaAdmin(page, freshEmail.email);

    // Reload onboarding so the auth-context picks up the verified status.
    // Wait for hydration explicitly — App Router pages render server-side
    // first and we cannot click Submit before the React handler attaches.
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(
      page.getByRole("form", { name: /complete your profile/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Fill the profile form.
    const displayName = `Playwright ${freshEmail.localPart.slice(-6)}`;
    await page.getByLabel(/display name/i).fill(displayName);
    await page.getByRole("radio", { name: /18 or older/i }).check();
    // Community guidelines checkbox — RHF registers it by name="communityGuidelines".
    await page.locator("#communityGuidelines").check();

    // Submit.
    await Promise.all([
      page.waitForURL(/\/groups/, { timeout: 30_000 }),
      page.getByRole("button", { name: /complete profile/i }).click(),
    ]);

    // Sanity: middleware accepted us into the post-onboarding section.
    await expect(page).toHaveURL(/\/groups/);
  });
});
