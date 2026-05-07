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
import { getUserStateByEmail, verifyEmailViaAdmin } from "./helpers/firebaseAdmin";
import { expect, test } from "./helpers/fixtures";

test.describe("auth", () => {
  test("fresh signup → admin verify link → sign in → sign out → sign back in", async ({
    page,
    freshEmail,
  }) => {
    // 1. Sign up via the real form so we exercise the same client code path
    //    a real user takes (CORS preflight, Firebase Auth round-trip, etc.).
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    // Email/password signup now lands on the verify-email interstitial;
    // the user can't reach /onboarding until they verify.
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 });

    // 2. Generate the same `mode=verifyEmail` link Firebase would have
    //    emailed and have Playwright navigate it. This still exercises
    //    Firebase's hosted action handler — we only skip the email
    //    round-trip (which was unreachable from CI runners on the free
    //    Mailinator tier).
    await verifyEmailViaAdmin(page, freshEmail.email);

    // 3. Sign in with the now-verified account.
    await gotoSignIn(page);
    await fillSignInForm(page, freshEmail.email, STRONG_PASSWORD);
    await submitSignIn(page);
    // After verify the new user has no profile yet, so middleware bounces to
    // /onboarding. Either /onboarding or /home is acceptable depending on
    // whether prior runs raced ahead.
    await expect(page).toHaveURL(/\/(onboarding|home|groups)/, { timeout: 20_000 });

    // 4. Sign out.
    await signOut(page);
    await expect(page).toHaveURL(/\/sign-in/);

    // 5. Sign back in to prove the sign-out actually cleared the session
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
    freshEmail,
  }) => {
    // Sign up but DO NOT verify the email.
    await gotoSignUp(page);
    await page.getByLabel(/^email$/i).fill(freshEmail.email);
    await page.getByLabel(/^password$/i).fill(STRONG_PASSWORD);
    await submitSignUp(page);
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 });

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

    // Confirm via the Admin SDK that signup actually persisted the user
    // and left them unverified — catches a regression where signup
    // silently no-ops or auto-verifies.
    const state = await getUserStateByEmail(freshEmail.email);
    expect(state.exists).toBe(true);
    if (state.exists) {
      expect(state.emailVerified).toBe(false);
    }
  });
});
