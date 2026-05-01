# JACOB

Small-group messaging for Christian communities — Phase 1 monorepo.

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
| pnpm | 9.x | `npm install -g pnpm@9` |
| Python | 3.12 | `brew install python@3.12` |
| uv | latest | `pip install uv` |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| gcloud CLI | latest | `brew install google-cloud-sdk` |
| Firebase CLI | latest | `npm install -g firebase-tools` |
| Java (JDK 17) | 17+ | `brew install openjdk@17` |

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

---

## Running locally

### Frontend

```bash
cd frontend
pnpm dev
# http://localhost:3000
```

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
| `GCP_SA_KEY` | Base64-encoded JSON key for a GCP service account with `roles/run.admin`, `roles/iam.serviceAccountUser`, and `roles/artifactregistry.writer`. Generate with `gcloud iam service-accounts keys create key.json --iam-account=SA_EMAIL && base64 -i key.json` |

> The service account also needs `roles/run.invoker` removed if you want the Cloud Run service to be publicly accessible (the default `--allow-unauthenticated` flag handles this at deploy time, but the SA needs `roles/iam.serviceAccountUser` to set the IAM policy).

---

## Architecture notes

- Real-time chat and all end-user reads/writes go **directly through the Firestore client SDK** — there is no API gateway in front of Firestore.
- The FastAPI backend handles only server-trusted work: auth token verification, image moderation, admin actions, account lifecycle.
- Cloud Functions handle Firestore-triggered fan-out (e.g. `threadReplyCount` increments in T09+).
- See `CLAUDE.md` for full conventions and `DEV_PLAN.md` for the Phase 1 task list.

---

## Repo conventions

- **`pnpm-lock.yaml` must be committed**: run `pnpm install` after first clone and commit the generated lockfile so CI's `--frozen-lockfile` flag works.
