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
