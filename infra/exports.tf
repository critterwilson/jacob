/**
 * T38 — Self-serve data export bucket.
 *
 * Holds gzipped JSON bundles assembled by the process_export_jobs Cloud
 * Run job. Each object is referenced by a V4 signed URL with a 7-day TTL
 * (controlled by JACOB_EXPORT_SIGNED_URL_TTL_DAYS on the runtime env).
 * The bucket-level lifecycle deletes objects after 14 days as a backstop
 * even if the job-doc is lost — anyone who lost their link past then has
 * to request a fresh export.
 *
 * Access:
 *   - Public access: blocked.
 *   - Writer: jacob-exports SA (the Cloud Run job service account).
 *   - Reader: nobody — downloads are mediated exclusively by signed URLs.
 *
 * Object layout:
 *   gs://jacob-exports-{env}/{uid}/{jobId}.json.gz
 */

variable "exports_service_account_email" {
  description = <<-EOT
    Service account used by the process_export_jobs Cloud Run job.
    Needs roles/datastore.user (read user data, write export job docs)
    and storage.objectAdmin on this bucket. Set from the
    `jacob-exports@…` SA emitted by `service_accounts.tf`.
  EOT
  type        = string
}

locals {
  exports_bucket = "jacob-exports-${var.env}"
}

resource "google_storage_bucket" "exports" {
  name          = local.exports_bucket
  project       = var.project_id
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  # 14-day TTL backstop. Signed URLs are 7 days; this prevents any object
  # from lingering past the documented retention even if the job-doc is
  # lost or the URL leaks.
  lifecycle_rule {
    condition {
      age = 14
    }
    action {
      type = "Delete"
    }
  }
}

# Only the export job's SA may write. Reads are mediated by signed URLs;
# no IAM read binding exists at all (defense in depth — even if a SA is
# compromised, it can't enumerate or download other users' bundles
# unless it already had storage.objectAdmin).
resource "google_storage_bucket_iam_binding" "exports_writer" {
  bucket = google_storage_bucket.exports.name
  role   = "roles/storage.objectAdmin"
  members = [
    "serviceAccount:${var.exports_service_account_email}",
  ]
}

output "exports_bucket" {
  value = google_storage_bucket.exports.name
}
