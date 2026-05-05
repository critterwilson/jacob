import {
  fetchLatestEmail,
  openMailinatorContext,
  pickFirebaseActionLink,
} from "./helpers/mailinator";
import {
  STRONG_PASSWORD,
  fillSignInForm,
  gotoSignIn,
  gotoSignUp,
  sharedAccountCredentials,
  signOut,
  submitSignIn,
  submitSignUp,
} from "./helpers/auth";
import { expect, test } from "./helpers/fixtures";

test.describe("auth", () => {
  test("fresh signup → verify via mailinator → sign in → sign out → sign back in", async ({
    page,
    browser,
    freshEmail,
  }) => {
    test.slow(); // mailinator polling pushes us past the default timeout.

    // 1. Sign up with a brand-new mailinator inbox.
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    // Firebase has to round-trip the createUser call before redirect fires.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });

    // 2. Pull the verification link out of the public mailinator inbox in a
    //    separate browser context so cookies / sessions don't intermix.
    const { context: mailContext, page: mailPage } =
      await openMailinatorContext(browser);
    let verifyLink: string;
    try {
      const msg = await fetchLatestEmail(mailPage, freshEmail.localPart, {
        subjectIncludes: "verify",
        timeoutMs: 90_000,
      });
      verifyLink = pickFirebaseActionLink(msg, "verifyEmail");
    } finally {
      await mailContext.close();
    }

    // 3. Open the verification link in a fresh page; Firebase shows its own
    //    "Email verified" interstitial. We don't assert on it (Firebase owns
    //    the markup) — we assert by signing in afterwards.
    const verifyPage = await page.context().newPage();
    await verifyPage.goto(verifyLink, { waitUntil: "domcontentloaded" });
    // Give Firebase's hosted verification page a moment to call its API.
    await verifyPage.waitForTimeout(3_000);
    await verifyPage.close();

    // 4. Sign in with the now-verified account.
    await gotoSignIn(page);
    await fillSignInForm(page, freshEmail.email, STRONG_PASSWORD);
    await submitSignIn(page);
    // After verify the new user has no profile yet, so middleware bounces to
    // /onboarding. Either /onboarding or /home is acceptable depending on
    // whether prior runs raced ahead.
    await expect(page).toHaveURL(/\/(onboarding|home|groups)/, { timeout: 20_000 });

    // 5. Sign out.
    await signOut(page);
    await expect(page).toHaveURL(/\/sign-in/);

    // 6. Sign back in to prove the sign-out actually cleared the session
    //    (vs. just routing away from a still-authed page).
    await fillSignInForm(page, freshEmail.email, STRONG_PASSWORD);
    await submitSignIn(page);
    await expect(page).toHaveURL(/\/(onboarding|home|groups)/, { timeout: 20_000 });
  });

  test("wrong password shows an error and stays on /sign-in", async ({ page }) => {
    const { email } = sharedAccountCredentials();
    await gotoSignIn(page);
    await fillSignInForm(page, email, "definitely-not-the-real-password-123!");
    await submitSignIn(page);

    // Banner role=alert wraps the auth error; humanizeAuthError typically
    // renders something like "Email or password is incorrect."
    const banner = page.getByRole("alert").first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("unverified account is rejected with verify-email gate", async ({
    page,
    browser,
    freshEmail,
  }) => {
    test.slow();
    // Sign up but DO NOT click the verification link.
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });

    // Force-clear the Firebase session by hitting /sign-in directly. Then
    // attempt to sign in — SignInForm signs the user out itself if
    // emailVerified is false and surfaces a "verify your email" banner.
    await gotoSignIn(page);
    await fillSignInForm(page, freshEmail.email, STRONG_PASSWORD);
    await submitSignIn(page);

    await expect(page.getByText(/verify your email/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/sign-in/);

    // Touch the mailinator inbox to confirm the verification email at least
    // got dispatched (catches a regression where signup silently no-ops).
    const { context: mailContext, page: mailPage } =
      await openMailinatorContext(browser);
    try {
      const msg = await fetchLatestEmail(mailPage, freshEmail.localPart, {
        subjectIncludes: "verify",
        timeoutMs: 60_000,
      });
      expect(msg.links.length).toBeGreaterThan(0);
    } finally {
      await mailContext.close();
    }
  });
});
