# Playwright E2E suite

Targets the **staging** Firebase Hosting URL by default. The
production-guard in `helpers/env.ts` refuses to run against a URL that
matches a prod pattern unless `JACOB_E2E_PRODUCTION_GUARD_DISABLED=1` is set.

## Running

```sh
pnpm --filter jacob-frontend test:e2e            # headless, line reporter
pnpm --filter jacob-frontend test:e2e:ui         # Playwright UI mode
pnpm --filter jacob-frontend test:e2e:report     # open last HTML report
```

## Environment variables

| Variable | Purpose | Required for |
| --- | --- | --- |
| `PLAYWRIGHT_BASE_URL` | Frontend URL under test. Defaults to staging. | Always (defaulted). |
| `PLAYWRIGHT_API_URL` | Backend URL the frontend talks to. Defaults to staging. | Always (defaulted). |
| `JACOB_E2E_USER_EMAIL` / `JACOB_E2E_USER_PASSWORD` | Long-lived shared test account (already onboarded on staging). | The 12 tests in `boards`, `chat`, `devotionals`, `groups`, `home`, `sermons`, `settings`, `signout`. Tests skip cleanly without it. |
| `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT` | **Base64-encoded** service-account JSON for the Firebase Admin SDK on the staging project. Used to generate verify / reset links and clean up test users without scraping a public inbox. | The 4 tests in `auth`, `forgot-password`, `onboarding`. Tests skip cleanly without it. |
| `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH` | Alternative to the base64 form: absolute path to a service-account JSON file. Convenient for local dev. | Same as above. |
| `GOOGLE_APPLICATION_CREDENTIALS` / ADC | Standard Google ADC fallback. If set (or you've run `gcloud auth application-default login`), the Admin SDK uses it. | Same as above. |
| `JACOB_E2E_PRODUCTION_GUARD_DISABLED` | Escape hatch — explicitly set to `1` to run against a URL that matches the prod pattern. **Don't.** | Never in CI. |

The two secret families (`JACOB_E2E_USER_*` and `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT`)
unlock different sets of tests. Either can be missing without the other —
the suite skips the dependent tests cleanly.

## Setting up the Firebase Admin SDK service account (local)

You only need to do this if you want to run the auth / forgot-password /
onboarding tests locally. Otherwise those 4 tests skip with a clear reason
and the rest of the suite still runs.

1. In the **staging** Firebase console (`jacob-staging-494515`), go to
   **Project settings → Service accounts → Generate new private key**.
2. Save the downloaded JSON somewhere outside the repo (e.g.
   `~/.jacob-e2e-staging-sa.json`). **Never commit it, even gitignored.**
3. Either point the helper at the file:
   ```sh
   export JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH="$HOME/.jacob-e2e-staging-sa.json"
   ```
   Or use ADC:
   ```sh
   gcloud auth application-default login    # browser flow
   ```
4. Run the suite — the 4 admin-gated tests will now execute.

The service account needs only **Firebase Authentication Admin** on the
staging project. Don't grant prod access. Don't grant Firestore, Storage,
or any other roles.

## CI

`.github/workflows/ci.yml` passes both secret families to the Playwright
job. The repository must have the following secrets configured:

- `JACOB_E2E_USER_EMAIL`, `JACOB_E2E_USER_PASSWORD` — shared-account
  fixture for the read-mostly tests.
- `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT` — base64-encoded service-account
  JSON for the staging project. Generate with:
  ```sh
  base64 -w0 < ~/.jacob-e2e-staging-sa.json | pbcopy   # macOS
  base64 -w0 < ~/.jacob-e2e-staging-sa.json            # Linux
  ```
  then paste the result into the GitHub Actions secret value.

Both secrets are optional: if a secret is missing, the dependent tests
skip and the rest of the suite still runs. The job is green-with-skips
rather than red.

## Why we don't read email anymore

The earlier suite scraped the public Mailinator inbox to grab Firebase
verification + reset links. The free public inbox returns a CAPTCHA / 403
to GitHub Actions runner IPs (high abuse rate from those IP ranges), so
the 4 dependent tests skipped on every CI run. The Admin SDK helper
(`helpers/firebaseAdmin.ts`) calls `generateEmailVerificationLink` /
`generatePasswordResetLink` directly, which returns the same hosted-action
URL Firebase would have emailed. Playwright then navigates that URL — so
we still exercise Firebase's real verify / reset code path, we just skip
the email round-trip.
