/**
 * Cloud Run Jobs for every scheduled background task (M4, T29, T34, T35, T38).
 *
 * scheduler.tf already defines a `google_cloud_scheduler_job` per cadence and
 * an OIDC-scoped invoker SA per job. Until this file landed, the underlying
 * `google_cloud_run_v2_job` resources only existed as runbook copy-paste — so
 * `terraform apply` would create the scheduler entries pointing at jobs that
 * did not exist, and `gcloud scheduler jobs list` was empty in staging. This
 * file fills that gap declaratively.
 *
 * Image strategy: every scheduled job runs from the same `jacob-backend`
 * container that the Cloud Run service uses. The Dockerfile bundles the
 * `infra/scheduled/` entrypoints alongside `app/`; each job picks its
 * entrypoint via `containers.command` rather than a per-job image. Pros:
 *   • one image to scan, push, and audit;
 *   • shared dependency set (firebase-admin, bigquery, sendgrid, sentry)
 *     already declared in backend/pyproject.toml;
 *   • a single CI build step covers every scheduled task.
 *
 * Like the backend service, `template[0].containers[0].image` is excluded
 * from drift tracking (`lifecycle.ignore_changes`). The deploy workflow
 * runs `gcloud run jobs update <name> --image=<SHA>` on every push to
 * main; Terraform owns the shape, gcloud owns the SHA.
 *
 * Cloud Run Jobs are pay-per-run — they sit idle until Cloud Scheduler
 * kicks them. No min-instances knob applies (`task_count` defaults to 1).
 *
 * To bring an existing job into Terraform state without disruption:
 *
 *     terraform import google_cloud_run_v2_job.weekly_digest \
 *       projects/${PROJECT_ID}/locations/us-central1/jobs/weekly-digest
 */

variable "cloudrun_jobs_region" {
  description = "Region for every Cloud Run Job. Must match scheduler_region in scheduler.tf for OIDC."
  type        = string
  default     = "us-central1"
}

variable "cloudrun_jobs_image" {
  description = <<-EOT
    Initial container image for every scheduled Cloud Run Job. The deploy
    workflow rolls real SHAs via `gcloud run jobs update`, so any valid
    `jacob-backend` image is acceptable here — the lifecycle block ignores
    image drift after creation. Default points at the deploy artifact
    registry path; override per env if the registry name differs.
  EOT
  type        = string
  default     = "us-central1-docker.pkg.dev/REPLACE_PROJECT_ID/jacob-images/jacob-backend:initial"
}

variable "cloudrun_job_task_timeout" {
  description = "Per-task timeout. Long enough for the slowest job (weekly_digest, bounded by SendGrid throughput) but short enough that a wedged job won't run for hours."
  type        = string
  default     = "1800s"
}

variable "cloudrun_job_cpu" {
  description = "CPU per Cloud Run Job task. 1 is plenty for IO-bound scripts."
  type        = string
  default     = "1"
}

variable "cloudrun_job_memory" {
  description = "Memory per Cloud Run Job task. 1Gi accommodates BigQuery client + Firestore SDK + cached Jinja templates without paging."
  type        = string
  default     = "1Gi"
}

# ── shared env block ─────────────────────────────────────────────────────────
#
# Every scheduled script expects GCP_PROJECT_ID set. Cloud Run injects
# GOOGLE_CLOUD_PROJECT automatically, but the legacy entrypoints predate
# that convention and read GCP_PROJECT_ID explicitly.

locals {
  cloudrun_job_common_env = {
    GCP_PROJECT_ID = var.project_id
    ENVIRONMENT    = var.env
  }
}

# ── firestore-export (M4, daily 03:00 UTC) ───────────────────────────────────

resource "google_cloud_run_v2_job" "firestore_export" {
  name     = var.firestore_export_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_backup.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/firestore_export.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name  = "BACKUP_BUCKET"
          value = "jacob-backups-${var.env}"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── finalize-deletions (M4, daily 03:30 UTC) ─────────────────────────────────

resource "google_cloud_run_v2_job" "finalize_deletions" {
  name     = var.finalize_deletions_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_api.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/finalize_deletions.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── firestore-to-bigquery (T29, daily 04:30 UTC) ─────────────────────────────

resource "google_cloud_run_v2_job" "firestore_to_bigquery" {
  name     = var.firestore_to_bigquery_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_analytics.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/firestore_to_bigquery.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name  = "BQ_ANALYTICS_DATASET"
          value = google_bigquery_dataset.jacob_analytics.dataset_id
        }

        env {
          name  = "BQ_BACKUPS_BUCKET"
          value = "jacob-backups-${var.env}"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── cleanup-stale-devices (T34, daily 05:00 UTC) ─────────────────────────────

resource "google_cloud_run_v2_job" "cleanup_stale_devices" {
  name     = var.cleanup_stale_devices_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_api.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/cleanup_stale_devices.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── weekly-digest (T35, Sundays 16:00 UTC) ───────────────────────────────────

resource "google_cloud_run_v2_job" "weekly_digest" {
  name     = var.weekly_digest_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_api.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/weekly_digest.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }

        # Kill-switch — flip to "true" via `gcloud run jobs update --update-env-vars`
        # when SendGrid + JWT secret are wired up and you're ready to send.
        env {
          name  = "JACOB_DIGEST_ENABLED"
          value = "false"
        }

        env {
          name  = "BQ_ANALYTICS_DATASET"
          value = google_bigquery_dataset.jacob_analytics.dataset_id
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      # Operators flip JACOB_DIGEST_ENABLED out-of-band; don't fight them.
      template[0].template[0].containers[0].env,
      client,
      client_version,
    ]
  }
}

# ── process-export-jobs (T38, every 5 minutes) ───────────────────────────────

resource "google_cloud_run_v2_job" "process_export_jobs" {
  name     = var.process_exports_job_name
  location = var.cloudrun_jobs_region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.jacob_exports.email
      timeout         = var.cloudrun_job_task_timeout
      max_retries     = 1

      containers {
        image   = var.cloudrun_jobs_image
        command = ["python", "/app/scheduled/process_export_jobs.py"]

        resources {
          limits = {
            cpu    = var.cloudrun_job_cpu
            memory = var.cloudrun_job_memory
          }
        }

        dynamic "env" {
          for_each = local.cloudrun_job_common_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name  = "JACOB_EXPORTS_BUCKET"
          value = google_storage_bucket.exports.name
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── outputs ──────────────────────────────────────────────────────────────────

output "cloud_run_job_names" {
  description = "Names of every scheduled Cloud Run Job. Pass to `gcloud run jobs update --image=...` from CI to roll a new image SHA onto each one."
  value = [
    google_cloud_run_v2_job.firestore_export.name,
    google_cloud_run_v2_job.finalize_deletions.name,
    google_cloud_run_v2_job.firestore_to_bigquery.name,
    google_cloud_run_v2_job.cleanup_stale_devices.name,
    google_cloud_run_v2_job.weekly_digest.name,
    google_cloud_run_v2_job.process_export_jobs.name,
  ]
}
