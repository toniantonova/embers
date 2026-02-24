# ─────────────────────────────────────────────────────────────────────────────
# Cloud Monitoring — Alerts for Lumen Pipeline
# ─────────────────────────────────────────────────────────────────────────────
# Three alert policies that notify via email when:
#   1. Error rate exceeds 5% over 5 minutes
#   2. P95 latency exceeds 10 seconds
#   3. Cloud Run instance restarts (crash loop detection)
# ─────────────────────────────────────────────────────────────────────────────

# Enable Monitoring API
resource "google_project_service" "monitoring_api" {
  project            = var.project_id
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

# ── Email notification channel ─────────────────────────────────────────────

resource "google_monitoring_notification_channel" "email" {
  display_name = "Lumen Alerts — Email"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring_api]
}

# ── Alert 1: Error rate > 5% ──────────────────────────────────────────────

resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "Lumen: High Error Rate (>5%)"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run 5xx error rate"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring_api]
}

# ── Alert 2: P95 latency > 10s ────────────────────────────────────────────

resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "Lumen: High P95 Latency (>10s)"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run request latency p95"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/request_latencies\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 10000 # milliseconds

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring_api]
}

# ── Alert 3: Instance restart (crash loop) ─────────────────────────────────

resource "google_monitoring_alert_policy" "instance_restart" {
  display_name = "Lumen: Instance Restart Detected"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run container restarts"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/container/instance_count\" AND metric.labels.state = \"active\""
      duration        = "60s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MIN"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring_api]
}
