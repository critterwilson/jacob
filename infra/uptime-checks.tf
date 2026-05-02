/**
 * Cloud Monitoring uptime checks + alert policies for JACOB (T15).
 *
 * Monitors:
 *   - Frontend root `/`         — synthetic check every 60 s
 *   - Backend `/health`         — synthetic check every 60 s
 *
 * Alerts fire after 2 consecutive failures (≥ 2 minutes down) and are
 * rate-limited to one notification per hour to prevent alert flood.
 *
 * Budget alerts fire at 50 % and 100 % of the configured monthly spend.
 */

# ── variables ────────────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Email address for uptime and budget alerts (Christopher's address)."
  type        = string
}

variable "alert_webhook_url" {
  description = "Optional Slack/Discord webhook URL for alerts. Leave empty to disable."
  type        = string
  default     = ""
}

variable "frontend_host" {
  description = "Hostname of the frontend without scheme (e.g. jacob.app)."
  type        = string
}

variable "backend_host" {
  description = "Hostname of the backend without scheme (e.g. api.jacob.app)."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly GCP spend limit in USD. Alerts fire at 50 % and 100 %."
  type        = number
  default     = 150
}

variable "billing_account_id" {
  description = "GCP billing account ID used for the budget resource."
  type        = string
}

# ── notification channels ────────────────────────────────────────────────────

resource "google_monitoring_notification_channel" "email" {
  display_name = "JACOB on-call email"
  type         = "email"
  project      = var.project_id

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_notification_channel" "webhook" {
  count        = var.alert_webhook_url != "" ? 1 : 0
  display_name = "JACOB on-call webhook"
  type         = "webhook_tokenauth"
  project      = var.project_id

  labels = {
    url = var.alert_webhook_url
  }
}

locals {
  notification_channels = concat(
    [google_monitoring_notification_channel.email.name],
    [for ch in google_monitoring_notification_channel.webhook : ch.name],
  )
}

# ── uptime checks ────────────────────────────────────────────────────────────

resource "google_monitoring_uptime_check_config" "frontend" {
  display_name = "jacob-frontend-${var.env}"
  timeout      = "10s"
  period       = "60s"
  project      = var.project_id

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.frontend_host
    }
  }
}

resource "google_monitoring_uptime_check_config" "backend_health" {
  display_name = "jacob-backend-health-${var.env}"
  timeout      = "10s"
  period       = "60s"
  project      = var.project_id

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  content_matchers {
    content = "ok"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.backend_host
    }
  }
}

# ── alert policies ────────────────────────────────────────────────────────────

resource "google_monitoring_alert_policy" "frontend_down" {
  display_name          = "jacob-frontend-down-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Frontend uptime failing"

    condition_threshold {
      # check_passed drops to 0 when the check fails
      filter     = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND resource.labels.host=\"${var.frontend_host}\""
      duration   = "120s"
      comparison = "COMPARISON_LT"

      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.*"]
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

resource "google_monitoring_alert_policy" "backend_down" {
  display_name          = "jacob-backend-down-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Backend /health failing"

    condition_threshold {
      filter     = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND resource.labels.host=\"${var.backend_host}\""
      duration   = "120s"
      comparison = "COMPARISON_LT"

      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.*"]
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

# ── budget alert ─────────────────────────────────────────────────────────────

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "jacob-monthly-budget-${var.env}"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  # Alert at 50 % and 100 % of the configured budget
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = local.notification_channels
    disable_default_iam_recipients   = true
  }
}

# ── outputs ───────────────────────────────────────────────────────────────────

output "frontend_uptime_check_id" {
  value = google_monitoring_uptime_check_config.frontend.uptime_check_id
}

output "backend_uptime_check_id" {
  value = google_monitoring_uptime_check_config.backend_health.uptime_check_id
}
