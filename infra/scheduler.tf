/**
 * Cloud Scheduler jobs (M4, T29, T34, T35, T38).
 *
 * Replaces the hand-created scheduler jobs that previously ran as the
 * default Compute SA. Each job uses a dedicated identity and has
 * `roles/run.invoker` only on its own Cloud Run job — so a compromise
 * of one scheduler SA cannot be used to start another job.
 *
 * All jobs invoke Cloud Run Jobs (not Services) via the admin API.
 * The admin API authenticates with OAuth access tokens, not OIDC ID
 * tokens — OIDC returns UNAUTHENTICATED even when the SA has
 * `roles/run.invoker`. See "Execute Cloud Run jobs on a schedule".
 *
 * Schedules (UTC):
 *   firestore_export       — daily 03:00
 *   finalize_deletions     — daily 03:30
 *   firestore_to_bigquery  — daily 04:30 (after export completes, T29)
 *   cleanup_stale_devices  — daily 05:00 (prune FCM tokens idle >60d, T34)
 *   weekly_digest          — Sundays 16:00 (email digest, T35)
 *   process_export_jobs    — every 5 min (GDPR DSAR processor, T38)
 */

variable "scheduler_region" {
  description = "Cloud Scheduler region. Must match the Cloud Run job region (each job's invoke URL is region-scoped)."
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
  scheduler_run_invoke_url_export    = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.firestore_export_job_name}:run"
  scheduler_run_invoke_url_deletions = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.finalize_deletions_job_name}:run"

  # OAuth scope required to call the Cloud Run admin API (run.googleapis.com).
  # Cloud Scheduler's `oauth_token` block accepts any cloud-platform-class
  # scope; the broad scope below matches Google's documented example for
  # invoking Cloud Run jobs on a schedule.
  scheduler_run_oauth_scope = "https://www.googleapis.com/auth/cloud-platform"
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

    oauth_token {
      service_account_email = google_service_account.jacob_scheduler_export.email
      scope                 = local.scheduler_run_oauth_scope
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_export_run_invoker,
    google_cloud_run_v2_job.firestore_export,
  ]
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

    oauth_token {
      service_account_email = google_service_account.jacob_scheduler_deletions.email
      scope                 = local.scheduler_run_oauth_scope
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_deletions_run_invoker,
    google_cloud_run_v2_job.finalize_deletions,
  ]
}

# ── weekly-digest (T35, Sundays 16:00 UTC) ───────────────────────────────────

variable "weekly_digest_job_name" {
  description = "Cloud Run Job name for the weekly email digest sender."
  type        = string
  default     = "weekly-digest"
}

locals {
  scheduler_run_invoke_url_weekly_digest = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.weekly_digest_job_name}:run"
}

resource "google_service_account" "jacob_scheduler_weekly_digest" {
  project      = var.project_id
  account_id   = "jacob-scheduler-weekly-digest"
  display_name = "JACOB Cloud Scheduler — weekly-digest invoker"
}

resource "google_project_iam_member" "scheduler_weekly_digest_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_weekly_digest.email}"

  condition {
    title       = "only weekly-digest Cloud Run job"
    description = "Restrict run.invoker to the weekly-digest job."
    expression  = "resource.name.endsWith(\"/${var.weekly_digest_job_name}\")"
  }
}

resource "google_cloud_scheduler_job" "weekly_digest" {
  name        = "weekly-digest"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Send weekly email digests to opted-in users (Sundays 16:00 UTC)."
  schedule    = "0 16 * * 0"
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
    uri         = local.scheduler_run_invoke_url_weekly_digest

    oauth_token {
      service_account_email = google_service_account.jacob_scheduler_weekly_digest.email
      scope                 = local.scheduler_run_oauth_scope
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_weekly_digest_run_invoker,
    google_cloud_run_v2_job.weekly_digest,
  ]
}

# ── process-export-jobs (T38, every 5 minutes) ───────────────────────────────

variable "process_exports_job_name" {
  description = "Cloud Run Job name for the self-serve data-export processor (T38)."
  type        = string
  default     = "process-export-jobs"
}

locals {
  scheduler_run_invoke_url_exports = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.process_exports_job_name}:run"
}

resource "google_service_account" "jacob_scheduler_exports" {
  project      = var.project_id
  account_id   = "jacob-scheduler-exports"
  display_name = "JACOB Cloud Scheduler — process-export-jobs invoker"
}

resource "google_project_iam_member" "scheduler_exports_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_exports.email}"

  condition {
    title       = "only process-export-jobs Cloud Run job"
    description = "Restrict run.invoker to the process-export-jobs job (T38)."
    expression  = "resource.name.endsWith(\"/${var.process_exports_job_name}\")"
  }
}

# Process self-serve data-export jobs every 5 minutes. The backend's
# "1 in-flight per user" guard plus the processor's PROCESSOR_BATCH_CAP
# (5) bound concurrent assemblies. Retries are bounded so a wedged job
# can't fan out load.
resource "google_cloud_scheduler_job" "process_export_jobs" {
  name        = "process-export-jobs-5min"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Process pending self-serve data-export jobs (T38). Runs every 5 minutes."
  schedule    = "*/5 * * * *"
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
    uri         = local.scheduler_run_invoke_url_exports

    oauth_token {
      service_account_email = google_service_account.jacob_scheduler_exports.email
      scope                 = local.scheduler_run_oauth_scope
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_exports_run_invoker,
    google_cloud_run_v2_job.process_export_jobs,
  ]
}

# ── cleanup-stale-devices (T34, daily 05:00 UTC) ─────────────────────────────

variable "cleanup_stale_devices_job_name" {
  description = "Cloud Run Job name for the stale FCM device-token pruner (T34)."
  type        = string
  default     = "cleanup-stale-devices"
}

locals {
  scheduler_run_invoke_url_cleanup_devices = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.cleanup_stale_devices_job_name}:run"
}

resource "google_service_account" "jacob_scheduler_cleanup_devices" {
  project      = var.project_id
  account_id   = "jacob-cleanup-devices"
  display_name = "JACOB Cloud Scheduler — cleanup-stale-devices invoker"
}

resource "google_project_iam_member" "scheduler_cleanup_devices_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_cleanup_devices.email}"

  condition {
    title       = "only cleanup-stale-devices Cloud Run job"
    description = "Restrict run.invoker to the cleanup-stale-devices job (T34)."
    expression  = "resource.name.endsWith(\"/${var.cleanup_stale_devices_job_name}\")"
  }
}

resource "google_cloud_scheduler_job" "cleanup_stale_devices" {
  name        = "cleanup-stale-devices-daily"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Prune FCM device tokens idle for more than 60 days (T34). Runs daily at 05:00 UTC."
  schedule    = "0 5 * * *"
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
    uri         = local.scheduler_run_invoke_url_cleanup_devices

    oauth_token {
      service_account_email = google_service_account.jacob_scheduler_cleanup_devices.email
      scope                 = local.scheduler_run_oauth_scope
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_cleanup_devices_run_invoker,
    google_cloud_run_v2_job.cleanup_stale_devices,
  ]
}
