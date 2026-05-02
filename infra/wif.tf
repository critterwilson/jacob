/**
 * Workload Identity Federation — replaces the long-lived SA JSON key
 * previously stored in GCP_SA_KEY.
 *
 * After applying this module, add two secrets to the GitHub repo/environment:
 *   GCP_WORKLOAD_IDENTITY_PROVIDER  — output: workload_identity_provider
 *   GCP_SERVICE_ACCOUNT             — output: service_account_email
 *
 * Then delete the old GCP_SA_KEY secret.
 *
 * Apply once per project:
 *   terraform -chdir=infra init
 *   terraform -chdir=infra apply -var project_id=<YOUR_PROJECT_ID> \
 *     -var github_org=<YOUR_GITHUB_ORG> -var github_repo=<YOUR_REPO>
 */

variable "github_org" {
  description = "GitHub organisation or user that owns the repo (e.g. acme-org)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name without the org prefix (e.g. jacob)."
  type        = string
}

# ── WIF pool ──────────────────────────────────────────────────────────────────

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Keyless auth for GitHub Actions CI/CD"
}

resource "google_iam_workload_identity_pool_provider" "github_oidc" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  # Restrict to the specific repo so forks cannot authenticate.
  attribute_condition = "assertion.repository == '${var.github_org}/${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ── Deploy service account ────────────────────────────────────────────────────

resource "google_service_account" "github_deploy" {
  project      = var.project_id
  account_id   = "github-deploy"
  display_name = "GitHub Actions deploy SA"
  description  = "Used by CI to push images and deploy Cloud Run services."
}

# Allow the WIF pool to impersonate this SA.
resource "google_service_account_iam_binding" "wif_impersonate" {
  service_account_id = google_service_account.github_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_org}/${var.github_repo}",
  ]
}

# Permissions needed by the deploy job.
resource "google_project_iam_member" "github_deploy_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_project_iam_member" "github_deploy_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_project_iam_member" "github_deploy_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "workload_identity_provider" {
  description = "Value for GCP_WORKLOAD_IDENTITY_PROVIDER GitHub secret."
  value       = google_iam_workload_identity_pool_provider.github_oidc.name
}

output "service_account_email" {
  description = "Value for GCP_SERVICE_ACCOUNT GitHub secret."
  value       = google_service_account.github_deploy.email
}
