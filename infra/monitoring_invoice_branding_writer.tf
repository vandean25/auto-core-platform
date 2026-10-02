resource "google_logging_metric" "core_api_invoice_branding_writer_disabled" {
  name = "core_api_invoice_branding_writer_disabled"

  # Nest ConsoleLogger writes warn() as unstructured stdout (textPayload, severity DEFAULT).
  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${var.service_name}"
    (
      textPayload=~"\"code\":\"INVOICE_BRANDING_WRITER_DISABLED\""
      OR jsonPayload.code="INVOICE_BRANDING_WRITER_DISABLED"
    )
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "invoice_branding_writer_disabled" {
  display_name = "Core API INVOICE_BRANDING_WRITER_DISABLED"
  combiner     = "OR"

  conditions {
    display_name = "Invoice finalize/issue returned branding writer disabled"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.core_api_invoice_branding_writer_disabled.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = var.invoice_branding_writer_disabled_alert_notification_channel_ids

  documentation {
    content   = <<-EOT
      core-api returned HTTP 503 with code `INVOICE_BRANDING_WRITER_DISABLED` (branded invoice finalize/issue is off).

      Check `INVOICE_BRANDING_WRITER_ENABLED=true` on the **core-api** Cloud Run service (`cloudbuild.yaml` / `cloudbuild.staging.yaml` deploy step). The PDF worker does not carry this flag.

      See `docs/internal/03-Runbooks/document-branding-archive-rollout.md`.
    EOT
    mime_type = "text/markdown"
  }

  alert_strategy {
    auto_close = "604800s"
  }
}
