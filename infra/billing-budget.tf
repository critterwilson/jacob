/**
 * Monthly billing budget with granular spend alerts for the staging project.
 *
 * Two existing budgets already live on this billing account:
 *   - "jacob-monthly-budget-staging" ($150, TF-managed in uptime-checks.tf)
 *     — the ceiling; alerts at 50 % and 100 %.
 *   - "JACOB dev cap" ($10, manually created) — covers both projects.
 *
 * This budget sits at $50 and fires at 50 / 90 / 100 / 120 % so a cost
 * spike becomes visible at $25 → $45 → $50 → $60, well before the $150
 * ceiling triggers. No automatic shutoff — alerts only.
 *
 * The email notification channel is defined in uptime-checks.tf
 * (google_monitoring_notification_channel.email, exposed via
 * local.notification_channels). `budget_email` below documents the
 * expected address; set it equal to alert_email in your tfvars.
 */

# ── variables ────────────────────────────────────────────────────────────────

variable "budget_email" {
  description = "Email address for billing budget alert notifications. Should match alert_email in your tfvars."
  type        = string
  default     = "christopherwilsontry@gmail.com"
}

variable "billing_budget_usd" {
  description = "Monthly USD amount for the staging early-warning budget. Alerts fire at 50 %, 90 %, 100 %, and 120 % of this value."
  type        = number
  default     = 50
}

# ── budget resource ───────────────────────────────────────────────────────────

resource "google_billing_budget" "staging" {
  billing_account = var.billing_account_id
  display_name    = "JACOB staging — monthly"

  budget_filter {
    projects               = ["projects/${var.project_id}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.billing_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  # 120 % catches over-spend you missed at 100 % (e.g. a charge that
  # posts after month-end reconciliation).
  threshold_rules {
    threshold_percent = 1.2
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = local.notification_channels
    disable_default_iam_recipients   = true
  }
}
