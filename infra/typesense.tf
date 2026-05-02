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

variable "typesense_image" {
  description = "Pinned Typesense Docker image, e.g. typesense/typesense:0.27.0"
  type        = string
  default     = "typesense/typesense:0.27.0"
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

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = var.typesense_image

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
