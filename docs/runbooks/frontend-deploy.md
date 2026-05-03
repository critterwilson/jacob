# Frontend Deploy Runbook — Firebase App Hosting

The frontend (Next.js App Router with dynamic routes) deploys via **Firebase App Hosting**, not static export. App Hosting runs the Next.js server inside a managed Cloud Run container, so SSR and dynamic routes work without `generateStaticParams`.

## One-time setup (per environment)

These steps must be run once by a project owner before automatic deploys will work.

### 1. Enable the App Hosting API

```bash
gcloud services enable firebaseapphosting.googleapis.com \
  --project jacob-staging-494515
```

For production:

```bash
gcloud services enable firebaseapphosting.googleapis.com \
  --project jacob-prod-<ID>
```

### 2. Create the App Hosting backend

Run interactively (requires Firebase CLI ≥ 13.6 and browser-based login):

```bash
firebase apphosting:backends:create --project jacob-staging-494515
```

Prompts to answer:
- **Region**: `us-central1`
- **GitHub repo**: `critterwilson/jacob`
- **Branch**: `main`
- **Root directory**: `frontend`

The CLI will create a Cloud Run service, wire up a GitHub connection, and output the public URL (e.g. `https://jacob-staging-494515--default.us-central1.hosted.app`).

Repeat for the production project when ready.

### 3. Set environment variables

In the Firebase Console → App Hosting → your backend → Environment variables, add:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_API_URL
```

These are the same values as the corresponding GitHub Actions secrets.

## How deploys work after setup

Every push to `main` triggers App Hosting to build and roll out the Next.js app automatically — no CI step required. The `apphosting.yaml` at the repo root pins resource limits:

```yaml
# frontend/apphosting.yaml
runConfig:
  minInstances: 0
  maxInstances: 5
  cpu: 1
  memoryMiB: 512
```

## Dual lockfile note

`frontend/package-lock.json` exists solely for App Hosting's npm buildpack, which runs `npm ci` from the `frontend/` directory. The monorepo's primary lockfile remains `pnpm-lock.yaml` at the repo root (used by CI and local development).

**Both must be kept in sync when `frontend/package.json` changes.** Run:

```bash
pnpm install --frozen-lockfile=false   # updates root pnpm-lock.yaml
cd frontend && npm install --package-lock-only  # updates frontend/package-lock.json
```

Commit both files together. The Husky lint-staged hook handles `pnpm-lock.yaml` automatically; `package-lock.json` must be regenerated manually.

## Why not static export?

`output: 'export'` in `next.config.mjs` requires every dynamic route to export `generateStaticParams`. The app has routes like `/boards/[boardId]/[postId]` that fetch data at request time — adding `generateStaticParams` to all of them would require a full data snapshot at build time and break incremental updates. App Hosting (SSR) is the correct deployment target.

## Rollback

To roll back to a previous build:

```bash
firebase apphosting:rollouts:list --project jacob-staging-494515 --backend default
firebase apphosting:rollouts:create --project jacob-staging-494515 --backend default --build <BUILD_ID>
```
