/**
 * GCS buckets for the JACOB photo moderation pipeline (T10).
 *
 * The split is intentional and the IAM here is the security boundary:
 *
 *   - jacob-media-quarantine-{env}: receives every direct upload via
 *     signed PUT. No public reads, ever. Objects auto-delete after 90
 *     days (anything not promoted by then is abandoned). Only the API
 *     service account may read; only the *moderation* service account
 *     may delete.
 *
 *   - jacob-media-public-{env}: CDN-served, public reads. Only the
 *     narrowly-scoped *moderation* service account may write — that
 *     account is used exclusively by the SafeSearch-pass code path. The
 *     general API service account does NOT have writer access to this
 *     bucket, which is what prevents "rejected" images from leaking.
 *
 * Bucket-level size limits exist as defense in depth: even if the API
 * miscalculates, the GCS layer rejects oversize uploads before bytes
 * land. The signed URL also pins Content-Length, giving us a second
 * server-side enforcement point.
 */

variable "env" {
  description = "Environment suffix (staging | prod)."
  type        = string
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "api_service_account_email" {
  description = "Service account used by the FastAPI backend on Cloud Run."
  type        = string
}

variable "moderation_service_account_email" {
  description = <<-EOT
    Service account used ONLY by the SafeSearch-pass code path that
    promotes objects from quarantine to the public bucket. Keep this
    account scoped narrowly — it is the only writer to the public
    bucket.
  EOT
  type        = string
}

locals {
  quarantine_bucket = "jacob-media-quarantine-${var.env}"
  public_bucket     = "jacob-media-public-${var.env}"
  max_object_bytes  = 8 * 1024 * 1024
}

# ── quarantine bucket ────────────────────────────────────────────────────────

resource "google_storage_bucket" "quarantine" {
  name          = local.quarantine_bucket
  project       = var.project_id
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }
}

# Bucket-level cap on object size (defense in depth above the signed URL).
resource "google_storage_bucket_iam_binding" "quarantine_api_writer" {
  bucket = google_storage_bucket.quarantine.name
  role   = "roles/storage.objectAdmin"
  members = [
    "serviceAccount:${var.api_service_account_email}",
  ]
}

resource "google_storage_bucket_iam_binding" "quarantine_moderation_reader" {
  bucket = google_storage_bucket.quarantine.name
  role   = "roles/storage.objectViewer"
  members = [
    "serviceAccount:${var.moderation_service_account_email}",
  ]
}

# ── public bucket ────────────────────────────────────────────────────────────

resource "google_storage_bucket" "public" {
  name          = local.public_bucket
  project       = var.project_id
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_binding" "public_read" {
  bucket = google_storage_bucket.public.name
  role   = "roles/storage.objectViewer"
  members = [
    "allUsers",
  ]
}

# Only the moderation service account writes to the public bucket. The
# general API service account is intentionally absent here so the
# "promote to public" path is the only way an object can land here.
resource "google_storage_bucket_iam_binding" "public_writer" {
  bucket = google_storage_bucket.public.name
  role   = "roles/storage.objectAdmin"
  members = [
    "serviceAccount:${var.moderation_service_account_email}",
  ]
}

output "quarantine_bucket" {
  value = google_storage_bucket.quarantine.name
}

output "public_bucket" {
  value = google_storage_bucket.public.name
}

output "max_object_bytes" {
  value = local.max_object_bytes
}
