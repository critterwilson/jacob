/**
 * $7/mo hard cap — budget → Pub/Sub → Cloud Function that DISABLES BILLING.
 *
 * This is the enforcement layer the cost-alerts runbook flagged as an unbuilt
 * follow-up. The alert-only budgets in `billing-budget.tf` / `uptime-checks.tf`
 * stay as the early-warning layers ($50, $150); this file adds the panic button.
 *
 * Flow:
 *   google_billing_budget.killswitch ($10, all projects on the account)
 *     ├─ emails christopherwilsontry@gmail.com at 50/75/90/100% (+100% forecast)
 *     └─ publishes every threshold crossing to pubsub topic `billing-killswitch`
 *           └─ triggers cloudfunctions2 `billing-killswitch` (infra/functions/…)
 *                 └─ when ACTUAL spend >= $10, calls
 *                    cloudbilling.projects.updateBillingInfo(billingAccountName="")
 *                    → unlinks billing → all billable services stop. No data deleted.
 *
 * Recovery: infra/scripts/restore-billing.sh (re-links the billing account).
 *
 * The budget filters on the billing account with NO project filter, so spend in
 * ANY project counts toward the $10 — a true "all of GCP" cap. The function only
 * disables billing on the projects in `killswitch_project_ids` (default: staging,
 * the sole project with resources; prod is dormant). To extend the kill to prod,
 * add its id to that list AND grant the killswitch SA roles/billing.projectManager
 * on it.
 *
 * Supersedes the manually-created "JACOB dev cap" $10 budget, which had no
 * notification channel or topic. Delete that manual budget after this applies to
 * avoid two budgets at the same threshold (see cost-control runbook).
 */

# ── variables ─────────────────────────────────────────────────────────────────

variable "killswitch_cap_usd" {
  description = "Hard monthly spend cap in USD. When ACTUAL spend reaches this, billing is disabled on the target project(s)."
  type        = number
  default     = 7
}

variable "killswitch_project_ids" {
  description = "Projects whose billing is unlinked when the cap is hit. Defaults to [project_id] (staging). Each id listed must also have the killswitch SA granted roles/billing.projectManager."
  type        = list(string)
  default     = []
}

variable "killswitch_dry_run" {
  description = "When true, the function logs the intended disable without unlinking billing. Use to validate the wiring before arming."
  type        = bool
  default     = false
}

locals {
  # Default the disable-target to the current project when no explicit list given.
  killswitch_targets = length(var.killswitch_project_ids) > 0 ? var.killswitch_project_ids : [var.project_id]
}

data "google_project" "current" {
  project_id = var.project_id
}

# ── required APIs (idempotent; disable_on_destroy=false to avoid surprises) ────

resource "google_project_service" "killswitch_apis" {
  for_each = toset([
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ── Pub/Sub topic the budget publishes to ─────────────────────────────────────

resource "google_pubsub_topic" "killswitch" {
  name    = "billing-killswitch"
  project = var.project_id

  depends_on = [google_project_service.killswitch_apis]
}

# ── service account the function runs as ──────────────────────────────────────

resource "google_service_account" "killswitch" {
  project      = var.project_id
  account_id   = "jacob-killswitch"
  display_name = "JACOB billing kill switch"
  description  = "Runtime + trigger identity for the budget kill-switch function. Can unlink billing from the project."
}

# Project Billing Manager — the least-privilege role that grants
# resourcemanager.projects.deleteBillingAssignment, i.e. the ability to set
# billingAccountName="" on the project. Granted per target project.
resource "google_project_iam_member" "killswitch_billing_manager" {
  for_each = toset(local.killswitch_targets)
  project  = each.value
  role     = "roles/billing.projectManager"
  member   = "serviceAccount:${google_service_account.killswitch.email}"
}

# Eventarc plumbing for the gen2 (Cloud Run) function: the trigger identity must
# be able to receive events and invoke the underlying Run service.
resource "google_project_iam_member" "killswitch_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.killswitch.email}"
}

resource "google_project_iam_member" "killswitch_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.killswitch.email}"
}

# The Pub/Sub service agent needs token-creator to mint OIDC tokens for the
# authenticated Eventarc push to the function. (Standard gen2-pubsub-trigger
# requirement.)
resource "google_project_iam_member" "pubsub_token_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountTokenCreator"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"

  depends_on = [google_project_service.killswitch_apis]
}

# ── package + upload the function source ──────────────────────────────────────

resource "google_storage_bucket" "killswitch_src" {
  name                        = "${var.project_id}-killswitch-src"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  # Source archives are disposable; keep only the latest few.
  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }
  versioning {
    enabled = true
  }
}

data "archive_file" "killswitch_src" {
  type        = "zip"
  source_dir  = "${path.module}/functions/billing-killswitch"
  output_path = "${path.module}/.build/billing-killswitch.zip"
}

resource "google_storage_bucket_object" "killswitch_src" {
  # Content-hash suffix forces a new object (and a function redeploy) whenever
  # the source changes.
  name   = "billing-killswitch-${data.archive_file.killswitch_src.output_md5}.zip"
  bucket = google_storage_bucket.killswitch_src.name
  source = data.archive_file.killswitch_src.output_path
}

# ── the function ──────────────────────────────────────────────────────────────

resource "google_cloudfunctions2_function" "killswitch" {
  name     = "billing-killswitch"
  project  = var.project_id
  location = var.region

  build_config {
    runtime     = "python312"
    entry_point = "stop_billing"
    source {
      storage_source {
        bucket = google_storage_bucket.killswitch_src.name
        object = google_storage_bucket_object.killswitch_src.name
      }
    }
  }

  service_config {
    max_instance_count             = 1
    min_instance_count             = 0
    available_memory               = "256Mi"
    timeout_seconds                = 120
    service_account_email          = google_service_account.killswitch.email
    all_traffic_on_latest_revision = true

    environment_variables = {
      KILLSWITCH_PROJECT_IDS = join(",", local.killswitch_targets)
      KILLSWITCH_DRY_RUN     = var.killswitch_dry_run ? "true" : "false"
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.killswitch.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.killswitch.email
  }

  depends_on = [
    google_project_service.killswitch_apis,
    google_project_iam_member.killswitch_event_receiver,
    google_project_iam_member.killswitch_run_invoker,
    google_project_iam_member.pubsub_token_creator,
  ]
}

# ── the $10 budget that drives it ─────────────────────────────────────────────
#
# Account-wide (no project filter) so spend in ANY project counts toward the cap.
# Publishes to the topic above AND emails the alert channel at each threshold.

resource "google_billing_budget" "killswitch" {
  billing_account = var.billing_account_id
  display_name    = "JACOB $7 hard cap (kill switch)"

  budget_filter {
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.killswitch_cap_usd)
    }
  }

  # Early-warning emails before the kill fires.
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.75
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }
  # 100% ACTUAL — this is the crossing that arms the disable in the function.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }
  # 100% FORECAST — fires early when month-end is trending over $10. Email only;
  # the function ignores forecast crossings (cost still < budget).
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.killswitch.id
    schema_version                   = "1.0"
    monitoring_notification_channels = local.notification_channels
    disable_default_iam_recipients   = true
  }

  depends_on = [google_cloudfunctions2_function.killswitch]
}

# ── outputs ───────────────────────────────────────────────────────────────────

output "killswitch_topic" {
  value       = google_pubsub_topic.killswitch.id
  description = "Pub/Sub topic the $10 budget publishes to."
}

output "killswitch_function" {
  value       = google_cloudfunctions2_function.killswitch.name
  description = "Name of the billing kill-switch function."
}

output "killswitch_service_account" {
  value       = google_service_account.killswitch.email
  description = "SA that can unlink billing. Has roles/billing.projectManager on the target projects."
}
