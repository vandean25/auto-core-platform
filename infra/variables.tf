variable "project_id" {
  description = "GCP project that owns the Cloud Run service and runtime GSM secrets."
  type        = string
  default     = "auto-core-platform"
}

variable "region" {
  description = "Cloud Run region."
  type        = string
  default     = "europe-west3"
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
}

variable "container_image" {
  description = "Container image to deploy. Cloud Build remains responsible for supplying release image tags."
  type        = string
}

variable "deployment_environment" {
  description = "Application environment represented by this service."
  type        = string

  validation {
    condition     = contains(["staging", "uat", "production"], var.deployment_environment)
    error_message = "deployment_environment must be staging, uat, or production."
  }
}

variable "frontend_url" {
  description = "Allowed browser origin for CORS and realtime connections."
  type        = string
}

variable "firebase_project_id" {
  description = "Firebase project used to verify browser ID tokens."
  type        = string
  default     = "auto-core-platform-vande"
}

variable "sentry_release" {
  description = "Release identifier reported to Sentry."
  type        = string
}

variable "cloud_tasks_enabled" {
  description = "Whether the API should enqueue PDF tasks."
  type        = bool
  default     = true
}

variable "realtime_enabled" {
  description = "Whether to inject Redis and enable cross-instance Socket.IO fan-out."
  type        = bool
  default     = true
}

variable "cloud_tasks_target_base_url" {
  description = "API base URL used by Cloud Tasks to call the PDF worker."
  type        = string
  default     = ""
}

variable "cloud_tasks_invoker_service_account" {
  description = "Service account used by Cloud Tasks OIDC requests."
  type        = string
  default     = "cloud-tasks-pdf-invoker@auto-core-platform.iam.gserviceaccount.com"
}

variable "database_pooler_required" {
  description = "Whether the application must successfully connect through the pooled database URL."
  type        = bool
  default     = false
}

variable "max_instance_request_concurrency" {
  description = "Maximum concurrent requests per Cloud Run instance."
  type        = number
  default     = 40
}

variable "min_instance_count" {
  description = "Minimum Cloud Run instance count."
  type        = number
  default     = 1
}

variable "max_instance_count" {
  description = "Maximum Cloud Run instance count."
  type        = number
  default     = 5
}

variable "cpu_idle" {
  description = "Whether Cloud Run may throttle CPU when the instance is idle."
  type        = bool
  default     = false
}

variable "database_secret_name" {
  description = "GSM secret containing the direct database URL for migrations and runtime fallback."
  type        = string
}

variable "database_pooled_secret_name" {
  description = "GSM secret containing the pooled database URL for runtime connections."
  type        = string
}

variable "sentry_dsn_secret_name" {
  description = "GSM secret containing the backend Sentry DSN."
  type        = string
  default     = "acp-core-api-sentry-dsn"
}

variable "invoice_pdf_bucket_secret_name" {
  description = "GSM secret containing the invoice PDF bucket name."
  type        = string
  default     = "INVOICE_PDF_BUCKET"
}

variable "secret_encryption_key_secret_name" {
  description = "GSM secret containing the application encryption key."
  type        = string
  default     = "SECRET_ENCRYPTION_KEY"
}

variable "cloud_tasks_worker_secret_name" {
  description = "GSM secret containing the Cloud Tasks worker shared secret."
  type        = string
  default     = "CLOUD_TASKS_WORKER_SECRET"
}

variable "redis_url_secret_name" {
  description = "GSM secret containing the Upstash Redis URL."
  type        = string
  default     = "REDIS_URL"
}

variable "allow_unauthenticated" {
  description = "Whether the public API service receives the allUsers Cloud Run Invoker binding."
  type        = bool
  default     = true
}
