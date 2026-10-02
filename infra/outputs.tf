output "service_name" {
  description = "Managed Cloud Run service name."
  value       = google_cloud_run_v2_service.core_api.name
}

output "service_uri" {
  description = "Cloud Run service URL."
  value       = google_cloud_run_v2_service.core_api.uri
}

output "runtime_secret_names" {
  description = "GSM secret names referenced by the service, without exposing secret values."
  value       = values(local.secret_environment_variables)
}

output "invoice_branding_writer_disabled_alert_policy_name" {
  description = "Cloud Monitoring alert policy for INVOICE_BRANDING_WRITER_DISABLED log matches."
  value       = google_monitoring_alert_policy.invoice_branding_writer_disabled.name
}

output "invoice_branding_writer_disabled_log_metric_name" {
  description = "User-defined log metric for INVOICE_BRANDING_WRITER_DISABLED responses."
  value       = google_logging_metric.core_api_invoice_branding_writer_disabled.name
}
