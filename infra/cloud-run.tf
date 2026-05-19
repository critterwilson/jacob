/**
 * Cloud Run service for `jacob-backend` (H4).
 *
 * Captures the runtime config (memory, CPU, concurrency, max-instances,
 * timeout, env vars, service account) declaratively. Before this file
 * landed, the service existed only as a `gcloud run deploy ...` command
 * in `.github/workflows/deploy.yml`, which means there was no way to
 * audit the config without an `gcloud run services describe` round-trip.
 *
 * `template[0].containers[0].image` is intentionally left out of state
 * tracking via `lifecycle.ignore_changes`. The deploy workflow continues
 * to roll new images via `gcloud run deploy ...`; Terraform owns the
 * shape of the service, gcloud owns the image SHA. This split avoids a
 * race where every CI run would otherwise try to revert the image to
 * whatever was last `apply`d.
 *
 * To bring an existing service into Terraform state without disrupting
 * traffic:
 *
 *     terraform import google_cloud_run_v2_service.backend \
 *       projects/${PROJECT_ID}/locations/us-central1/services/jacob-backend
 *
 * Then `terraform plan` should be a no-op (or surface only drift you
 * deliberately want to converge on).
 */

# ── variables ────────────────────────────────────────────────────────────────

variable "cloudrun_min_instances" {
  description = "Cloud Run min-instances. 0 = scale to zero (free tier). Set to 1 to keep the cold-start tax off the user-facing path; review (H3) priced this at ~$15/mo. M5/ADR 0013 note: SSE connections keep an instance warm for free as long as at least one user has chat open, so we stay at 0 and accept the cold-start on the first connect of a quiet period (the polling fallback covers it)."
  type        = number
  default     = 0
}

variable "cloudrun_max_instances" {
  description = "Cloud Run max-instances. Caps blast radius of a runaway autoscaler."
  type        = number
  default     = 10
}

variable "cloudrun_concurrency" {
  description = "Concurrent requests per Cloud Run instance. FastAPI is I/O bound — 80 is the documented Cloud Run default."
  type        = number
  default     = 80
}

variable "cloudrun_request_timeout" {
  description = "Per-request timeout. SSE chat stream connections hold the request open for up to this long, so we set it to the Cloud Run maximum (3600s / 60min). The client reconnects when the server closes the stream at the timeout boundary. See ADR 0013 for the trade-off discussion."
  type        = string
  default     = "3600s"
}

variable "cloudrun_cpu" {
  description = "CPU per Cloud Run instance, e.g. \"1\" or \"2\"."
  type        = string
  default     = "1"
}

variable "cloudrun_memory" {
  description = "Memory per Cloud Run instance, e.g. \"512Mi\", \"1Gi\"."
  type        = string
  default     = "512Mi"
}

variable "backend_image" {
  description = "Initial image reference. Real image SHAs are rolled via `gcloud run deploy ...` from the deploy workflow; Terraform ignores changes to this field after the initial apply."
  type        = string
  default     = "us-central1-docker.pkg.dev/REPLACE_PROJECT_ID/jacob-images/jacob-backend:initial"
}

# ── service ──────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "backend" {
  name     = "jacob-backend"
  location = "us-central1"
  project  = var.project_id

  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.jacob_api.email

    scaling {
      min_instance_count = var.cloudrun_min_instances
      max_instance_count = var.cloudrun_max_instances
    }

    timeout                          = var.cloudrun_request_timeout
    max_instance_request_concurrency = var.cloudrun_concurrency

    containers {
      image = var.backend_image

      resources {
        limits = {
          cpu    = var.cloudrun_cpu
          memory = var.cloudrun_memory
        }
      }

      # ENVIRONMENT and CORS_ALLOWED_ORIGINS are managed imperatively
      # by the deploy workflow today (see deploy.yml). They're declared
      # here in `env` only as a record of intent; ignore_changes covers
      # them so the workflow is the source of truth until env handling
      # gets pulled into Terraform too.
      env {
        name  = "ENVIRONMENT"
        value = var.env
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      # Image SHAs are rolled by `gcloud run deploy` per CI run.
      template[0].containers[0].image,
      # Env vars are still set by deploy.yml (--set-env-vars). Once
      # they move into Terraform, drop these from the ignore list.
      template[0].containers[0].env,
      # Cloud Run mutates labels on every revision; skip drift noise.
      template[0].labels,
      labels,
      client,
      client_version,
    ]
  }
}

# Public unauthenticated invocation. The deploy workflow already passes
# `--allow-unauthenticated`; this binding makes the same intent visible
# in code so a future Terraform-only deploy still produces a public service.
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── outputs ──────────────────────────────────────────────────────────────────

output "backend_service_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "HTTPS URL of the deployed Cloud Run service."
}

output "backend_service_name" {
  value       = google_cloud_run_v2_service.backend.name
  description = "Cloud Run service name — pass to `gcloud run deploy --service=...` from CI."
}
