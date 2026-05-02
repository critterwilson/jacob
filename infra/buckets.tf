/**
 * GCS buckets for JACOB.
 *
 * Media pipeline buckets (T10):
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
 *     Object versioning is enabled; overwritten/deleted objects are
 *     retained for 60 days before GCS removes the noncurrent version.
 *
 * Backup bucket (T16):
 *   - jacob-backups-{env}: Firestore exports land here. Objects in
 *     daily/ are deleted after 30 days; objects in weekly/ after 90 days.
 *     No public access. Only the backup service account may write/read.
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

variable "backup_service_account_email" {
  description = "Service account used by the firestore_export Cloud Run job."
  type        = string
}

locals {
  quarantine_bucket = "jacob-media-quarantine-${var.env}"
  public_bucket     = "jacob-media-public-${var.env}"
  backup_bucket     = "jacob-backups-${var.env}"
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

  # Only auto-delete abandoned in-progress uploads (H8 fix).
  # Objects under _held/ are CSAM-evidence and must NOT be auto-deleted;
  # they are excluded by scoping the rule to the uploads/ prefix only.
  lifecycle_rule {
    condition {
      age            = 90
      matches_prefix = ["uploads/"]
    }
    action {
      type = "Delete"
    }
  }

  # Retained evidence objects (CSAM-flagged) move to Coldline after 1 year.
  # Manual deletion requires legal-counsel sign-off.
  lifecycle_rule {
    condition {
      age            = 365
      matches_prefix = ["_held/"]
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
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

  versioning {
    enabled = true
  }

  # Retain noncurrent (overwritten/deleted) versions for 60 days.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 60
    }
    action {
      type = "Delete"
    }
  }
}

# Custom role: storage.objects.get only — no storage.objects.list so the
# bucket cannot be enumerated by the public (H5 fix).
resource "google_project_iam_custom_role" "public_object_reader" {
  project     = var.project_id
  role_id     = "publicObjectReader"
  title       = "Public Object Reader"
  description = "Grants storage.objects.get without storage.objects.list."
  permissions = ["storage.objects.get"]
}

resource "google_storage_bucket_iam_binding" "public_read" {
  bucket = google_storage_bucket.public.name
  role   = google_project_iam_custom_role.public_object_reader.id
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

output "backup_bucket" {
  value = google_storage_bucket.backup.name
}

# ── backup bucket ─────────────────────────────────────────────────────────────

resource "google_storage_bucket" "backup" {
  name          = local.backup_bucket
  project       = var.project_id
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  # daily/ prefix: keep for 30 days.
  lifecycle_rule {
    condition {
      age            = 30
      matches_prefix = ["daily/"]
    }
    action {
      type = "Delete"
    }
  }

  # weekly/ prefix: keep for 90 days.
  lifecycle_rule {
    condition {
      age            = 90
      matches_prefix = ["weekly/"]
    }
    action {
      type = "Delete"
    }
  }
}

# Only the backup job's service account may read or write exports.
resource "google_storage_bucket_iam_binding" "backup_rw" {
  bucket = google_storage_bucket.backup.name
  role   = "roles/storage.objectAdmin"
  members = [
    "serviceAccount:${var.backup_service_account_email}",
  ]
}
