# Phase 1 — Deferred findings

Items from the May 2026 codebase review that require design decisions, schema
migrations, or multi-PR refactors. Each entry records what work is needed so
these can be picked up as discrete Phase 2 tasks.

## Resolved (Phase 2)

- **M4 — Cloud Scheduler IAM/OIDC Terraform** — landed in the
  *infra-hardening* PR. `infra/scheduler.tf` defines both jobs with
  per-job dedicated OIDC SAs (`jacob-scheduler-export`,
  `jacob-scheduler-deletions`) and `roles/run.invoker` scoped to the
  specific Cloud Run job via IAM condition.
- **L7 — Terraform remote state + provider pins** — landed in the
  *infra-hardening* PR. `infra/backend.tf` (GCS backend) and
  `infra/versions.tf` (`~> 7.0` provider pins) added; `.terraform.lock.hcl`
  committed; `infra/README.md` documents bucket creation.
- **I1 — Dedicated least-privilege SAs** — landed in the *infra-hardening*
  PR. `infra/service_accounts.tf` defines `jacob-api`, `jacob-moderation`,
  `jacob-backup`, plus the two scheduler SAs above. Bucket bindings in
  `buckets.tf` already reference these via tfvars; switch is one tfvars
  edit + `terraform apply`.
- **I2 — Custom domain** — documented in `infra/README.md` only; actual
  DNS work deferred until a domain is registered. The Terraform diff is a
  single `google_cloud_run_domain_mapping` resource away.
- **M5 — Dockerfile base image pinned by digest** — landed in the
  *deferred-misc* PR. `backend/Dockerfile` now pins `python:3.12-slim` by
  manifest digest; Dependabot (`/backend` docker ecosystem) already
  monitors the digest weekly.
- **M6 — Cloud Functions deploy lockfile** — landed in the
  *deferred-misc* PR. `functions/package-lock.json` is committed; Firebase
  deploy reproducibly installs the same dependency tree as local dev.

## Punted

- **M8 — Restore drill timing** — operational task, not a code change.
  Requires GCP access plus a staging-restore window to fill in the timing
  table in `docs/runbooks/restore.md`. Owner: project owner. Once the
  drill is run, append a "Resolved" entry here pointing at the timing
  commit.

---

## M1 — Group can be left leaderless after leader self-demote or leave

**Finding:** A leader can update their own member doc to role `member`, or
delete their own member doc, leaving a group with zero leaders. Leaderless
groups cannot rotate invites, edit metadata, or moderate.

**What is required:**
1. Denormalize `leaderCount: number` onto `groups/{gid}` (backend writes only,
   admin SDK; clients cannot write it).
2. Update `onMessageWrite.ts` (or add a new Cloud Function trigger) to keep
   `leaderCount` in sync when member docs are written or deleted.
3. Add a Firestore rule on `groups/{gid}/members/{uid}` update/delete that
   reads `get(groups/{gid}).data.leaderCount` and rejects the write if it would
   drop to zero.
4. Add rules-emulator tests for the leader-count guard.

**Complexity:** Medium — schema change + Cloud Function + rule update.

---

## M4 (partial) — Cloud Scheduler jobs lack Terraform IAM / OIDC config

**Finding:** The Cloud Scheduler jobs that trigger `firestore_export` and
`finalize_deletions` are created by hand in the console, running as the default
Compute Engine service account (project-Editor). No Terraform resource defines
them, so the SA email and OIDC config are undocumented.

**What is required:**
1. Add `google_cloud_scheduler_job` Terraform resources in `infra/` for both
   jobs with `oidc_token.service_account_email` pointing at a dedicated
   least-privilege SA (not the Compute SA).
2. Add `roles/run.invoker` IAM binding for each job's SA against the target
   Cloud Run service.
3. Document the SA email in `infra/README.md` and the relevant runbooks.

**Complexity:** Low-medium — pure Terraform, no code changes.

---

## M5 (partial) — Dockerfile base image not pinned by digest

**Finding:** `FROM python:3.12-slim` uses a mutable tag. A supply-chain
compromise of that image tag would silently affect all builds.

**What is required:**
Run `docker pull python:3.12-slim` and `docker inspect --format='{{index
.RepoDigests 0}}' python:3.12-slim` to get the current digest, then replace
the `FROM` line in `backend/Dockerfile` with e.g.:
`FROM python:3.12-slim@sha256:<digest>`.
Set a calendar reminder to re-pin quarterly (or rely on Dependabot docker
updates, which are already configured in `.github/dependabot.yml`).

**Complexity:** Trivial — one-line change, needs docker access.

---

## M6 — Cloud Functions deploy uses npm-install-on-deploy, not workspace lockfile

**Finding:** `firebase deploy --only functions` runs `npm install` from
`functions/package.json` on Firebase's build servers, ignoring the root
`pnpm-lock.yaml`. Caret dependencies can resolve differently in prod.

**What is required:**
Option A (simpler): commit `functions/package-lock.json` by running
`npm install` inside `functions/` and committing the result. Firebase deploy
will honour it.
Option B (cleaner): add a `predeploy` hook in `firebase.json` that runs
`pnpm --filter jacob-functions install --frozen-lockfile` and bundles the
output so Firebase just copies files rather than re-installing.

**Complexity:** Low — option A is a single `npm install + git add`.

---

## M8 — Restore runbook has not been dry-run-tested; timing rows blank

**Finding:** `docs/runbooks/restore.md` has placeholder timing entries that
were supposed to be filled in after a staging restore drill (T16 acceptance
criterion).

**What is required:**
Run a complete restore against `jacob-staging-494515`:
1. Trigger an export manually from Cloud Scheduler or `python firestore_export.py`.
2. Follow every step in `docs/runbooks/restore.md`.
3. Record actual durations in the timing table.
4. Commit the filled-in runbook.

**Complexity:** Operational — no code change, requires GCP access.

---

## M9 — Frontend tests over-mock Firestore; no emulator integration tests

**Finding:** All frontend tests mock `firebase/firestore` entirely. A
security-rule rejection is invisible to these tests.

**What is required:**
Add 1–2 vitest specs under `frontend/tests/integration/` that:
- Import the real Firestore SDK pointed at `localhost:8080` (emulator).
- Use the same `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` path that local dev uses.
- Exercise send-message + read-message as an authenticated user.
- Assert that a message written by user A cannot be read by a non-member.
These should run inside `firebase emulators:exec` (same as `firestore/tests/`).

**Complexity:** Medium — requires test harness wiring and emulator token setup.

---

## M10 (partial) — Test coverage gaps

Several gaps identified in the review that are not yet covered:

| Gap | Where to add |
|-----|-------------|
| `@limiter.limit(UPLOAD_INIT)` decorator is applied (not just constant value) | `backend/tests/test_rate_limits.py` — force-remove decorator and assert 429 vanishes |
| Cloud Function `onMessageWrite.ts` — no tests at all | `functions/src/__tests__/onMessageWrite.test.ts` |
| `useUser.ts` auth-state-change → cookie race | `frontend/tests/` — requires emulator or mock timing |
| Minor-user rules, expired ban rules | `firestore/tests/` |

---

## M11 — `groupIds` field on `users/{uid}` is schema drift

**Finding:** The backend writes `groupIds` via `ArrayUnion` but this field is
not in the canonical schema in `CLAUDE.md` or `docs/data-model.md`. The client
can also write it (rules only block specific named fields).

**What is required (H12 companion):**
Either (a) remove `groupIds` from the user doc and derive group membership from
the `groups/{gid}/members/{uid}` subcollection (the correct source of truth), or
(b) lock `groupIds` in the Firestore rule (`changedKeys().hasOnly([...])` list)
and document it in the schema. Option (a) is the clean fix but requires updating
`useGroups.ts` hook.

**Complexity:** Medium — frontend hook change + rules change + migration.

---

## M12 — `useRecentMessages` N+1 reads per group on every mount

**Finding:** `frontend/lib/hooks/useRecentMessages.ts` issues one independent
`getDocs` per group on mount, with no caching. A user in 12 groups pays 12
read round-trips on every navigate.

**What is required:**
Either:
- Wrap in SWR or React Query with a stable cache key, or
- Add a collection-group read rule for `messages` (requires an ADR — it crosses
  the group permission boundary) and merge into a single query.
The SWR option is purely additive and is the recommended first step.

**Complexity:** Low-medium (SWR option) / High (collection-group query option).

---

## L7 — No Terraform remote state, lockfile, or provider pins

**Finding:** `infra/` has no `backend.tf`, no `versions.tf`, and no
`.terraform.lock.hcl`. Local state is used, meaning two engineers applying
from different machines will diverge.

**What is required:**
1. Create `infra/backend.tf` with `backend "gcs" { bucket = "jacob-tf-state-<env>"; prefix = "terraform/state" }`.
2. Create `infra/versions.tf` pinning the `google` and `google-beta` providers.
3. Run `terraform init` and commit `.terraform.lock.hcl`.
4. Document the bucket creation step in `infra/README.md`.

**Complexity:** Low — infrastructure setup, no app code changes.

---

## I1 — All services run as default Compute SA; need dedicated least-privilege SAs

**Finding:** Three Terraform variables — `api_service_account_email`,
`backup_service_account_email`, and `moderation_service_account_email` — all
currently use the default Compute Engine SA
(`732806466572-compute@developer.gserviceaccount.com`) as a temporary value.
The default Compute SA carries project-Editor-equivalent permissions by default,
violating least privilege.

**Priority order (highest first):**

1. **`moderation_service_account_email` — MOST URGENT.** This SA is the sole
   writer to the public media bucket (`roles/storage.objectAdmin` on
   `jacob-media-public-*`) and has read access to the quarantine bucket. Any
   compromise of the default Compute SA means arbitrary content can be published
   to the public bucket. Create `jacob-moderation@jacob-staging-494515.iam.gserviceaccount.com`
   with only `roles/storage.objectViewer` on quarantine and
   `roles/storage.objectAdmin` on the public bucket.

2. **`api_service_account_email`** — the Cloud Run backend SA. Replace with
   `jacob-api@jacob-staging-494515.iam.gserviceaccount.com` bound to:
   `roles/datastore.user`, `roles/storage.objectAdmin` on quarantine,
   `roles/logging.logWriter`, `roles/cloudtrace.agent`.

3. **`backup_service_account_email`** — the `firestore_export` Cloud Run job SA.
   Replace with `jacob-backup@jacob-staging-494515.iam.gserviceaccount.com`
   bound to `roles/storage.objectAdmin` on the backup bucket and
   `roles/datastore.importExportAdmin`.

**Additional steps for `api_service_account_email`:**
- Update the Cloud Run service config (`gcloud run services update jacob-backend --service-account=jacob-api@...`).
- Grant `jacob-deployer@...` `roles/iam.serviceAccountUser` on the new SA so CI can deploy.

**Complexity:** Medium — IAM + Cloud Run config change, no application code
changes, but needs careful role enumeration to avoid breaking the backend.

---

## I2 — Backend uses auto-generated Cloud Run hostname; needs a custom domain

**Finding:** The backend is currently reachable only at the auto-generated URL
`jacob-backend-7fk543coqq-uc.a.run.app`. This URL changes if the service is
ever recreated, looks untrustworthy to end users and third-party services (e.g.,
SendGrid webhook validation), and makes the `backend_host` Terraform variable
brittle.

**What is required:**
1. Register or delegate a subdomain, e.g. `api.jacob.app`, in your DNS provider.
2. Map the domain via Cloud Run domain mapping:
   `gcloud run domain-mappings create --service jacob-backend --domain api.jacob.app --region us-central1`.
3. Add the DNS records Cloud Run returns (CNAME or A records) to your DNS
   provider; Cloud Run will provision a managed TLS cert automatically.
4. Update the `backend_host` Terraform variable value to `api.jacob.app`.
5. Update any CORS allowlists or environment variables that reference the old
   Cloud Run URL.

**Complexity:** Low-medium — DNS + Cloud Run config, no application code changes.
Requires ownership of the `jacob.app` domain (or whatever subdomain is chosen).
