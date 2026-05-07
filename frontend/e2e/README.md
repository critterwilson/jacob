# Playwright E2E suite

The frontend under test is **a local Next.js prod build on `localhost:3000`**
wired to a **Firebase Auth emulator** on `localhost:9099`. Backend `/api/*`
calls still go to the staging Cloud Run service. The production-guard in
`helpers/env.ts` refuses to run against a URL that matches a prod pattern
unless `JACOB_E2E_PRODUCTION_GUARD_DISABLED=1` is set.

## Why the auth emulator?

We previously hit real Firebase Auth from the suite. The signin / signup /
password-reset endpoints are aggressively per-IP rate-limited, and CI
runners came back with `TOO_MANY_ATTEMPTS_TRY_LATER` on essentially every
PR — blocking unrelated work. Shifting only auth to a local emulator
sidesteps every Firebase rate limit. Backend calls still hit staging
Cloud Run; staging accepts emulator-issued tokens because deploy.yml sets
`JACOB_ALLOW_EMULATOR_TOKENS=1` on the staging service only (the setting
is forbidden in production by `Settings._block_emulator_tokens_in_production`
in `backend/app/config.py`).

## Running

```sh
pnpm --filter jacob-frontend test:e2e            # headless, line reporter
pnpm --filter jacob-frontend test:e2e:ui         # Playwright UI mode
pnpm --filter jacob-frontend test:e2e:report     # open last HTML report
```

To run locally end-to-end you need everything booted before invoking
Playwright. The CI job (`.github/workflows/ci.yml` → `frontend-e2e`) is
the canonical recipe; the quick-start below mirrors it.

### Local quick-start

```sh
# 1. Boot the Auth emulator (in one terminal)
firebase emulators:start --only auth --project jacob-staging-494515

# 2. Seed the shared test user into the emulator with the same UID it has
#    on staging (in a second terminal). Requires the JACOB_E2E_FIREBASE_*
#    secret + JACOB_E2E_USER_EMAIL.
node frontend/e2e/scripts/fetch-staging-uid.mjs > /tmp/uid.env
set -a; source /tmp/uid.env; set +a
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  JACOB_E2E_FIREBASE_PROJECT_ID=jacob-staging-494515 \
  node frontend/e2e/scripts/seed-emulator.mjs

# 3. Build + serve the frontend pointed at the emulator
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=jacob-staging-494515 \
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=jacob-staging-494515.firebaseapp.com \
  NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key-for-emulator \
  NEXT_PUBLIC_FIREBASE_APP_ID=fake-app-id-for-emulator \
  NEXT_PUBLIC_API_URL=https://jacob-backend-7fk543coqq-uc.a.run.app \
  pnpm --filter jacob-frontend build
pnpm --filter jacob-frontend start   # serves on :3000

# 4. Run Playwright (in a third terminal)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  PLAYWRIGHT_API_URL=https://jacob-backend-7fk543coqq-uc.a.run.app \
  pnpm --filter jacob-frontend test:e2e
```

If you don't care about the shared-account tests (chat, home, settings,
etc.) you can skip step 2 — those tests skip cleanly with a clear reason
when `JACOB_E2E_USER_UID` is unset.

## Environment variables

| Variable | Purpose | Required for |
| --- | --- | --- |
| `PLAYWRIGHT_BASE_URL` | Frontend URL under test. CI sets it to `http://localhost:3000`. | Always (defaulted in CI). |
| `PLAYWRIGHT_API_URL` | Backend URL. Always staging Cloud Run. | Always (defaulted in CI). |
| `FIREBASE_AUTH_EMULATOR_HOST` | When set, the helper + frontend talk to the local Auth emulator instead of real Firebase. | Always in CI; opt-in locally. |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` | Build-time switch in `frontend/lib/firebase.ts`. Must be `true` when the emulator is in use, set BEFORE `next build`. | Always in CI; opt-in locally. |
| `JACOB_E2E_FIREBASE_PROJECT_ID` | Project ID the Auth emulator boots with — must match `NEXT_PUBLIC_FIREBASE_PROJECT_ID` and the staging Cloud Run backend's project ID. | Seed scripts. |
| `JACOB_E2E_USER_EMAIL` / `JACOB_E2E_USER_PASSWORD` | Shared test account credentials. Seeded into the emulator at the start of each CI run. | Shared-account tests (8 of them). Skip cleanly without it. |
| `JACOB_E2E_USER_UID` | UID the shared user has on staging Firebase Auth. Populated by `fetch-staging-uid.mjs` from `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT`. The emulator user is created with this UID so the staging Firestore profile lookup still works. | Shared-account tests. Skip cleanly without it. |
| `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT` | Base64-encoded service-account JSON for the staging project. Read once by `fetch-staging-uid.mjs` to look up the shared user's staging UID — that's the only real-Firebase call left in the suite. | Shared-account tests (UID lookup). |
| `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT_PATH` | Alternative to the base64 form: absolute path to a service-account JSON file. Convenient for local dev. | Same as above. |
| `JACOB_E2E_PRODUCTION_GUARD_DISABLED` | Escape hatch — explicitly set to `1` to run against a URL that matches the prod pattern. **Don't.** | Never in CI. |

## Why we don't need a service account in the emulator path

The Firebase Auth emulator doesn't authenticate Admin-SDK callers. The
helper initializes the SDK with just `{ projectId }` and the SDK auto-routes
auth operations to the emulator host. The `fetch-staging-uid.mjs` script is
the only step that still needs a real service-account credential, and it
runs once per CI run as a non-rate-limited `getUserByEmail` call.

## Trust boundary

In emulator mode, the staging backend trusts every emulator-issued token —
anyone who can mint one (i.e. anyone who can hit the staging hosted.app URL)
could forge a Bearer token for any UID on the staging project. This is an
explicit, scoped trust decision: staging holds throwaway data only, and the
gate is hard-blocked in production by a Settings validator. The emulator
fallback in `backend/app/deps.py:_decode_emulator_token` only accepts
`alg: none` tokens, so a real-but-tampered RS256 token still cannot sneak
through after `verify_id_token` rejects it.

## CI

`.github/workflows/ci.yml` → `frontend-e2e` runs the recipe above. Required
secrets:

- `JACOB_E2E_USER_EMAIL`, `JACOB_E2E_USER_PASSWORD` — shared-account
  fixture for the read-mostly tests.
- `JACOB_E2E_FIREBASE_SERVICE_ACCOUNT` — base64-encoded service-account
  JSON for the staging project, used solely to look up the shared user's
  staging UID once per run. Generate with:
  ```sh
  base64 -w0 < ~/.jacob-e2e-staging-sa.json | pbcopy   # macOS
  base64 -w0 < ~/.jacob-e2e-staging-sa.json            # Linux
  ```

All three secrets are optional: if any is missing, the dependent tests
skip and the rest of the suite still runs. The job is green-with-skips
rather than red.
