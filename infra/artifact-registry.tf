/**
 * Artifact Registry — cleanup policy for the backend image repo.
 *
 * `jacob-images` is the dominant current cost line item: at the 2026-06 audit
 * it held 285 `jacob-backend` images (~9.28 GB) with NO cleanup policy, because
 * every CI deploy pushes a new SHA-tagged image and nothing prunes them. The
 * sibling repos (firebaseapphosting-images, gcf-artifacts) already auto-clean;
 * this brings jacob-images in line.
 *
 * Policy: keep the 10 most-recent versions always; delete anything older than
 * 7 days. In Artifact Registry, KEEP policies win over DELETE policies, so the
 * 10 newest are retained regardless of age — and the currently-deployed image
 * is always the newest, so a running Cloud Run revision can never be pruned.
 * Reclaims ~96% of the stored bytes on first sweep, then stays flat.
 *
 * The repo already exists (created by the first CI push, outside Terraform), so
 * the `import` block below adopts it into state on the next apply instead of
 * trying to recreate it. Remove the import block after the first successful
 * apply — it is a one-time adoption, harmless if left but tidier gone.
 *
 * Equivalent gcloud (if applying outside Terraform):
 *   gcloud artifacts repositories set-cleanup-policies jacob-images \
 *     --location=us-central1 --project=jacob-staging-494515 \
 *     --policy=infra/artifact-registry-cleanup-policy.json
 *   # add --dry-run first to preview deletions in Cloud Logging.
 */

resource "google_artifact_registry_repository" "jacob_images" {
  project       = var.project_id
  location      = "us-central1"
  repository_id = "jacob-images"
  format        = "DOCKER"
  description   = "Backend container images (jacob-backend). One image per CI deploy."

  # Set true for a rehearsal: the policies are evaluated and logged but nothing
  # is deleted. Flip to false (default) to actually prune.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-most-recent-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-stale-images"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s" # 7 days
    }
  }

  lifecycle {
    # Cloud Run / CI may mutate labels on the repo; don't fight that.
    ignore_changes = [labels]
  }
}

# One-time adoption of the pre-existing repo. Safe to delete after first apply.
import {
  to = google_artifact_registry_repository.jacob_images
  id = "projects/${var.project_id}/locations/us-central1/repositories/jacob-images"
}

output "jacob_images_repo" {
  value       = google_artifact_registry_repository.jacob_images.id
  description = "Artifact Registry repo holding backend images, with cleanup policy attached."
}
