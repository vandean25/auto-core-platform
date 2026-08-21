locals {
  environment_variables = merge(
    {
      NODE_ENV                 = "production"
      FRONTEND_URL             = var.frontend_url
      SENTRY_RELEASE           = var.sentry_release
      FIREBASE_PROJECT_ID      = var.firebase_project_id
      DATABASE_POOLER_REQUIRED = tostring(var.database_pooler_required)
    },
    var.cloud_tasks_enabled ? {
      CLOUD_TASKS_ENABLED         = "true"
      CLOUD_TASKS_LOCATION        = var.region
      CLOUD_TASKS_QUEUE           = "pdf-queue"
      CLOUD_TASKS_TARGET_BASE_URL = var.cloud_tasks_target_base_url
      CLOUD_TASKS_INVOKER_SA      = var.cloud_tasks_invoker_service_account
    } : {},
  )

  secret_environment_variables = merge(
    {
      DATABASE_URL          = var.database_secret_name
      DATABASE_URL_POOLED   = var.database_pooled_secret_name
      SENTRY_DSN            = var.sentry_dsn_secret_name
      INVOICE_PDF_BUCKET    = var.invoice_pdf_bucket_secret_name
      SECRET_ENCRYPTION_KEY = var.secret_encryption_key_secret_name
    },
    var.cloud_tasks_enabled ? {
      CLOUD_TASKS_WORKER_SECRET = var.cloud_tasks_worker_secret_name
    } : {},
    var.realtime_enabled ? {
      REDIS_URL = var.redis_url_secret_name
    } : {},
  )
}

resource "google_cloud_run_v2_service" "core_api" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    max_instance_request_concurrency = var.max_instance_request_concurrency

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.container_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = var.cpu_idle
      }

      dynamic "env" {
        for_each = local.environment_variables

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_environment_variables

        content {
          name = env.key

          value_source {
            secret_key_ref {
              secret  = "projects/${var.project_id}/secrets/${env.value}"
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # Cloud Build owns release image tags and dynamic environment values.
    # Terraform remains a safe recovery/reference definition until it becomes
    # the only service-config writer.
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  location = var.region
  name     = google_cloud_run_v2_service.core_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
