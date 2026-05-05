import { test as base, expect, type Page } from "@playwright/test";

import { sharedAccountCredentials, signIn } from "./auth";
import { cleanupTestUser, ensureAdminOrSkip } from "./firebaseAdmin";
import { uniqueEmail } from "./unique";

/**
 * Two flavours of fixture:
 *
 *   - `freshEmail` / `freshAccount` — generates a brand-new test email per
 *     test. The corresponding Firebase Auth user only exists if the test
 *     itself completes signup. Use these for tests that exercise signup,
 *     verification, password-reset, or onboarding flows. Requires Firebase
 *     Admin SDK credentials so we can (a) flip emailVerified without
 *     scraping a public inbox and (b) delete the user afterwards. If
 *     credentials are missing the fixture skips the test.
 *
 *   - `sharedAccountPage` — yields a Page already signed in as the
 *     pre-onboarded shared test account. Use this for read-mostly tests
 *     (home, devotionals, sermons) and write tests where the account can
 *     safely accumulate data the test cleans up at the end.
 */

type Fixtures = {
  freshEmail: { email: string; localPart: string };
  sharedAccountPage: Page;
};

export const test = base.extend<Fixtures>({
  freshEmail: async ({}, use) => {
    ensureAdminOrSkip();
    const value = uniqueEmail();
    try {
      await use(value);
    } finally {
      await cleanupTestUser(value.email);
    }
  },

  sharedAccountPage: async ({ page }, use) => {
    const { email, password } = sharedAccountCredentials();
    await signIn(page, email, password);
    await use(page);
  },
});

export { expect };
