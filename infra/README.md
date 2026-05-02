# JACOB infrastructure

Terraform manages every GCP resource that's not the Cloud Run service image
itself (those come from the GitHub Actions deploy workflow). One module,
multiple environments — pass `-var-file=terraform.<env>.tfvars`.

## Bootstrapping a fresh environment

State lives in a GCS bucket. Create it before the first `terraform init`:

```sh
ENV=staging   # or production
PROJECT=jacob-${ENV}-494515

gcloud storage buckets create gs://jacob-tf-state-${ENV} \
  --project=${PROJECT} \
  --location=US \
  --uniform-bucket-level-access
gcloud storage buckets update gs://jacob-tf-state-${ENV} --versioning
```

Then:

```sh
cd infra
terraform init -backend-config="bucket=jacob-tf-state-${ENV}"
terraform plan -var-file=terraform.${ENV}.tfvars
terraform apply -var-file=terraform.${ENV}.tfvars
```

The `.terraform.lock.hcl` is committed; `terraform init` will pull the same
provider versions on every machine.

## Service accounts (I1)

`service_accounts.tf` defines five least-privilege SAs. The default Compute
Engine SA is **not** used by any JACOB workload.

| SA email                                             | Purpose                                  |
|------------------------------------------------------|------------------------------------------|
| `jacob-api@${project}.iam.gserviceaccount.com`       | FastAPI Cloud Run service                |
| `jacob-moderation@${project}.iam.gserviceaccount.com`| Image-moderation pipeline (only writer to public bucket) |
| `jacob-backup@${project}.iam.gserviceaccount.com`    | `firestore_export` Cloud Run job         |
| `jacob-scheduler-export@${project}.iam.gserviceaccount.com` | OIDC identity for Cloud Scheduler firestore-export job |
| `jacob-scheduler-deletions@${project}.iam.gserviceaccount.com` | OIDC identity for Cloud Scheduler finalize-deletions job |
| `jacob-analytics@${project}.iam.gserviceaccount.com` | BigQuery reader for the FastAPI analytics endpoint (T29) |
| `jacob-scheduler-analytics@${project}.iam.gserviceaccount.com` | OIDC identity for Cloud Scheduler firestore-to-bigquery job (T29) |

Wire them into `terraform.<env>.tfvars` after the first apply — the module
emits each email as a Terraform output.

`github-deploy@…` (defined in `wif.tf`) is the CI deploy identity; it has
project-wide `roles/iam.serviceAccountUser` so it can act-as any of the
runtime SAs at deploy time.

## Cloud Scheduler jobs (M4, T29)

`scheduler.tf` defines `firestore-export-daily` (03:00 UTC),
`finalize-deletions-daily` (03:30 UTC), and
`firestore-to-bigquery-daily` (04:30 UTC, T29). Each invokes its corresponding
Cloud Run Job via OIDC; the OIDC SA has `roles/run.invoker` only on the
specific job (IAM condition).

**Cloud Run Jobs (not Services)** must be created out-of-band before the
Scheduler resource can succeed: the scheduler URI references
`/jobs/<name>:run`. Initial deploy:

```sh
gcloud run jobs deploy firestore-export \
  --image us-central1-docker.pkg.dev/${PROJECT}/jacob-images/firestore-export:latest \
  --region us-central1 --service-account jacob-backup@${PROJECT}.iam.gserviceaccount.com
```

(see `infra/scheduled/firestore_export.py` for the job code).

## Custom domain (I2 — deferred)

The backend currently reachable at `jacob-backend-…run.app` will move to
`api.jacob.app` once a domain is registered. Steps when ready:

1. Register `jacob.app` (or whatever subdomain is chosen) at any registrar.
2. Cloud Run domain mapping:
   ```sh
   gcloud run domain-mappings create \
     --service jacob-backend \
     --domain api.jacob.app \
     --region us-central1
   ```
3. Add the CNAME / A records the command returns to your DNS provider.
   Cloud Run will provision a managed TLS cert automatically.
4. Update `backend_host` in tfvars to `api.jacob.app`.
5. Update `NEXT_PUBLIC_API_URL` in the frontend deploy config.
6. Update CORS allowlist in `backend/app/main.py` if applicable.

This work is **not currently in Terraform** because we don't yet own a
domain. Adding the `google_cloud_run_domain_mapping` resource is a
one-liner once we do.

## Custom roles

`buckets.tf` defines `publicObjectReader` — a custom role granting only
`storage.objects.get` (no `objects.list`). Used so the public media
bucket isn't enumerable.

## Common operations

- Plan only: `terraform plan -var-file=terraform.staging.tfvars`
- Apply selected resources: `terraform apply -target=module... -var-file=...`
- Read an output: `terraform output api_service_account_email`
- Re-key WIF: `terraform taint google_iam_workload_identity_pool_provider.github_oidc && terraform apply ...`
