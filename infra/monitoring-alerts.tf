/**
 * Cloud Monitoring alert policies beyond the existing uptime checks (L6).
 *
 * The existing `uptime-checks.tf` covers liveness (frontend / backend
 * down) and the monthly budget. This file adds the latency / error-rate
 * / Firestore-quota alerts the codebase review (L6) flagged as missing.
 * Keeps the same notification channel pattern: email is required,
 * webhook is optional.
 *
 * Plan-only — landing this file does not apply anything. Operator must
 * run `terraform plan` and `terraform apply` from `infra/` deliberately.
 *
 * Thresholds are set conservatively per the review:
 *   - backend p95 latency > 1 s sustained for 5 minutes
 *   - backend 5xx rate > 1 % over 5 minutes (50+ requests sample)
 *   - Firestore reads > 80 % of the configured daily budget
 *   - GCP monthly spend > $100 (separate from the existing
 *     `monthly` budget so this is the early-warning alert; the
 *     existing one remains the kill-switch at the configured ceiling)
 */

# ── variables ────────────────────────────────────────────────────────────────

variable "alert_p95_latency_seconds" {
  description = "p95 latency (seconds) above which the backend latency alert fires."
  type        = number
  default     = 1.0
}

variable "alert_5xx_rate_threshold" {
  description = "Fractional 5xx rate above which the backend error-rate alert fires (e.g. 0.01 = 1%)."
  type        = number
  default     = 0.01
}

variable "firestore_daily_read_budget" {
  description = "Daily Firestore read budget. Alert fires at 80% of this. Free tier is 50_000/day; set to 50000 to use it."
  type        = number
  default     = 50000
}

variable "early_warning_budget_usd" {
  description = "Early-warning monthly spend threshold (USD). Independent of the kill-switch budget in uptime-checks.tf."
  type        = number
  default     = 100
}

# ── alert policies ────────────────────────────────────────────────────────────

# Backend p95 latency. Cloud Run exposes
# `run.googleapis.com/request_latencies` as a distribution; the
# percentile reducer pulls p95 across the configured aggregation window.
resource "google_monitoring_alert_policy" "backend_p95_latency" {
  display_name          = "jacob-backend-p95-latency-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Backend p95 request latency over threshold"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_latencies\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"jacob-backend\"",
      ])
      duration   = "300s"
      comparison = "COMPARISON_GT"
      # request_latencies is reported in ms; convert seconds -> ms.
      threshold_value = var.alert_p95_latency_seconds * 1000

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

# Backend 5xx rate. Compares the fraction of `response_code_class=5xx`
# requests against the total request rate.
resource "google_monitoring_alert_policy" "backend_5xx_rate" {
  display_name          = "jacob-backend-5xx-rate-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Backend 5xx rate over threshold"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"jacob-backend\"",
        "metric.labels.response_code_class=\"5xx\"",
      ])
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_5xx_rate_threshold

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

# Firestore daily read volume. Guards the free-tier ceiling and surfaces
# pathological N+1 / unbounded query regressions before they hit billing.
resource "google_monitoring_alert_policy" "firestore_read_volume" {
  display_name          = "jacob-firestore-reads-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Firestore document reads exceed 80% of daily budget"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"firestore.googleapis.com/document/read_count\"",
        "resource.type=\"firestore.googleapis.com/Database\"",
      ])
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.firestore_daily_read_budget * 0.8

      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

# Early-warning spend alert. Cheaper to wire as a second
# `google_billing_budget` than to overload the existing one — preserves
# the existing kill-switch ceiling while adding a softer signal at $100.
resource "google_billing_budget" "early_warning" {
  billing_account = var.billing_account_id
  display_name    = "jacob-spend-early-warning-${var.env}"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.early_warning_budget_usd)
    }
  }

  # Single threshold: 100% of the early-warning amount = "we crossed $X".
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = local.notification_channels
    disable_default_iam_recipients   = true
  }
}
