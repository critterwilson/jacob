import {
  STRONG_PASSWORD,
  fillSignInForm,
  gotoForgotPassword,
  gotoSignIn,
  gotoSignUp,
  submitSignIn,
  submitSignUp,
} from "./helpers/auth";
import {
  generateResetLink,
  verifyEmailViaAdmin,
} from "./helpers/firebaseAdmin";
import { expect, test } from "./helpers/fixtures";

test.describe("forgot password", () => {
  test("request reset → admin link → set new password → sign in", async ({
    page,
    freshEmail,
  }) => {
    // Step 0 — create + verify an account. We can't use the shared account
    // here because the test mutates the password.
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    // Accept either /verify-email or /onboarding during the rollout
    // window — staging may still be on the pre-this-PR build.
    await expect(page).toHaveURL(/\/(verify-email|onboarding)/, {
      timeout: 20_000,
    });
    await verifyEmailViaAdmin(page, freshEmail.email);

    // Step 1 — request a password reset through the real form so the
    // forgot-password endpoint + Firebase round-trip get exercised.
    await gotoForgotPassword(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible({
      timeout: 10_000,
    });

    // Step 2 — generate the same reset link Firebase would have emailed
    //  via the Admin SDK. The link points at Firebase's hosted reset page
    //  (`<project>.firebaseapp.com/__/auth/action?mode=resetPassword&...`),
    //  same form as the link we used to scrape from Mailinator.
    const resetLink = await generateResetLink(freshEmail.email);

    // Step 3 — open the reset link, set a new password.
    const newPassword = STRONG_PASSWORD + "!new";
    const resetPage = await page.context().newPage();
    await resetPage.goto(resetLink, { waitUntil: "domcontentloaded" });
    // Firebase's hosted reset page renders an input with name="password"
    // and a save button. We target both with broad selectors so a Firebase
    // template change doesn't immediately break the test.
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
    // Wait for Firebase's "Password updated" confirmation.
    await resetPage
      .getByText(/password.*(updated|changed|reset)/i)
      .waitFor({ timeout: 15_000 });
    await resetPage.close();

    // Step 4 — sign in with the new password.
    await gotoSignIn(page);
    await fillSignInForm(page, freshEmail.email, newPassword);
    await submitSignIn(page);
    await expect(page).toHaveURL(/\/(onboarding|home|groups)/, {
      timeout: 20_000,
    });
  });
});
