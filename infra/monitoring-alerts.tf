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
 *   - backend 5xx count > 0.01 events/s sustained for 5 minutes
 *     (≈ one 5xx every 100 s — this is an absolute count threshold,
 *     NOT a ratio of 5xx vs total. A true ratio would need a
 *     numerator/denominator pair, which Cloud Monitoring exposes via a
 *     two-condition policy; we deliberately keep the simpler count
 *     threshold for now.)
 *   - Firestore reads > 80 % of the configured daily budget
 *     (delta-aligned over 24h, so the threshold is reads-per-day)
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

variable "alert_5xx_count_threshold_per_second" {
  description = "Absolute 5xx count rate (events/second, ALIGN_RATE-aligned over 60s) above which the backend error alert fires. NOT a ratio of 5xx vs total — that would need a two-condition numerator/denominator policy. Default 0.01 ≈ one 5xx every 100s."
  type        = number
  default     = 0.01
}

variable "firestore_daily_read_budget" {
  description = "Daily Firestore read budget. Alert fires at 80% of this. Free tier is 50_000/day; set to 50000 to use it."
  type        = number
  default     = 50000
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

# Backend 5xx count rate. ALIGN_RATE on `request_count` filtered to
# `response_code_class=5xx` is requests-per-second — an absolute count
# threshold, NOT a ratio of 5xx vs total. A true ratio would need a
# numerator/denominator pair (Cloud Monitoring two-condition policy);
# we deliberately keep this simpler count threshold and surface that
# in the variable name and docstring so reviewers know what it is.
resource "google_monitoring_alert_policy" "backend_5xx_rate" {
  display_name          = "jacob-backend-5xx-count-${var.env}"
  combiner              = "OR"
  project               = var.project_id
  notification_channels = local.notification_channels

  conditions {
    display_name = "Backend 5xx count rate over threshold"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"jacob-backend\"",
        "metric.labels.response_code_class=\"5xx\"",
      ])
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_5xx_count_threshold_per_second

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
#
# `read_count` is a cumulative counter. With `ALIGN_DELTA` and an
# `alignment_period` of one day, each aligned point is the number of
# reads that occurred in the last 24 hours — so the threshold value is
# in reads-per-day and can be compared directly against the daily
# budget. (The previous `ALIGN_RATE` form here yielded mean
# reads-per-second over 24h, which made the budget-fraction threshold
# effectively unreachable.)
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
        # document/read_count is reported against the firestore_instance
        # monitored resource, not firestore.googleapis.com/Database (that
        # pairs with the newer document/read_ops_count metric). The mismatch
        # was rejected at create time with a 400 "invalid combination".
        "resource.type=\"firestore_instance\"",
      ])
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.firestore_daily_read_budget * 0.8

      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "604800s"
  }
}

# NOTE: the early-warning $ budget that used to live here was removed in the
# budget consolidation — the single $10 kill-switch budget
# (billing-killswitch.tf) now covers alerting (50/75/90/100% + forecast) and
# enforcement. See docs/runbooks/cost-control.md.
