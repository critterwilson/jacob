import {
  fetchLatestEmailOrSkip,
  openMailinatorContext,
  pickFirebaseActionLink,
} from "./helpers/mailinator";
import {
  STRONG_PASSWORD,
  fillSignInForm,
  gotoForgotPassword,
  gotoSignIn,
  gotoSignUp,
  submitSignIn,
  submitSignUp,
} from "./helpers/auth";
import { expect, test } from "./helpers/fixtures";

test.describe("forgot password", () => {
  test("request reset → mailinator → set new password → sign in", async ({
    page,
    browser,
    freshEmail,
  }) => {
    test.slow();

    // Step 0 — create + verify an account. We can't use the shared account
    // here because the test mutates the password.
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });

    {
      const { context, page: mailPage } = await openMailinatorContext(browser);
      try {
        const msg = await fetchLatestEmailOrSkip(mailPage, freshEmail.localPart, {
          subjectIncludes: "verify",
          timeoutMs: 90_000,
        });
        const verifyLink = pickFirebaseActionLink(msg, "verifyEmail");
        const verifyPage = await page.context().newPage();
        await verifyPage.goto(verifyLink, { waitUntil: "domcontentloaded" });
        await verifyPage.waitForTimeout(3_000);
        await verifyPage.close();
      } finally {
        await context.close();
      }
    }

    // Step 1 — request a password reset.
    await gotoForgotPassword(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible({
      timeout: 10_000,
    });

    // Step 2 — pick the reset link out of mailinator. The same inbox already
    // received a verification email, so we filter on subject.
    let resetLink: string;
    {
      const { context, page: mailPage } = await openMailinatorContext(browser);
      try {
        const msg = await fetchLatestEmailOrSkip(mailPage, freshEmail.localPart, {
          subjectIncludes: "reset",
          timeoutMs: 90_000,
        });
        resetLink = pickFirebaseActionLink(msg, "resetPassword");
      } finally {
        await context.close();
      }
    }

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
