/**
 * Terraform remote state — GCS backend.
 *
 * State lives in the bucket `jacob-tf-state-${env}` under the
 * `terraform/state` prefix. Bucket must be created manually before the
 * first `terraform init`:
 *
 *   gcloud storage buckets create gs://jacob-tf-state-staging \
 *     --location=US --uniform-bucket-level-access \
 *     --enable-object-retention=false
 *   gcloud storage buckets update gs://jacob-tf-state-staging --versioning
 *
 * State buckets are intentionally NOT managed by this Terraform — they
 * have to exist before the backend can be initialised, and we do not
 * want a single `terraform destroy` to evaporate our state.
 *
 * Override the bucket name when initialising for a different env:
 *
 *   terraform init -backend-config="bucket=jacob-tf-state-production"
 *
 * Document the matching bucket per env in `infra/README.md`.
 */

terraform {
  backend "gcs" {
    bucket = "jacob-tf-state-staging"
    prefix = "terraform/state"
  }
}
