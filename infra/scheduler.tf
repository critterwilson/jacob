/**
 * Cloud Scheduler jobs (M4, T29, T33, T34, T35, T38).
 *
 * Replaces the hand-created scheduler jobs that previously ran as the
 * default Compute SA. Each job uses a dedicated OIDC identity and has
 * `roles/run.invoker` only on its own Cloud Run job — so a compromise
 * of one scheduler SA cannot be used to start another job.
 *
 * All jobs invoke Cloud Run Jobs (not Services) via the admin API.
 *
 * Schedules (UTC):
 *   firestore_export       — daily 03:00
 *   finalize_deletions     — daily 03:30
 *   firestore_to_bigquery  — daily 04:30 (after export completes, T29)
 *   cleanup_stale_devices  — daily 05:00 (prune FCM tokens idle >60d, T34)
 *   daily_verse            — daily 07:00 (Bible verse cache, T33)
 *   weekly_digest          — Sundays 16:00 (email digest, T35)
 *   process_export_jobs    — every 5 min (GDPR DSAR processor, T38)
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

# ── firestore-to-bigquery (T29, 04:30 UTC) ───────────────────────────────────

variable "firestore_to_bigquery_job_name" {
  description = "Cloud Run Job name for the Firestore → BigQuery analytics loader."
  type        = string
  default     = "firestore-to-bigquery"
}

locals {
  scheduler_run_invoke_url_bq_loader = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.firestore_to_bigquery_job_name}:run"
}

resource "google_cloud_scheduler_job" "firestore_to_bigquery" {
  name        = "firestore-to-bigquery-daily"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Daily Firestore → BigQuery analytics load (04:30 UTC). Runs after firestore-export."
  schedule    = "30 4 * * *"
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
    uri         = local.scheduler_run_invoke_url_bq_loader

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_analytics.email
      audience              = "https://${var.scheduler_region}-run.googleapis.com/"
    }
  }

  depends_on = [google_project_iam_member.scheduler_analytics_run_invoker]
}

# ── daily-verse (T33, 07:00 UTC) ─────────────────────────────────────────────

variable "daily_verse_job_name" {
  description = "Cloud Run Job name for the daily Bible verse fetcher."
  type        = string
  default     = "daily-verse"
}

locals {
  scheduler_run_invoke_url_daily_verse = "https://${var.scheduler_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${var.daily_verse_job_name}:run"
}

resource "google_service_account" "jacob_scheduler_daily_verse" {
  project      = var.project_id
  account_id   = "jacob-scheduler-daily-verse"
  display_name = "JACOB Cloud Scheduler — daily-verse invoker"
}

resource "google_project_iam_member" "scheduler_daily_verse_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.jacob_scheduler_daily_verse.email}"

  condition {
    title       = "only daily-verse Cloud Run job"
    description = "Restrict run.invoker to the daily-verse job."
    expression  = "resource.name.endsWith(\"/${var.daily_verse_job_name}\")"
  }
}

resource "google_cloud_scheduler_job" "daily_verse" {
  name        = "daily-verse"
  project     = var.project_id
  region      = var.scheduler_region
  description = "Fetch today's Bible verse and cache it in Firestore (07:00 UTC)."
  schedule    = "0 7 * * *"
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
    uri         = local.scheduler_run_invoke_url_daily_verse

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_daily_verse.email
      audience              = "https://${var.scheduler_region}-run.googleapis.com/"
    }
  }

  depends_on = [google_project_iam_member.scheduler_daily_verse_run_invoker]
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

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_weekly_digest.email
      audience              = "https://${var.scheduler_region}-run.googleapis.com/"
    }
  }

  depends_on = [google_project_iam_member.scheduler_weekly_digest_run_invoker]
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

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_exports.email
      audience              = "https://${var.scheduler_region}-run.googleapis.com/"
    }
  }

  depends_on = [google_project_iam_member.scheduler_exports_run_invoker]
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

    oidc_token {
      service_account_email = google_service_account.jacob_scheduler_cleanup_devices.email
      audience              = "https://${var.scheduler_region}-run.googleapis.com/"
    }
  }

  depends_on = [google_project_iam_member.scheduler_cleanup_devices_run_invoker]
}
