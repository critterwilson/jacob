/**
 * BigQuery dataset, service account, and IAM bindings for T29 analytics.
 *
 * Data is loaded by the firestore-to-bigquery Cloud Run job
 * (infra/scheduled/firestore_to_bigquery.py), which writes native per-date
 * tables `messages_raw_YYYYMMDD` from the daily Firestore export in GCS.
 *
 * NOTE: the old `messages_raw_external` external table was removed — its
 * source URI used an unsupported double wildcard and it duplicated the job's
 * native tables. The SQL views in infra/bigquery/views.sql still read from it
 * and are therefore stale; repoint them at `messages_raw_*` before running
 * them if/when analytics is activated. See docs/runbooks/bigquery-export.md.
 */

variable "bq_location" {
  description = "BigQuery dataset location. Must be in the same region as the GCS backup bucket."
  type        = string
  default     = "US"
}

variable "bq_backups_bucket" {
  description = "GCS bucket name that holds daily Firestore exports (e.g. jacob-backups-staging)."
  type        = string
  default     = ""
}

# ── Dataset ───────────────────────────────────────────────────────────────────

resource "google_bigquery_dataset" "jacob_analytics" {
  project                    = var.project_id
  dataset_id                 = "jacob_analytics"
  friendly_name              = "JACOB Analytics"
  description                = "Sticker analytics views built over the daily Firestore export."
  location                   = var.bq_location
  delete_contents_on_destroy = false

  # Cost guardrail: reap partitions older than 90 days from any partitioned
  # table in this dataset. default_PARTITION (not default_table) expiration, so
  # it never reaps whole tables or views. NOTE: today's firestore-to-bigquery
  # loader writes per-date NON-partitioned tables (messages_raw_YYYYMMDD), which
  # this does not touch — it's a forward-looking safety net for if the loader
  # moves to a single date-partitioned table.
  default_partition_expiration_ms = 7776000000 # 90 days

  labels = {
    env = var.env
  }
}

# ── Service account ───────────────────────────────────────────────────────────

resource "google_service_account" "jacob_analytics" {
  project      = var.project_id
  account_id   = "jacob-analytics"
  display_name = "JACOB Analytics (BigQuery reader)"
  description  = "Used by the FastAPI analytics endpoint to run BigQuery queries."
}

resource "google_bigquery_dataset_iam_member" "analytics_data_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.jacob_analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.jacob_analytics.email}"
}

resource "google_project_iam_member" "analytics_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.jacob_analytics.email}"
}

# ── Scheduler service account ─────────────────────────────────────────────────

resource "google_service_account" "jacob_scheduler_analytics" {
  project      = var.project_id
  account_id   = "jacob-scheduler-analytics"
  display_name = "JACOB Scheduler — firestore-to-bigquery"
  description  = "OIDC identity for Cloud Scheduler firestore-to-bigquery job."
}

resource "google_project_iam_member" "scheduler_analytics_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_analytics.email}"

  condition {
    title      = "only firestore-to-bigquery Cloud Run job"
    expression = "resource.name.endsWith(\"/firestore-to-bigquery\")"
  }
}

# ── Storage viewer for backups bucket ─────────────────────────────────────────

resource "google_storage_bucket_iam_member" "analytics_backups_viewer" {
  bucket = var.bq_backups_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.jacob_analytics.email}"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "analytics_service_account_email" {
  value       = google_service_account.jacob_analytics.email
  description = "SA for the analytics BigQuery queries (add to Cloud Run env as BQ_SA_EMAIL)."
}

output "analytics_scheduler_service_account_email" {
  value       = google_service_account.jacob_scheduler_analytics.email
  description = "OIDC identity for the Cloud Scheduler firestore-to-bigquery job."
}
