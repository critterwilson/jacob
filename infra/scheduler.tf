/**
 * Cloud Scheduler jobs (M4).
 *
 * Replaces the hand-created scheduler jobs that previously ran as the
 * default Compute SA. Each job uses a dedicated OIDC identity defined in
 * `service_accounts.tf` and has `roles/run.invoker` only on its own
 * Cloud Run job — so a compromise of one scheduler SA cannot be used to
 * start the other job.
 *
 * Both jobs run as Cloud Run Jobs (not services) — invoked via the
 * `run.googleapis.com/v1/projects/{p}/locations/{r}/jobs/{j}:run` API.
 *
 * Schedules (UTC):
 *   firestore_export    — daily 03:00
 *   finalize_deletions  — daily 03:30
 */

variable "scheduler_region" {
  description = "Cloud Scheduler region. Must match Cloud Run job region for OIDC."
  type        = string
  default     = "us-central1"
}

variable "firestore_export_job_name" {
  description = "Cloud Run Job name for the daily Firestore export."
  type        = string
  default     = "firestore-export"
}

variable "finalize_deletions_job_name" {
  description = "Cloud Run Job name for the deletion-finalisation sweep."
  type        = string
  default     = "finalize-deletions"
}

locals {
  scheduler_run_invoke_url_export      = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.firestore_export_job_name}:run"
  scheduler_run_invoke_url_deletions   = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.finalize_deletions_job_name}:run"
  scheduler_run_invoke_audience_export = "https://${var.scheduler_region}-run.googleapis.com/"
}

# ── per-job run.invoker IAM (scoped to the specific Cloud Run job) ───────────
#
# We bind at the project level here because Cloud Run Jobs are invoked via the
# admin API, which needs the role at the project (job-level resource bindings
# work but require the job to already exist; the project-level binding is
# bootstrap-friendly). When the migration to least-privilege completes, the
# project-level grant should be tightened to a job-level binding.

resource "google_project_iam_member" "scheduler_export_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_export.email}"

  condition {
    title       = "only firestore-export Cloud Run job"
    description = "Restrict run.invoker to the firestore-export job."
    expression  = "resource.name.endsWith(\"/${var.firestore_export_job_name}\")"
  }
}

resource "google_project_iam_member" "scheduler_deletions_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_deletions.email}"

  condition {
    title       = "only finalize-deletions Cloud Run job"
    description = "Restrict run.invoker to the finalize-deletions job."
    expression  = "resource.name.endsWith(\"/${var.finalize_deletions_job_name}\")"
  }
}

# ── jobs ─────────────────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "firestore_export" {
  name        = "firestore-export-daily"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Daily Firestore export (03:00 UTC). Writes to gs://jacob-backups-{env}."
  schedule    = "0 3 * * *"
  time_zone   = "Etc/UTC"

  retry_config {
    retry_count          = 1
    max_retry_duration   = "0s"
    min_backoff_duration = "60s"
    max_backoff_duration = "3600s"
    max_doublings        = 5
  }

  http_target {
    http_method = "POST"
    uri         = local.scheduler_run_invoke_url_export

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_export.email
      audience              = local.scheduler_run_invoke_audience_export
    }
  }

  depends_on = [google_project_iam_member.scheduler_export_run_invoker]
}

resource "google_cloud_scheduler_job" "finalize_deletions" {
  name        = "finalize-deletions-daily"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Daily deletion-finalisation sweep (03:30 UTC). Hard-deletes accounts past their grace window."
  schedule    = "30 3 * * *"
  time_zone   = "Etc/UTC"

  retry_config {
    retry_count          = 1
    max_retry_duration   = "0s"
    min_backoff_duration = "60s"
    max_backoff_duration = "3600s"
    max_doublings        = 5
  }

  http_target {
    http_method = "POST"
    uri         = local.scheduler_run_invoke_url_deletions

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_deletions.email
      audience              = local.scheduler_run_invoke_audience_export
    }
  }

  depends_on = [google_project_iam_member.scheduler_deletions_run_invoker]
}
