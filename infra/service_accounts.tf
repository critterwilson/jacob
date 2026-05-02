/**
 * Dedicated, least-privilege service accounts (I1).
 *
 * Replaces the placeholder use of the default Compute Engine SA, which
 * carries project-Editor permissions and is therefore unsafe for
 * service-to-service identity.
 *
 * Naming convention: `jacob-<role>@${project_id}.iam.gserviceaccount.com`.
 *
 * Wiring after `terraform apply`:
 *   1. Read the four SA emails from the outputs of this module.
 *   2. Update `terraform.<env>.tfvars` to set:
 *        api_service_account_email        = <jacob-api email>
 *        moderation_service_account_email = <jacob-moderation email>
 *        backup_service_account_email     = <jacob-backup email>
 *      buckets.tf's `iam_binding`s will then bind the public/quarantine/
 *      backup buckets to the new SAs (one apply cycle, atomic switch).
 *   3. Update Cloud Run service config to run as `jacob-api`:
 *        gcloud run services update jacob-backend --service-account=<jacob-api email> --region=us-central1
 *   4. Update Cloud Run job config for firestore_export to run as
 *      `jacob-backup`.
 *
 * Cloud Scheduler OIDC identities (one per job, M4) are defined in
 * `scheduler.tf` and live as separate SAs from the runtime job SAs so
 * the scheduler invocation surface is independent of the job runtime
 * permissions.
 *
 * The `github-deploy` CI SA (defined in wif.tf) already has project-wide
 * `roles/iam.serviceAccountUser`, so it can act-as any of these SAs at
 * deploy time — no additional bindings needed here.
 *
 * Bucket-level role bindings (objectAdmin / objectViewer) live in
 * `buckets.tf` and reference the SA emails via the matching tfvar so
 * Terraform doesn't end up with two competing authoritative bindings.
 */

# ── runtime SAs ───────────────────────────────────────────────────────────────

resource "google_service_account" "jacob_api" {
  project      = var.project_id
  account_id   = "jacob-api"
  display_name = "JACOB API (Cloud Run backend)"
  description  = "Runtime SA for the FastAPI service."
}

resource "google_service_account" "jacob_moderation" {
  project      = var.project_id
  account_id   = "jacob-moderation"
  display_name = "JACOB moderation pipeline"
  description  = "Sole writer to the public media bucket. Compromise can publish arbitrary content."
}

resource "google_service_account" "jacob_backup" {
  project      = var.project_id
  account_id   = "jacob-backup"
  display_name = "JACOB backup (firestore_export)"
  description  = "Runtime SA for the firestore_export Cloud Run job."
}

# ── Cloud Scheduler OIDC identities (one per job, M4) ─────────────────────────

resource "google_service_account" "jacob_scheduler_export" {
  project      = var.project_id
  account_id   = "jacob-scheduler-export"
  display_name = "JACOB Scheduler — firestore_export"
  description  = "OIDC identity used by Cloud Scheduler to invoke the firestore_export Cloud Run job."
}

resource "google_service_account" "jacob_scheduler_deletions" {
  project      = var.project_id
  account_id   = "jacob-scheduler-deletions"
  display_name = "JACOB Scheduler — finalize_deletions"
  description  = "OIDC identity used by Cloud Scheduler to invoke the finalize_deletions Cloud Run job."
}

# ── project-level role bindings (non-bucket): jacob-api ──────────────────────
#
# Bucket bindings live in buckets.tf — see comment above.

resource "google_project_iam_member" "jacob_api_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.jacob_api.email}"
}

resource "google_project_iam_member" "jacob_api_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.jacob_api.email}"
}

resource "google_project_iam_member" "jacob_api_trace" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.jacob_api.email}"
}

resource "google_project_iam_member" "jacob_api_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.jacob_api.email}"
}

# Allows the api SA to verify Firebase ID tokens.
resource "google_project_iam_member" "jacob_api_firebase_admin" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.jacob_api.email}"
}

# ── project-level role bindings: jacob-moderation ────────────────────────────

resource "google_project_iam_member" "jacob_moderation_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.jacob_moderation.email}"
}

resource "google_project_iam_member" "jacob_moderation_vision" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.jacob_moderation.email}"
}

# ── project-level role bindings: jacob-backup ────────────────────────────────

resource "google_project_iam_member" "jacob_backup_export_admin" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.jacob_backup.email}"
}

resource "google_project_iam_member" "jacob_backup_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.jacob_backup.email}"
}

# ── outputs (consumed by tfvars + Cloud Run config) ──────────────────────────

output "api_service_account_email" {
  value       = google_service_account.jacob_api.email
  description = "Use this for `api_service_account_email` in tfvars."
}

output "moderation_service_account_email" {
  value       = google_service_account.jacob_moderation.email
  description = "Use this for `moderation_service_account_email` in tfvars."
}

output "backup_service_account_email" {
  value       = google_service_account.jacob_backup.email
  description = "Use this for `backup_service_account_email` in tfvars."
}

output "scheduler_export_service_account_email" {
  value       = google_service_account.jacob_scheduler_export.email
  description = "OIDC identity for the Cloud Scheduler firestore_export job."
}

output "scheduler_deletions_service_account_email" {
  value       = google_service_account.jacob_scheduler_deletions.email
  description = "OIDC identity for the Cloud Scheduler finalize_deletions job."
}
