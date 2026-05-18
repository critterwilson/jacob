# JACOB

Small-group messaging for Christian communities — Phase 1 monorepo.

*Joint Asynchronous Congregation of Believers.*

```
frontend/    Next.js 14 (App Router, TypeScript, Tailwind) → Firebase App Hosting
backend/     FastAPI (Python 3.12)                         → Cloud Run
functions/   Cloud Functions for Firebase (TypeScript v2)  → Firebase Functions
firestore/   Security rules + indexes + rule tests
```

---

## Prerequisites

Install these tools before running anything locally.

| Tool | Version | Install |
|---|---|---|
| Node.js | 20 LTS | `brew install fnm && fnm install 20` |
| pnpm | 10.x | `npm install -g pnpm@10` |
| Python | 3.12 | `brew install python@3.12` |
| uv | latest | `pip install uv` |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| gcloud CLI | latest | `brew install google-cloud-sdk` |
| Firebase CLI | latest | `npm install -g firebase-tools` |
| Java (JDK 21) | 21+ | `brew install openjdk@21` |

> Java is required only for the Firebase emulators.

---

## One-time setup

### 1 — Firebase projects

You'll need two Firebase projects (staging + production). Create them at
https://console.firebase.google.com and enable:

- **Firestore** (Native mode, region `nam5`)
- **Authentication**
- **App Hosting** (under "Build")

The project IDs in `.firebaserc` are already set to `jacob-staging-494515`
and `jacob-494515` — replace them if you're forking the repo.

### 2 — Authenticate local tooling

```bash
gcloud auth login
gcloud auth application-default login
firebase login
```

### 3 — Create the Artifact Registry repository (once per GCP project)

Used by the backend image. Run for both staging and production GCP projects:

```bash
gcloud artifacts repositories create jacob-images \
  --repository-format=docker \
  --location=us-central1 \
  --project=YOUR_PROJECT_ID
```

### 4 — Create the App Hosting backend (once per Firebase project)

App Hosting deploys the Next.js frontend straight from GitHub. For each
Firebase project, run:

```bash
firebase apphosting:backends:create \
  --project YOUR_FIREBASE_PROJECT_ID \
  --location us-central1
```

The wizard will prompt you to:
1. Connect this GitHub repository.
2. Set the **root directory** to `frontend`.
3. Set the **live branch** to `main` (staging) or your prod branch.
4. Pick or grant the GitHub App permissions.

Once created, every push to the live branch builds and rolls out
automatically. The runtime config (instance limits, env vars) lives in
[`frontend/apphosting.yaml`](frontend/apphosting.yaml) — edit and commit
to change it.

### 5 — Install Node dependencies and generate the lockfile

```bash
pnpm install        # generates pnpm-lock.yaml — commit this file
```

### 6 — Install Python dependencies

```bash
cd backend
uv pip install --system -e ".[dev]"
```

### 7 — Configure frontend env vars

```bash
cp frontend/.env.example frontend/.env.local
# Then fill in NEXT_PUBLIC_FIREBASE_* values from the Firebase Console.
```

For App Hosting backends, set the same env vars in the Firebase Console
(App Hosting → backend → environment) or with
`firebase apphosting:secrets:set`. Values are inlined into the client
bundle at build time, so they must be present when the backend builds.

---

## Running locally

### Frontend

```bash
cd frontend
pnpm dev
# http://localhost:3000
```

To point Auth + Firestore at the local emulator instead of the live
Firebase project, set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` in
`.env.local` and start the emulators (below).

### Backend

```bash
cd backend
uvicorn app.main:app --reload
# http://localhost:8000
# Health check: GET /health → {"status":"ok"}
```

### Firebase emulators (Auth + Firestore + Functions)

```bash
firebase emulators:start
# UI: http://localhost:4000
# Auth:      localhost:9099
# Firestore: localhost:8080
# Functions: localhost:5001
```

(There's no hosting emulator: the frontend dev server is `pnpm dev` above,
and App Hosting has no local emulator — it runs `next dev` the same way.)

---

## Running tests

### Frontend (vitest)

```bash
pnpm --filter jacob-frontend test
```

### Backend (pytest)

```bash
cd backend && pytest
```

### Firestore rules (vitest + emulator)

```bash
firebase emulators:exec --only firestore --project demo-jacob \
  "pnpm --filter jacob-firestore test"
```

### Functions (tsc only at scaffold stage)

```bash
pnpm --filter jacob-functions build
```

---

## CI/CD

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Every PR against `main` | Lint + type-check + test all services |
| `deploy.yml` | Push to `main` | Auto-deploys **staging** |
| `deploy.yml` | Manual (`workflow_dispatch`) | Deploys **production** on request |

The deploy workflow has two parallel jobs:
- **deploy-backend** — builds the Docker image, pushes to Artifact Registry, deploys to Cloud Run
- **deploy-firebase** — builds Cloud Functions, then runs `firebase deploy --only functions,firestore`

The **frontend deploys outside CI**: Firebase App Hosting watches the live
branch on GitHub and rolls out a new revision automatically on each push.
There is no `firebase deploy --only hosting` step.

### GitHub Actions secrets

Create these in **Settings → Secrets and variables → Actions** on your GitHub repo.

**Repository-level secret** (shared between staging and prod):

| Secret | How to get it |
|---|---|
| `FIREBASE_TOKEN` | Run `firebase login:ci` locally and copy the printed token |

**GitHub Environment secrets** — create two Environments (`staging` and `production`) in **Settings → Environments**, then add these to each:

| Secret | How to get it |
|---|---|
| `GCP_PROJECT_ID` | Your GCP project ID (e.g. `jacob-staging-abc123`) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Output of `terraform apply infra/wif.tf` — see `infra/wif.tf` for setup instructions |
| `GCP_SERVICE_ACCOUNT` | Output of `terraform apply infra/wif.tf` — the deploy SA email |

> CI authenticates via Workload Identity Federation (no long-lived JSON keys). Run `terraform -chdir=infra apply` once to provision the WIF pool; see `infra/wif.tf` for the full procedure.

#### Required: production environment branch protection

The `production` GitHub Environment **must** be configured to prevent arbitrary branches from deploying to production:

1. Go to **Settings → Environments → production**.
2. Under **Deployment branches**, select **Selected branches** and add `main`.
3. Optionally add required reviewers for an approval gate before production deploys.

Without this, any contributor with `write` access can trigger a production deploy from any branch via the `workflow_dispatch` "Run workflow" UI.

---

## Architecture notes

- Real-time chat and all end-user reads/writes go **directly through the Firestore client SDK** — there is no API gateway in front of Firestore.
- The FastAPI backend handles only server-trusted work: auth token verification, image moderation, admin actions, account lifecycle.
- Cloud Functions handle Firestore-triggered fan-out (e.g. `threadReplyCount` increments in T09+).
- **Storage note**: user uploads use **Cloud Storage** directly via backend-issued signed URLs (see `infra/buckets.tf`). There is no `firebase.json` `storage` block and no `storage.rules` file — those would control Firebase Storage, which is a different product and is not used here. Do not add a `storage.rules` file expecting it to protect the upload buckets.
- See `CLAUDE.md` for full conventions and `DEV_PLAN.md` for the Phase 1 task list.

---

## Repo conventions

- **`pnpm-lock.yaml` must be committed**: run `pnpm install` after first clone and commit the generated lockfile so CI's `--frozen-lockfile` flag works.
