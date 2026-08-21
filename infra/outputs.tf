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
