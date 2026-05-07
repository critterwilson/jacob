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
  resetPasswordViaAdmin,
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

    // Step 2+3 — actually reset the password via the Admin SDK helper.
    // In staging mode this navigates Firebase's hosted reset page; in
    // emulator mode it sets the password directly to keep the test off
    // the emulator's (volatile) reset UI markup.
    const newPassword = STRONG_PASSWORD + "!new";
    await resetPasswordViaAdmin(page, freshEmail.email, newPassword);

    // Step 4 — sign in with the new password.
    await gotoSignIn(page);
    await fillSignInForm(page, freshEmail.email, newPassword);
    await submitSignIn(page);
    await expect(page).toHaveURL(/\/(onboarding|home|groups)/, {
      timeout: 20_000,
    });
  });
});
