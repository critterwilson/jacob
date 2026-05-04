# T28 — Typesense full-text search sidecar.
#
# Self-hosted single-node Typesense on Cloud Run with a persistent disk
# (mounted via a Cloud Storage volume). Decision documented in
# docs/adr/0005-search-sidecar.md.
#
# Two Secret Manager entries:
#   - typesense_admin_key  : write access, mounted into the Cloud Function only
#   - typesense_search_key : read-only, mounted into the backend Cloud Run only
#
# This file is the operational source of truth for the sidecar — when
# rotating keys, run `terraform apply` after updating the secret values
# in GCP Console or via `gcloud secrets versions add`.

# L11: pin Typesense by digest, not by mutable tag.
#
# `typesense_image_tag` is human-readable bookkeeping (shows up in Cloud Run
# logs and the Terraform plan); `typesense_image_digest` is the trust anchor
# Cloud Run pulls. Docker treats `repo:tag@sha256:...` references as
# tag-ignored — the digest wins, so a re-tag of the same version cannot
# silently swap the image under us.
#
# The digest variable is required (no default) so `terraform apply` refuses
# to deploy without a real digest. See docs/runbooks/typesense-image-pin.md
# for how to look it up when bumping versions.
variable "typesense_image_tag" {
  description = "Human-readable Typesense version tag, e.g. \"28.0\". Paired with typesense_image_digest below — the digest is the trust anchor."
  type        = string
}

variable "typesense_image_digest" {
  description = "SHA256 digest of the Typesense image, e.g. \"sha256:6955c0...\". See docs/runbooks/typesense-image-pin.md for how to look it up."
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.typesense_image_digest))
    error_message = "typesense_image_digest must be 'sha256:' followed by exactly 64 hex chars. Look it up with: crane digest typesense/typesense:<tag>"
  }
}

variable "typesense_data_bucket" {
  description = "GCS bucket name for Typesense's persistent data dir (no gs:// prefix)"
  type        = string
  default     = ""
}

# ── Secret Manager ───────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "typesense_admin_key" {
  secret_id = "typesense-admin-key-${var.env}"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "typesense_search_key" {
  secret_id = "typesense-search-key-${var.env}"

  replication {
    auto {}
  }
}

# Versions are added out-of-band (not committed) so the actual key
# material never lives in source control. After provisioning the secret
# resource, run:
#
#   echo -n "$ADMIN_KEY"  | gcloud secrets versions add typesense-admin-key-${ENV}  --data-file=-
#   echo -n "$SEARCH_KEY" | gcloud secrets versions add typesense-search-key-${ENV} --data-file=-

# ── Cloud Run service (single instance) ──────────────────────────────────────

resource "google_cloud_run_v2_service" "typesense" {
  name     = "typesense-${var.env}"
  location = "us-central1"

  # C1 fix: restrict to internal traffic so the service is unreachable from
  # the public internet. The backend Cloud Run service reaches it via VPC
  # connector; traffic never leaves Google's internal network.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = "typesense/typesense:${var.typesense_image_tag}@${var.typesense_image_digest}"

      ports {
        container_port = 8108
      }

      env {
        name = "TYPESENSE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.typesense_admin_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "TYPESENSE_DATA_DIR"
        value = "/data"
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      volume_mounts {
        name       = "data"
        mount_path = "/data"
      }
    }

    volumes {
      name = "data"
      gcs {
        bucket    = var.typesense_data_bucket
        read_only = false
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

output "typesense_internal_url" {
  description = "URL the backend + Cloud Function should point TYPESENSE_HOST at"
  value       = google_cloud_run_v2_service.typesense.uri
}

# C1 fix: grant the backend service account the run.invoker role so its
# identity-token requests are accepted. Without this binding Cloud Run rejects
# calls with HTTP 403 even though the token is valid.
resource "google_cloud_run_v2_service_iam_member" "typesense_invoker_backend" {
  project  = google_cloud_run_v2_service.typesense.project
  location = google_cloud_run_v2_service.typesense.location
  name     = google_cloud_run_v2_service.typesense.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.jacob_api.email}"
}
