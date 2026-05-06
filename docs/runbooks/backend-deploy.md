# Backend Deploy Runbook — Cloud Run

The FastAPI backend (`jacob-backend`) deploys to Cloud Run from
`.github/workflows/deploy.yml` on every push to `main` (staging) or via
manual workflow dispatch (production).

## Required env vars

Set on the Cloud Run service by the deploy job. The backend boots with
`environment != "development"` and a fail-closed CORS allowlist (see
`backend/app/config.py:cors_allowed_origins`), so a missing var makes
every cross-origin `/api/*` call fail with `Disallowed CORS origin`.

| Var                    | Staging source                              | Production source                              |
|------------------------|---------------------------------------------|------------------------------------------------|
| `ENVIRONMENT`          | Workflow (`staging`)                        | Workflow (`production`)                        |
| `CORS_ALLOWED_ORIGINS` | Hardcoded in `deploy.yml` (non-secret URLs) | GitHub Environment secret `CORS_ALLOWED_ORIGINS` |

The staging value is hardcoded because the URLs are public and an empty
secret historically caused a SEV2 (every bootstrap call CORS-blocked).
Production must stay sourced from the secret so a misconfigured prod
deploy fails closed instead of inheriting staging origins.

## Comma-in-value gotcha

`gcloud run deploy --set-env-vars KEY1=VAL1,KEY2=VAL2` uses `,` as the
key separator, so any value containing a comma (like a multi-origin CORS
list) needs the alternate-delimiter syntax: `--set-env-vars "^@^KEY1=...@KEY2=..."`.
The deploy workflow already uses this; one-off `gcloud run services
update` commands need it too.

## Manual one-off update

```bash
gcloud run services update jacob-backend \
  --region us-central1 \
  --project jacob-staging-494515 \
  --update-env-vars '^@^CORS_ALLOWED_ORIGINS=https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app,https://jacob.app,http://localhost:3000'
```

## Source of truth for service config (H4)

`infra/cloud-run.tf` declares the Cloud Run service shape (CPU, memory,
concurrency, max-instances, request timeout, service account, traffic
target). Treat that file as the source of truth for **everything except
the image SHA and per-deploy env vars**:

| Owns                                                      | Where it lives                                           |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Service shape (CPU, memory, concurrency, max-instances)   | `infra/cloud-run.tf` → `terraform plan && terraform apply` |
| Min-instances (cold-start vs cost trade-off, see H3)      | `var.cloudrun_min_instances` in `cloud-run.tf`           |
| Service account binding                                   | `infra/cloud-run.tf`                                     |
| Public unauthenticated invocation (`allow-unauthenticated`) | `cloud-run.tf` `google_cloud_run_v2_service_iam_member`  |
| Image SHA per deploy                                      | `gcloud run deploy` step in `.github/workflows/deploy.yml` |
| Per-deploy env vars (`ENVIRONMENT`, `CORS_ALLOWED_ORIGINS`) | `--set-env-vars` step in `deploy.yml`                    |

The split is intentional: the gcloud step rolls images on every CI run,
which would otherwise fight Terraform's image attribute. The TF
`lifecycle.ignore_changes` block on the service resource protects the
image / env / labels fields from being reverted by a Terraform apply.

### One-time import

The Cloud Run service was originally created by gcloud, so before
`terraform apply` works on this resource, the service has to be imported
into state:

```bash
cd infra
terraform import google_cloud_run_v2_service.backend \
  projects/${PROJECT_ID}/locations/us-central1/services/jacob-backend
terraform import google_cloud_run_v2_service_iam_member.backend_public \
  projects/${PROJECT_ID}/locations/us-central1/services/jacob-backend roles/run.invoker allUsers
```

After importing, run `terraform plan` and confirm the diff is empty (or
only contains drift you deliberately want to converge). If it shows
unexpected changes, investigate before applying — the imported defaults
may differ from what `cloud-run.tf` declares.

### Changing min-instances

To enable warm instances (eliminates cold-start tax, costs ~$15/mo per
H3 in the codebase review):

```bash
cd infra
terraform apply -var=cloudrun_min_instances=1
```

Default is 0 (scale to zero). Flip per the user's "no costs" policy when
the SLO requires it.
